import type { McpIntegration } from '@ankhorage/mcp/types';

import { createGoogleAdsRestPorts } from '../features/google-ads/adapters/createGoogleAdsRestPorts.js';
import { prepareGoogleAdsMutationAsync } from '../features/google-ads/application/prepareGoogleAdsMutationAsync.js';
import type { GoogleAdsMutation, GoogleAdsProviderConfiguration } from '../types/googleAds.js';

/** Compose published-MCP read and validate-only tools for one explicitly configured account. */
export function createGoogleAdsMcpIntegration(input: {
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly now?: () => string;
}): McpIntegration {
  const ports = createGoogleAdsRestPorts(input.configuration);
  const now = input.now ?? (() => new Date().toISOString());
  const prepareAsync = createPrepareAsync(input.configuration, now);
  return {
    id: 'google-ads',
    tools: [
      {
        accountId,
        description: 'Read one Google Ads resource in the configured account.',
        executeAsync: async (value) => {
          const resourceName = stringAt(value, 'resourceName');
          return (
            (await ports.readResourceAsync({
              customerId: requiredAccountId(value),
              resourceName,
            })) ?? { resourceName, values: null }
          );
        },
        id: 'read-resource',
        inputSchema: accountResourceSchema,
        risk: 'read',
        scope: 'account',
        title: 'Read Google Ads resource',
      },
      {
        accountId,
        description:
          'Prepare a Google Ads keyword or budget mutation with validate-only and a diff.',
        executeAsync: prepareAsync,
        id: 'prepare-mutation',
        inputSchema: mutationSchema,
        risk: 'read',
        scope: 'account',
        title: 'Prepare Google Ads mutation',
      },
    ],
  };
}

/** Create the discoverable MCP integration from process-local secrets, never from tool input. */
export function createIntegrationAsync(): Promise<McpIntegration> {
  return Promise.resolve(
    createGoogleAdsMcpIntegration({
      configuration: {
        accessToken: requiredEnvironmentValue('ANKH_GOOGLE_ADS_ACCESS_TOKEN'),
        allowedCustomerId: requiredEnvironmentValue('ANKH_GOOGLE_ADS_ALLOWED_CUSTOMER_ID'),
        developerToken: requiredEnvironmentValue('ANKH_GOOGLE_ADS_DEVELOPER_TOKEN'),
        ...(optionalEnvironmentValue('ANKH_GOOGLE_ADS_LOGIN_CUSTOMER_ID') === undefined
          ? {}
          : { loginCustomerId: optionalEnvironmentValue('ANKH_GOOGLE_ADS_LOGIN_CUSTOMER_ID') }),
      },
    }),
  );
}

/** Bind prepare to the same explicit provider configuration without retaining host state. */
function createPrepareAsync(configuration: GoogleAdsProviderConfiguration, now: () => string) {
  const ports = createGoogleAdsRestPorts(configuration);
  return async (value: Readonly<Record<string, unknown>>) => {
    const request = parseMutationRequest(value);
    return await prepareGoogleAdsMutationAsync({
      customerId: request.accountId,
      mutation: request.mutation,
      mutations: ports,
      now: () => request.createdAt ?? now(),
      reads: ports,
    });
  };
}

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

