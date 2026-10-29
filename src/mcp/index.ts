import type {
  McpChangeDescriptor,
  McpIntegration,
  McpToolExecutionContext,
} from '@ankhorage/mcp/types';

import { createGoogleAdsRestPorts } from '../features/google-ads/adapters/createGoogleAdsRestPorts.js';
import { executePersistedGoogleAdsMutationAsync } from '../features/google-ads/application/executePersistedGoogleAdsMutationAsync.js';
import { prepareGoogleAdsMutationAsync } from '../features/google-ads/application/prepareGoogleAdsMutationAsync.js';
import type { GoogleAdsMutationAttemptPort } from '../features/google-ads/ports/googleAdsPorts.js';
import type { GoogleAdsMutation, GoogleAdsProviderConfiguration } from '../types/googleAds.js';
import {
  isIndeterminateGoogleAdsMcpOutcome,
  isSameGoogleAdsMcpChange,
  toGoogleAdsMcpChangeDescriptor,
} from './googleAdsMcpToolUtils.js';

export { createGoogleAdsServiceAccountAccessTokenResolver } from './createGoogleAdsServiceAccountAccessTokenResolver.js';
export { createIntegrationAsync } from './createIntegrationAsync.js';

/** Compose published-MCP discovery, preparation, and host-bound write tools for one account. */
export function createGoogleAdsMcpIntegration(input: {
  readonly attempts?: GoogleAdsMutationAttemptPort;
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly now?: () => string;
}): McpIntegration {
  const ports = createGoogleAdsRestPorts(input.configuration);
  const now = input.now ?? (() => new Date().toISOString());
  const prepareAsync = createPrepareAsync(input.configuration, now);
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
        executeAsync: prepareAsync,
        id: 'prepare-mutation',
        inputSchema: mutationSchema,
        risk: 'read',
        scope: 'account',
        title: 'Prepare Google Ads mutation',
      },
      ...(input.attempts === undefined
        ? []
        : createWriteTools({ attempts: input.attempts, configuration: input.configuration, now })),
    ],
  };
}
/** Expose one resource lookup without accepting credentials or a caller-selected account scope. */
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
/** Expose a bounded discovery collection so an agent can find canonical resource names. */
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
/** Bind every currently supported mutation kind to its own host-approved MCP operation. */
function createWriteTools(input: {
  readonly attempts: GoogleAdsMutationAttemptPort;
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly now: () => string;
}) {
  return (['create-keyword', 'create-ad-group-negative-keyword', 'set-budget'] as const).map(
    (kind) => createWriteTool({ ...input, kind }),
  );
}
/** Re-prepare exactly one bounded mutation before claiming its pre-persisted execution intent. */
function createWriteTool(input: {
  readonly attempts: GoogleAdsMutationAttemptPort;
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly kind: 'create-keyword' | 'create-ad-group-negative-keyword' | 'set-budget';
  readonly now: () => string;
}) {
  const prepareAsync = createPrepareAsync(input.configuration, input.now);
  const proposalAsync = async (value: Readonly<Record<string, unknown>>) =>
    await prepareAsync({ ...value, kind: input.kind });
  return {
    accountId,
    approvalFingerprintAsync: async (value: Readonly<Record<string, unknown>>) =>
      (await proposalAsync(value)).fingerprint,
    auditOutcome: (output: unknown) =>
      isIndeterminateGoogleAdsMcpOutcome(output)
        ? ('indeterminate' as const)
        : ('executed' as const),
    describeChangeAsync: async (value: Readonly<Record<string, unknown>>) =>
      toGoogleAdsMcpChangeDescriptor(await proposalAsync(value)),
    description: `Execute one host-approved Google Ads ${input.kind} mutation.`,
    executeAsync: async (
      value: Readonly<Record<string, unknown>>,
      context: McpToolExecutionContext,
    ) => {
      const approvalId = context.consumedApproval?.approvalId;
      if (approvalId === undefined)
        throw new Error('Google Ads writes require a trusted host consumed approval.');
      const proposal = await proposalAsync(value);
      const ports = createGoogleAdsRestPorts(input.configuration);
      return await executePersistedGoogleAdsMutationAsync({
        approvalId,
        attempts: input.attempts,
        mutations: ports,
        proposal,
        reads: ports,
      });
    },
    id: input.kind,
    inputSchema: input.kind === 'set-budget' ? budgetMutationSchema : keywordMutationSchema,
    risk: 'write' as const,
    scope: 'account' as const,
    title: `Execute Google Ads ${input.kind}`,
    verifyExpectedStateAsync: async (
      value: Readonly<Record<string, unknown>>,
      _context: McpToolExecutionContext,
      change: McpChangeDescriptor,
    ) =>
      isSameGoogleAdsMcpChange(change, toGoogleAdsMcpChangeDescriptor(await proposalAsync(value))),
  };
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
const keywordMutationSchema = {
  additionalProperties: false,
  properties: {
    accountId: { type: 'string' as const },
    adGroupResourceName: { type: 'string' as const },
    matchType: { type: 'string' as const },
    text: { type: 'string' as const },
  },
  required: ['accountId', 'adGroupResourceName', 'matchType', 'text'],
  type: 'object' as const,
};
const budgetMutationSchema = {
  additionalProperties: false,
  properties: {
    accountId: { type: 'string' as const },
    amountMicros: { type: 'string' as const },
    campaignBudgetResourceName: { type: 'string' as const },
  },
  required: ['accountId', 'amountMicros', 'campaignBudgetResourceName'],
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
  readonly mutation: GoogleAdsMutation;
} {
  const accountId = requiredAccountId(value);
  const kind = stringAt(value, 'kind');
  if (kind === 'create-keyword' || kind === 'create-ad-group-negative-keyword')
    return {
      accountId,
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

/** Select from the finite public tool grammar without accepting object-key injection. */
function valueForKey(value: Readonly<Record<string, unknown>>, key: string): unknown {
  if (key === 'adGroupResourceName') return value['adGroupResourceName'];
  if (key === 'amountMicros') return value['amountMicros'];
  if (key === 'campaignBudgetResourceName') return value['campaignBudgetResourceName'];
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
