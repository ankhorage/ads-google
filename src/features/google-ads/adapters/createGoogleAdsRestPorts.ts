import type {
  GoogleAdsMutation,
  GoogleAdsMutationResult,
  GoogleAdsProviderConfiguration,
} from '../../../types/googleAds.js';
import type {
  GoogleAdsDiscoveryPort,
  GoogleAdsMutationPort,
  GoogleAdsReadPort,
} from '../ports/googleAdsPorts.js';
import { assertGoogleAdsMutationResourceKind } from './assertGoogleAdsMutationResourceKind.js';
import { createGoogleAdsDiscoveryQuery } from './createGoogleAdsDiscoveryQuery.js';

/*** Create v26 REST ports scoped to one configured Google Ads customer. */
export function createGoogleAdsRestPorts(
  configuration: GoogleAdsProviderConfiguration,
): GoogleAdsDiscoveryPort & GoogleAdsReadPort & GoogleAdsMutationPort {
  const requestAsync = createGoogleAdsRequestAsync(configuration);
  return {
    async listResourcesAsync({ customerId, kind }) {
      assertCustomer(configuration, customerId);
      const response = await requestAsync(`customers/${customerId}/googleAds:searchStream`, {
        query: createGoogleAdsDiscoveryQuery(kind),
      });
      return decodeResources(response);
    },
    async readResourceAsync({ customerId, resourceName }) {
      assertCustomer(configuration, customerId);
      assertResourceCustomer(configuration, resourceName);
      const query = createResourceReadQuery(resourceName);
      const response = await requestAsync(`customers/${customerId}/googleAds:searchStream`, {
        query,
      });
      return decodeResources(response).at(0) ?? null;
    },
    async findKeywordDuplicatesAsync({
      customerId,
      matchType,
      negative,
      parentResourceName,
      text,
    }) {
      assertCustomer(configuration, customerId);
      assertResourceCustomer(configuration, parentResourceName);
      const query = createKeywordDuplicateQuery({ matchType, negative, parentResourceName, text });
      const results = await requestAsync(`customers/${customerId}/googleAds:searchStream`, {
        query,
      });
      return decodeResources(results);
    },
    async mutateAsync({ customerId, mutation, validateOnly }) {
      assertCustomer(configuration, customerId);
      assertMutationResources(configuration, mutation);
      const request = toMutationRequest(mutation);
      const response = await requestAsync(`customers/${customerId}/${request.service}:mutate`, {
        operations: [request.operation],
        validateOnly,
      });
      return decodeMutationResult(response, validateOnly);
    },
  };
}

