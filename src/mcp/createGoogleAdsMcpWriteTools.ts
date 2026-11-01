import type {
  McpPreparedWrite,
  McpPreparedWriteProposal,
  McpToolExecutionContext,
} from '@ankhorage/mcp/types';

import { createGoogleAdsRestPorts } from '../features/google-ads/adapters/createGoogleAdsRestPorts.js';
import { executePreparedGoogleAdsMutationAsync } from '../features/google-ads/application/executePreparedGoogleAdsMutationAsync.js';
import { prepareGoogleAdsMutationAsync } from '../features/google-ads/application/prepareGoogleAdsMutationAsync.js';
import { verifyGoogleAdsMutationProposalAsync } from '../features/google-ads/application/verifyGoogleAdsMutationProposalAsync.js';
import { createProposalFingerprint } from '../features/google-ads/domain/createMutationFingerprint.js';
import type {
  GoogleAdsMutation,
  GoogleAdsMutationProposal,
  GoogleAdsProviderConfiguration,
} from '../types/googleAds.js';
import {
  isExecutedGoogleAdsMcpOutcome,
  isSameGoogleAdsMcpChange,
  toGoogleAdsMcpChangeDescriptor,
} from './googleAdsMcpToolUtils.js';
import { reconcileGoogleAdsMcpPreparedWriteAsync } from './reconcileGoogleAdsMcpPreparedWriteAsync.js';

const GOOGLE_ADS_PREPARED_WRITE_VERSION = 'google-ads-mutation-proposal/v1';

/*** Create MCP write tools that preserve a single provider proposal through host approval and execution. */
export function createGoogleAdsMcpWriteTools(input: {
  readonly accountId: (value: Readonly<Record<string, unknown>>) => string | null;
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly now: () => string;
}) {
  return (['create-keyword', 'create-ad-group-negative-keyword', 'set-budget'] as const).map(
    (kind) => createWriteTool({ ...input, kind }),
  );
}

/*** Bind one mutation grammar to the MCP prepared-write lifecycle. */
function createWriteTool(input: {
  readonly accountId: (value: Readonly<Record<string, unknown>>) => string | null;
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly kind: 'create-keyword' | 'create-ad-group-negative-keyword' | 'set-budget';
  readonly now: () => string;
}) {
  return {
    accountId: input.accountId,
    auditOutcome: (output: unknown) =>
      isExecutedGoogleAdsMcpOutcome(output) ? ('executed' as const) : ('indeterminate' as const),
    description: `Execute one host-approved Google Ads ${input.kind} mutation.`,
    executePreparedWriteAsync: async (
      stored: McpPreparedWriteProposal,
      context: McpToolExecutionContext,
    ) =>
      await executeStoredGoogleAdsProposalAsync(input.configuration, input.kind, stored, context),
    id: input.kind,
    inputSchema: input.kind === 'set-budget' ? budgetMutationSchema : keywordMutationSchema,
    prepareWriteAsync: async (
      value: Readonly<Record<string, unknown>>,
    ): Promise<McpPreparedWrite> =>
      await prepareGoogleAdsMcpWriteAsync(input.configuration, input.kind, input.now, value),
    risk: 'write' as const,
    reconcilePreparedWriteAsync: async (
      stored: McpPreparedWriteProposal,
      context: McpToolExecutionContext,
    ) =>
      await reconcileGoogleAdsMcpPreparedWriteAsync({
        configuration: input.configuration,
        context,
        kind: input.kind,
        parseProposal: (proposal) =>
          parseStoredGoogleAdsProposal(proposal, input.kind, input.configuration),
        stored,
      }),
    scope: 'account' as const,
    title: `Execute Google Ads ${input.kind}`,
    verifyPreparedWriteAsync: async (
      stored: McpPreparedWriteProposal,
      context: McpToolExecutionContext,
    ) => await verifyStoredGoogleAdsProposalAsync(input.configuration, input.kind, stored, context),
  };
}

