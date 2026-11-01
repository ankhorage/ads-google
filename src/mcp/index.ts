import type { McpIntegration } from '@ankhorage/mcp/types';

import { createGoogleAdsRestPorts } from '../features/google-ads/adapters/createGoogleAdsRestPorts.js';
import { prepareGoogleAdsMutationAsync } from '../features/google-ads/application/prepareGoogleAdsMutationAsync.js';
import type { GoogleAdsMutation, GoogleAdsProviderConfiguration } from '../types/googleAds.js';
import { createGoogleAdsMcpWriteTools } from './createGoogleAdsMcpWriteTools.js';

export { createGoogleAdsServiceAccountAccessTokenResolver } from './createGoogleAdsServiceAccountAccessTokenResolver.js';
export { createIntegrationAsync } from './createIntegrationAsync.js';

/*** Compose account-isolated discovery and optionally host-bound prepared-write tools. */
export function createGoogleAdsMcpIntegration(input: {
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly now?: () => string;
  readonly writeEnabled?: boolean;
}): McpIntegration {
  const ports = createGoogleAdsRestPorts(input.configuration);
  const now = input.now ?? (() => new Date().toISOString());
  return {
    id: 'google-ads',
    tools: [
      createReadResourceTool(ports),
      createDiscoveryTool(
        ports,
        'campaigns',
        'List campaigns with status and budget resource IDs.',
      ),
      createDiscoveryTool(ports, 'ad-groups', 'List ad groups with status and CPC resource IDs.'),
      createDiscoveryTool(ports, 'keywords', 'List mutable keyword resource IDs and CPC values.'),
      createDiscoveryTool(
        ports,
        'negative-keywords',
        'List ad-group negative keyword resource IDs.',
      ),
      createDiscoveryTool(
        ports,
        'campaign-negative-keywords',
        'List campaign negative keyword resource IDs.',
      ),
      {
        accountId,
        description: 'Prepare a Google Ads mutation with validate-only and an immutable diff.',
        executeAsync: createPrepareAsync(input.configuration, now),
        id: 'prepare-mutation',
        inputSchema: mutationSchema,
        risk: 'read',
        scope: 'account',
        title: 'Prepare Google Ads mutation',
      },
      ...(input.writeEnabled === true
        ? createGoogleAdsMcpWriteTools({
            accountId,
            configuration: input.configuration,
            now,
          })
        : []),
    ],
  };
}

/*** Expose one resource lookup without accepting credentials or a caller-selected account scope. */
function createReadResourceTool(ports: ReturnType<typeof createGoogleAdsRestPorts>) {
  return {
    accountId,
    description: 'Read one Google Ads resource in the configured account.',
    executeAsync: async (value: Readonly<Record<string, unknown>>) => {
      const resourceName = stringAt(value, 'resourceName');
      return (
        (await ports.readResourceAsync({ customerId: requiredAccountId(value), resourceName })) ?? {
          resourceName,
          values: null,
        }
      );
    },
    id: 'read-resource',
    inputSchema: accountResourceSchema,
    risk: 'read' as const,
    scope: 'account' as const,
    title: 'Read Google Ads resource',
  };
}

/*** Expose a bounded discovery collection so an agent can find canonical resource names. */
function createDiscoveryTool(
  ports: ReturnType<typeof createGoogleAdsRestPorts>,
  kind: Parameters<ReturnType<typeof createGoogleAdsRestPorts>['listResourcesAsync']>[0]['kind'],
  description: string,
) {
  return {
    accountId,
    description,
    executeAsync: async (value: Readonly<Record<string, unknown>>) =>
      await ports.listResourcesAsync({ customerId: requiredAccountId(value), kind }),
    id: `list-${kind}`,
    inputSchema: accountSchema,
    risk: 'read' as const,
    scope: 'account' as const,
    title: `List Google Ads ${kind}`,
  };
}

/*** Bind prepare to the same explicit provider configuration without retaining host state. */
function createPrepareAsync(configuration: GoogleAdsProviderConfiguration, now: () => string) {
  const ports = createGoogleAdsRestPorts(configuration);
  return async (value: Readonly<Record<string, unknown>>) => {
    const request = parseMutationRequest(value);
    return await prepareGoogleAdsMutationAsync({
      customerId: request.accountId,
      mutation: request.mutation,
      mutations: ports,
      now,
      reads: ports,
    });
  };
}