type GoogleAdsRequestAsync = (path: string, body: unknown) => Promise<unknown>;
interface GoogleAdsMutationRequest {
  readonly operation: Readonly<Record<string, unknown>>;
  readonly service: string;
}
/*** Create the one authenticated request boundary without exposing secret values in errors. */
function createGoogleAdsRequestAsync(
  configuration: GoogleAdsProviderConfiguration,
): GoogleAdsRequestAsync {
  const apiVersion = configuration.apiVersion ?? 'v26';
  return async (path, body) => {
    const response = await fetch(`https://googleads.googleapis.com/${apiVersion}/${path}`, {
      body: JSON.stringify(body),
      headers: createHeaders(configuration),
      method: 'POST',
    });
    if (!response.ok)
      throw new Error(`Google Ads API request failed with HTTP ${response.status}.`);
    return await response.json();
  };
}
/*** Refuse every customer except the explicitly configured account. */
function assertCustomer(configuration: GoogleAdsProviderConfiguration, customerId: string): void {
  if (customerId !== configuration.allowedCustomerId)
    throw new Error('Google Ads customer is outside this provider scope.');
}
/*** Reject a resource name unless it belongs to the single configured customer. */
function assertResourceCustomer(
  configuration: GoogleAdsProviderConfiguration,
  resourceName: string,
): void {
  const match =
    /^customers\/([^/]+)\/(?:adGroups|adGroupCriteria|campaigns|campaignBudgets|campaignCriteria)\/[^/]+$/.exec(
      resourceName,
    );
  if (match?.[1] !== configuration.allowedCustomerId)
    throw new Error('Google Ads resource is outside this provider scope.');
}
/*** Validate every resource carried by an operation before any provider request is made. */
function assertMutationResources(
  configuration: GoogleAdsProviderConfiguration,
  mutation: GoogleAdsMutation,
): void {
  const resources = Object.entries(mutation)
    .filter(([key, value]) => key.endsWith('ResourceName') && typeof value === 'string')
    .map(([, value]) => value);
  resources.forEach((resourceName) => {
    assertResourceCustomer(configuration, resourceName);
    assertGoogleAdsMutationResourceKind(mutation, resourceName);
  });
}
/*** Build authorization headers without serializing secrets into errors or audit data. */
function createHeaders(
  configuration: GoogleAdsProviderConfiguration,
): Readonly<Record<string, string>> {
  return {
    Authorization: `Bearer ${configuration.accessToken}`,
    'Content-Type': 'application/json',
    'developer-token': configuration.developerToken,
    ...(configuration.loginCustomerId === undefined
      ? {}
      : { 'login-customer-id': configuration.loginCustomerId }),
  };
}
/*** Translate one supported provider mutation to its precise Google Ads mutate service. */
function toMutationRequest(mutation: GoogleAdsMutation): GoogleAdsMutationRequest {
  if (mutation.kind === 'create-keyword' || mutation.kind === 'create-ad-group-negative-keyword')
    return createAdGroupCriterionRequest(mutation);
  if (mutation.kind === 'create-campaign-negative-keyword')
    return createCampaignCriterionRequest(mutation);
  if (mutation.kind === 'remove-keyword' || mutation.kind === 'remove-ad-group-negative-keyword')
    return { service: 'adGroupCriteria', operation: { remove: mutation.criterionResourceName } };
  if (mutation.kind === 'remove-campaign-negative-keyword')
    return { service: 'campaignCriteria', operation: { remove: mutation.criterionResourceName } };
  if (mutation.kind === 'set-keyword-cpc')
    return createUpdateRequest('adGroupCriteria', mutation.criterionResourceName, {
      cpcBidMicros: mutation.cpcBidMicros,
    });
  if (mutation.kind === 'set-ad-group-cpc')
    return createUpdateRequest('adGroups', mutation.adGroupResourceName, {
      cpcBidMicros: mutation.cpcBidMicros,
    });
  if (mutation.kind === 'set-budget')
    return createUpdateRequest('campaignBudgets', mutation.campaignBudgetResourceName, {
      amountMicros: mutation.amountMicros,
    });
  if (mutation.kind === 'set-campaign-status')
    return createUpdateRequest('campaigns', mutation.campaignResourceName, {
      status: mutation.status,
    });
  if ('adGroupResourceName' in mutation && 'status' in mutation)
    return createUpdateRequest('adGroups', mutation.adGroupResourceName, {
      status: mutation.status,
    });
  throw new Error('Unsupported Google Ads mutation.');
}

/*** Map an ad-group criterion creation to the v26 operation payload. */
function createAdGroupCriterionRequest(
  mutation: Extract<
    GoogleAdsMutation,
    { readonly adGroupResourceName: string; readonly text: string }
  >,
): GoogleAdsMutationRequest {
  return {
    service: 'adGroupCriteria',
    operation: {
      create: {
        adGroup: mutation.adGroupResourceName,
        keyword: { matchType: mutation.matchType, text: mutation.text },
        negative: mutation.kind === 'create-ad-group-negative-keyword',
      },
    },
  };
}

/*** Map a campaign criterion creation to the v26 operation payload. */
function createCampaignCriterionRequest(
  mutation: Extract<
    GoogleAdsMutation,
    { readonly campaignResourceName: string; readonly text: string }
  >,
): GoogleAdsMutationRequest {
  return {
    service: 'campaignCriteria',
    operation: {
      create: {
        campaign: mutation.campaignResourceName,
        keyword: { matchType: mutation.matchType, text: mutation.text },
        negative: true,
      },
    },
  };
}

/*** Build a field-mask update operation for one v26 resource service. */
function createUpdateRequest(
  service: string,
  resourceName: string,
  update: Readonly<Record<string, string>>,
): GoogleAdsMutationRequest {
  return {
    service,
    operation: {
      update: { resourceName, ...update },
      updateMask: Object.keys(update)
        .map((key) => key.replaceAll(/[A-Z]/g, (character) => `_${character.toLowerCase()}`))
        .join(','),
    },
  };
}

/*** Escape a GAQL string literal. */
function escapeGaql(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}
/*** Build a resource-scoped GAQL lookup for a supported mutable resource name. */
function createResourceReadQuery(resourceName: string): string {
  const { field, resource } = getResourceQuery(resourceName);
  return `SELECT ${getResourceReadFields(field)} FROM ${resource} WHERE ${field}.resource_name = '${escapeGaql(resourceName)}'`;
}