/*** Prepare one provider proposal and serialize it for the trusted MCP host without regenerating it later. */
async function prepareGoogleAdsMcpWriteAsync(
  configuration: GoogleAdsProviderConfiguration,
  kind: 'create-keyword' | 'create-ad-group-negative-keyword' | 'set-budget',
  now: () => string,
  value: Readonly<Record<string, unknown>>,
): Promise<McpPreparedWrite> {
  const ports = createGoogleAdsRestPorts(configuration);
  return toMcpPreparedWrite(
    await prepareGoogleAdsMutationAsync({
      customerId: requiredAccountId(value),
      mutation: parseMutation(value, kind),
      mutations: ports,
      now,
      reads: ports,
    }),
  );
}

/*** Execute one host-claimed stored proposal through the Google Ads boundary. */
async function executeStoredGoogleAdsProposalAsync(
  configuration: GoogleAdsProviderConfiguration,
  kind: GoogleAdsMutation['kind'],
  stored: McpPreparedWriteProposal,
  context: McpToolExecutionContext,
) {
  assertExecutionClaim(context);
  const ports = createGoogleAdsRestPorts(configuration);
  return await executePreparedGoogleAdsMutationAsync({
    mutations: ports,
    proposal: parseStoredGoogleAdsProposal(stored, kind, configuration),
    reads: ports,
  });
}

/*** Check a stored proposal against current provider state before the one permitted provider write. */
async function verifyStoredGoogleAdsProposalAsync(
  configuration: GoogleAdsProviderConfiguration,
  kind: GoogleAdsMutation['kind'],
  stored: McpPreparedWriteProposal,
  context: McpToolExecutionContext,
): Promise<boolean> {
  assertExecutionClaim(context);
  const ports = createGoogleAdsRestPorts(configuration);
  return await verifyGoogleAdsMutationProposalAsync({
    proposal: parseStoredGoogleAdsProposal(stored, kind, configuration),
    reads: ports,
  });
}