const accountSchema = {
  additionalProperties: false,
  properties: { accountId: { type: 'string' as const } },
  required: ['accountId'],
  type: 'object' as const,
};
const accountResourceSchema = {
  additionalProperties: false,
  properties: { accountId: { type: 'string' as const }, resourceName: { type: 'string' as const } },
  required: ['accountId', 'resourceName'],
  type: 'object' as const,
};
const mutationSchema = {
  additionalProperties: true,
  properties: { accountId: { type: 'string' as const }, kind: { type: 'string' as const } },
  required: ['accountId', 'kind'],
  type: 'object' as const,
};

/*** Derive scope only from the canonical account argument. */
function accountId(value: Readonly<Record<string, unknown>>): string | null {
  const result = value['accountId'];
  return typeof result === 'string' && result.length > 0 ? result : null;
}

/*** Parse the deliberately narrow supported MCP mutation grammar. */
function parseMutationRequest(value: Readonly<Record<string, unknown>>): {
  readonly accountId: string;
  readonly mutation: GoogleAdsMutation;
} {
  const accountIdValue = requiredAccountId(value);
  const kind = stringAt(value, 'kind');
  if (kind === 'create-keyword' || kind === 'create-ad-group-negative-keyword')
    return {
      accountId: accountIdValue,
      mutation: {
        adGroupResourceName: stringAt(value, 'adGroupResourceName'),
        kind,
        matchType: keywordMatchType(value),
        text: stringAt(value, 'text'),
      },
    };
  if (kind === 'set-budget')
    return {
      accountId: accountIdValue,
      mutation: {
        amountMicros: stringAt(value, 'amountMicros'),
        campaignBudgetResourceName: stringAt(value, 'campaignBudgetResourceName'),
        kind,
      },
    };
  throw new Error('Google Ads mutation kind is not supported by this MCP integration.');
}

/*** Require a nonempty account identity before scope and provider checks. */
function requiredAccountId(value: Readonly<Record<string, unknown>>): string {
  const result = accountId(value);
  if (result === null) throw new Error('Google Ads accountId is required.');
  return result;
}
/*** Read one required nonempty JSON string without coercion. */
function stringAt(
  value: Readonly<Record<string, unknown>>,
  key:
    | 'accountId'
    | 'adGroupResourceName'
    | 'amountMicros'
    | 'campaignBudgetResourceName'
    | 'kind'
    | 'matchType'
    | 'resourceName'
    | 'text',
): string {
  const result = valueForStringKey(value, key);
  if (typeof result !== 'string' || result.length === 0)
    throw new Error(`Google Ads ${key} must be a nonempty string.`);
  return result;
}
/*** Select from the finite public grammar without a caller-controlled object lookup. */
function valueForStringKey(
  value: Readonly<Record<string, unknown>>,
  key:
    | 'accountId'
    | 'adGroupResourceName'
    | 'amountMicros'
    | 'campaignBudgetResourceName'
    | 'kind'
    | 'matchType'
    | 'resourceName'
    | 'text',
): unknown {
  switch (key) {
    case 'accountId':
      return value['accountId'];
    case 'adGroupResourceName':
      return value['adGroupResourceName'];
    case 'amountMicros':
      return value['amountMicros'];
    case 'campaignBudgetResourceName':
      return value['campaignBudgetResourceName'];
    case 'kind':
      return value['kind'];
    case 'matchType':
      return value['matchType'];
    case 'resourceName':
      return value['resourceName'];
    case 'text':
      return value['text'];
  }
}
/*** Restrict matches to values represented by the core contract. */
function keywordMatchType(value: Readonly<Record<string, unknown>>): 'BROAD' | 'EXACT' | 'PHRASE' {
  const matchType = stringAt(value, 'matchType');
  if (matchType === 'BROAD' || matchType === 'EXACT' || matchType === 'PHRASE') return matchType;
  throw new Error('Google Ads matchType must be BROAD, EXACT, or PHRASE.');
}