/*** Select only the mutable state needed to prepare and verify each supported resource. */
function getResourceReadFields(field: string): string {
  if (field === 'ad_group')
    return `${field}.resource_name, ${field}.status, ${field}.cpc_bid_micros`;
  if (field === 'campaign') return `${field}.resource_name, ${field}.status`;
  if (field === 'campaign_budget') return `${field}.resource_name, ${field}.amount_micros`;
  if (field === 'ad_group_criterion')
    return `${field}.resource_name, ${field}.negative, ${field}.cpc_bid_micros, ${field}.keyword.text, ${field}.keyword.match_type`;
  if (field === 'campaign_criterion')
    return `${field}.resource_name, ${field}.negative, ${field}.keyword.text, ${field}.keyword.match_type`;
  return `${field}.resource_name`;
}

/*** Select the correct GAQL resource and field namespace from its canonical name. */
function getResourceQuery(resourceName: string): Readonly<{ field: string; resource: string }> {
  const resource = resourceName.split('/').at(-2);
  if (resource === 'adGroupCriteria')
    return { field: 'ad_group_criterion', resource: 'ad_group_criterion' };
  if (resource === 'adGroups') return { field: 'ad_group', resource: 'ad_group' };
  if (resource === 'campaignBudgets')
    return { field: 'campaign_budget', resource: 'campaign_budget' };
  if (resource === 'campaignCriteria')
    return { field: 'campaign_criterion', resource: 'campaign_criterion' };
  if (resource === 'campaigns') return { field: 'campaign', resource: 'campaign' };
  if (resource === 'customers') return { field: 'customer', resource: 'customer' };
  throw new Error('Unsupported Google Ads resource name.');
}

/*** Build the criterion query shared by keyword and negative-keyword duplicate detection. */
function createKeywordDuplicateQuery(input: {
  readonly matchType: string;
  readonly negative: boolean;
  readonly parentResourceName: string;
  readonly text: string;
}): string {
  const campaign = input.parentResourceName.includes('/campaigns/');
  const field = campaign ? 'campaign_criterion' : 'ad_group_criterion';
  const parent = campaign ? 'campaign' : 'ad_group';
  return `SELECT ${field}.resource_name FROM ${field} WHERE ${field}.${parent} = '${escapeGaql(input.parentResourceName)}' AND ${field}.negative = ${input.negative ? 'TRUE' : 'FALSE'} AND ${field}.keyword.text = '${escapeGaql(input.text)}' AND ${field}.keyword.match_type = ${input.matchType}`;
}

/*** Decode a supported v26 search-stream response without trusting its JSON shape. */
function decodeResources(value: unknown): readonly {
  readonly resourceName: string;
  readonly values: Readonly<Record<string, unknown>>;
}[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(decodeSearchStreamBatch);
}

/*** Decode one REST search-stream batch into provider read values. */
function decodeSearchStreamBatch(batch: unknown): readonly {
  readonly resourceName: string;
  readonly values: Readonly<Record<string, unknown>>;
}[] {
  if (!isRecord(batch) || !Array.isArray(batch['results'])) return [];
  return batch['results'].flatMap(decodeSearchStreamResult);
}

/*** Decode one resource record while retaining the selected provider state. */
function decodeSearchStreamResult(result: unknown): readonly {
  readonly resourceName: string;
  readonly values: Readonly<Record<string, unknown>>;
}[] {
  if (!isRecord(result)) return [];
  const resourceName = findResourceName(result);
  return resourceName === undefined ? [] : [{ resourceName, values: extractReadValues(result) }];
}

/*** Retain JSON-compatible selected resource fields without preserving untrusted envelopes. */
function extractReadValues(
  result: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const resource = Object.values(result).find(isRecord);
  return resource ?? {};
}

/*** Decode a validation acknowledgement or the exact result of one productive mutation. */
function decodeMutationResult(
  value: unknown,
  validateOnly: boolean,
): GoogleAdsMutationResult | undefined {
  if (!isRecord(value)) throw new Error('Google Ads mutation response was incomplete.');
  if (value['partialFailureError'] !== undefined)
    throw new Error('Google Ads mutation response reported a partial failure.');
  if (validateOnly) return undefined;
  const results = Array.isArray(value['results']) ? value['results'] : [];
  if (results.length !== 1)
    throw new Error('Google Ads mutation response did not contain exactly one result.');
  const result: unknown = results.at(0);
  if (!isRecord(result) || typeof result['resourceName'] !== 'string')
    throw new Error('Google Ads mutation response did not identify its resource.');
  return { resourceName: result['resourceName'] };
}

/*** Find a resource name in a typed Google Ads result without an unsafe JSON cast. */
function findResourceName(value: Readonly<Record<string, unknown>>): string | undefined {
  const direct = value['resourceName'];
  if (typeof direct === 'string') return direct;
  return Object.values(value)
    .flatMap((item) => {
      if (!isRecord(item) || typeof item['resourceName'] !== 'string') return [];
      return [item['resourceName']];
    })
    .at(0);
}

/*** Narrow untrusted JSON to a record before accessing fields. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