/** Derive scope only from the canonical account argument. */
function accountId(value: Readonly<Record<string, unknown>>): string | null {
  const result = value['accountId'];
  return typeof result === 'string' && result !== '' ? result : null;
}
/** Parse the deliberately narrow supported MCP mutation grammar. */
function parseMutationRequest(value: Readonly<Record<string, unknown>>): {
  readonly accountId: string;
  readonly createdAt?: string;
  readonly mutation: GoogleAdsMutation;
} {
  const accountId = requiredAccountId(value);
  const kind = stringAt(value, 'kind');
  const createdAt = optionalStringAt(value, 'createdAt');
  if (kind === 'create-keyword' || kind === 'create-ad-group-negative-keyword')
    return {
      accountId,
      ...(createdAt === undefined ? {} : { createdAt }),
      mutation: {
        adGroupResourceName: stringAt(value, 'adGroupResourceName'),
        kind,
        matchType: keywordMatchType(value),
        text: stringAt(value, 'text'),
      },
    };
  if (kind === 'set-budget')
    return {
      accountId,
      ...(createdAt === undefined ? {} : { createdAt }),
      mutation: {
        amountMicros: stringAt(value, 'amountMicros'),
        campaignBudgetResourceName: stringAt(value, 'campaignBudgetResourceName'),
        kind,
      },
    };
  throw new Error('Unsupported Google Ads MCP mutation.');
}
/** Require a nonempty account identity before scope and provider checks. */
function requiredAccountId(value: Readonly<Record<string, unknown>>): string {
  const result = accountId(value);
  if (result === null) throw new Error('Google Ads account identity is required.');
  return result;
}
/** Read one required nonempty JSON string without coercion. */
function stringAt(value: Readonly<Record<string, unknown>>, key: string): string {
  const result = valueForKey(value, key);
  if (typeof result !== 'string' || result === '')
    throw new Error(`Google Ads ${key} is required.`);
  return result;
}
/** Read an optional JSON string without accepting another type. */
function optionalStringAt(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const result = valueForKey(value, key);
  if (result === undefined) return undefined;
  if (typeof result !== 'string' || result === '')
    throw new Error(`Google Ads ${key} must be a string.`);
  return result;
}

/** Select from the finite public tool grammar without accepting object-key injection. */
function valueForKey(value: Readonly<Record<string, unknown>>, key: string): unknown {
  if (key === 'adGroupResourceName') return value['adGroupResourceName'];
  if (key === 'amountMicros') return value['amountMicros'];
  if (key === 'campaignBudgetResourceName') return value['campaignBudgetResourceName'];
  if (key === 'createdAt') return value['createdAt'];
  if (key === 'kind') return value['kind'];
  if (key === 'matchType') return value['matchType'];
  if (key === 'resourceName') return value['resourceName'];
  if (key === 'text') return value['text'];
  throw new Error('Unsupported Google Ads MCP input field.');
}
/** Restrict matches to values represented by the core contract. */
function keywordMatchType(value: Readonly<Record<string, unknown>>): 'BROAD' | 'EXACT' | 'PHRASE' {
  const result = stringAt(value, 'matchType');
  if (result === 'BROAD' || result === 'EXACT' || result === 'PHRASE') return result;
  throw new Error('Google Ads matchType is invalid.');
}

/** Read a required process-local secret without ever returning it in an error. */
function requiredEnvironmentValue(name: string): string {
  const value = optionalEnvironmentValue(name);
  if (value === undefined) throw new Error('Google Ads MCP host configuration is incomplete.');
  return value;
}

/** Read a nonempty host configuration value. */
function optionalEnvironmentValue(name: string): string | undefined {
  const value = environmentValue(name);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Select only the fixed environment names owned by this integration. */
function environmentValue(name: string): string | undefined {
  if (name === 'ANKH_GOOGLE_ADS_ACCESS_TOKEN') return process.env['ANKH_GOOGLE_ADS_ACCESS_TOKEN'];
  if (name === 'ANKH_GOOGLE_ADS_ALLOWED_CUSTOMER_ID')
    return process.env['ANKH_GOOGLE_ADS_ALLOWED_CUSTOMER_ID'];
  if (name === 'ANKH_GOOGLE_ADS_DEVELOPER_TOKEN')
    return process.env['ANKH_GOOGLE_ADS_DEVELOPER_TOKEN'];
  if (name === 'ANKH_GOOGLE_ADS_LOGIN_CUSTOMER_ID')
    return process.env['ANKH_GOOGLE_ADS_LOGIN_CUSTOMER_ID'];
  throw new Error('Unsupported Google Ads MCP environment variable.');
}