/*** Serialize the complete immutable provider proposal in the versioned MCP persisted payload. */
function toMcpPreparedWrite(proposal: GoogleAdsMutationProposal): McpPreparedWrite {
  return {
    change: toGoogleAdsMcpChangeDescriptor(proposal),
    createdAt: proposal.createdAt,
    fingerprint: proposal.fingerprint,
    operation: proposal.mutation.kind,
    payload: {
      serialized: JSON.stringify({ proposal, version: GOOGLE_ADS_PREPARED_WRITE_VERSION }),
      version: GOOGLE_ADS_PREPARED_WRITE_VERSION,
    },
  };
}
/*** Decode and cross-check the host-persisted original proposal before any provider boundary action. */
function parseStoredGoogleAdsProposal(
  stored: McpPreparedWriteProposal,
  operation: GoogleAdsMutation['kind'],
  configuration: GoogleAdsProviderConfiguration,
): GoogleAdsMutationProposal {
  if (
    stored.operation !== operation ||
    stored.payload.version !== GOOGLE_ADS_PREPARED_WRITE_VERSION
  )
    throw new Error('Google Ads prepared write has an unsupported operation or payload version.');
  const envelope = parsePreparedPayload(stored.payload.serialized);
  if (envelope.version !== GOOGLE_ADS_PREPARED_WRITE_VERSION)
    throw new Error('Google Ads prepared write payload version is invalid.');
  assertOriginalProposal(envelope.proposal, stored, operation, configuration);
  return envelope.proposal;
}
/*** Parse only the versioned serialized payload produced by this integration. */
function parsePreparedPayload(serialized: string): {
  readonly proposal: GoogleAdsMutationProposal;
  readonly version: string;
} {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      typeof value['version'] !== 'string' ||
      !isGoogleAdsProposal(value['proposal'])
    )
      throw new Error('invalid');
    return { proposal: value['proposal'], version: value['version'] };
  } catch {
    throw new Error('Google Ads prepared write payload is invalid.');
  }
}
/*** Enforce immutable account, resource, operation, change, timestamp, and provider-fingerprint bindings. */
function assertOriginalProposal(
  proposal: GoogleAdsMutationProposal,
  stored: McpPreparedWriteProposal,
  operation: GoogleAdsMutation['kind'],
  configuration: GoogleAdsProviderConfiguration,
): void {
  const { fingerprint: _, ...immutableProposal } = proposal;
  if (
    proposal.fingerprint !== stored.fingerprint ||
    proposal.fingerprint !== createProposalFingerprint(immutableProposal) ||
    proposal.accountId !== configuration.allowedCustomerId ||
    proposal.accountId !== stored.accountId ||
    proposal.createdAt !== stored.createdAt ||
    proposal.mutation.kind !== operation ||
    !isSameGoogleAdsMcpChange(stored.change, toGoogleAdsMcpChangeDescriptor(proposal))
  )
    throw new Error('Google Ads prepared write integrity check failed.');
}
/*** Require the trusted MCP execution claim that owns approval consumption and intent identity. */
function assertExecutionClaim(context: McpToolExecutionContext): void {
  if (context.executionClaim === undefined)
    throw new Error('Google Ads writes require a trusted MCP execution claim.');
}
/*** Narrow JSON payload values before reconstructing the serializable Google Ads proposal. */
function isGoogleAdsProposal(value: unknown): value is GoogleAdsMutationProposal {
  return (
    isRecord(value) &&
    typeof value['accountId'] === 'string' &&
    typeof value['createdAt'] === 'string' &&
    typeof value['fingerprint'] === 'string' &&
    typeof value['resourceName'] === 'string' &&
    isRecord(value['mutation']) &&
    typeof value['mutation']['kind'] === 'string' &&
    isRecord(value['change']) &&
    'before' in value &&
    'after' in value
  );
}
/*** Recognize a JSON object without coercing values from the untrusted persisted payload. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
/*** Require a nonempty account identity for a write proposal. */
function requiredAccountId(value: Readonly<Record<string, unknown>>): string {
  const { accountId } = value;
  if (typeof accountId !== 'string' || accountId.length === 0)
    throw new Error('Google Ads accountId is required.');
  return accountId;
}
/*** Parse exactly the mutation grammar bound to a single write tool. */
function parseMutation(
  value: Readonly<Record<string, unknown>>,
  kind: 'create-keyword' | 'create-ad-group-negative-keyword' | 'set-budget',
): GoogleAdsMutation {
  if (kind === 'set-budget')
    return {
      amountMicros: requiredString(value, 'amountMicros'),
      campaignBudgetResourceName: requiredString(value, 'campaignBudgetResourceName'),
      kind,
    };
  return {
    adGroupResourceName: requiredString(value, 'adGroupResourceName'),
    kind,
    matchType: matchType(value),
    text: requiredString(value, 'text'),
  };
}
/*** Read a required JSON string without coercion. */
function requiredString(
  value: Readonly<Record<string, unknown>>,
  key: 'adGroupResourceName' | 'amountMicros' | 'campaignBudgetResourceName' | 'matchType' | 'text',
): string {
  const result = valueForRequiredStringKey(value, key);
  if (typeof result !== 'string' || result.length === 0)
    throw new Error(`Google Ads ${key} must be a nonempty string.`);
  return result;
}
/*** Select from the finite write grammar without a caller-controlled object lookup. */
function valueForRequiredStringKey(
  value: Readonly<Record<string, unknown>>,
  key: 'adGroupResourceName' | 'amountMicros' | 'campaignBudgetResourceName' | 'matchType' | 'text',
): unknown {
  switch (key) {
    case 'adGroupResourceName':
      return value['adGroupResourceName'];
    case 'amountMicros':
      return value['amountMicros'];
    case 'campaignBudgetResourceName':
      return value['campaignBudgetResourceName'];
    case 'matchType':
      return value['matchType'];
    case 'text':
      return value['text'];
  }
}
/*** Restrict matches to the core Google Ads contract. */
function matchType(value: Readonly<Record<string, unknown>>): 'BROAD' | 'EXACT' | 'PHRASE' {
  const result = requiredString(value, 'matchType');
  if (result === 'BROAD' || result === 'EXACT' || result === 'PHRASE') return result;
  throw new Error('Google Ads matchType must be BROAD, EXACT, or PHRASE.');
}
