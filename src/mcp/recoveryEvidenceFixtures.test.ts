import { createHash } from 'node:crypto';

import { createMcpRegistry } from '@ankhorage/mcp';
import type {
  McpPreparedWriteProposal,
  McpPreparedWriteRecoveryClaim,
  McpPreparedWriteStore,
  McpWriteAuditEvent,
} from '@ankhorage/mcp/types';
import { spyOn } from 'bun:test';

import { createGoogleAdsMcpIntegration } from './index.js';

const accountId = '8810770460';
export const context = { actorId: 'operator', allowedAccounts: [accountId] };
export const budgetInput = {
  accountId,
  amountMicros: '30000000',
  campaignBudgetResourceName: `customers/${accountId}/campaignBudgets/7`,
};
export const keywordInput = {
  accountId,
  adGroupResourceName: `customers/${accountId}/adGroups/7`,
  matchType: 'EXACT',
  text: 'airport taxi',
};
export const executionClaim = { approvalId: 'approval-1', intentId: 'intent-1' };
export const recoveryContext = { ...context, executionClaim };

export function createRecoveryHost(input?: {
  readonly alterProposal?: (proposal: McpPreparedWriteProposal) => McpPreparedWriteProposal;
  readonly currentOutcome?: 'executed' | 'indeterminate' | 'not_applied';
}) {
  const state: { proposal?: McpPreparedWriteProposal; settlements: string[] } = { settlements: [] };
  const recoveryClaim: McpPreparedWriteRecoveryClaim = {
    ...executionClaim,
    recoveryId: 'recovery-1',
  };
  return {
    get proposal() {
      return state.proposal;
    },
    get settlements() {
      return state.settlements;
    },
    store: {
      claimApprovedWriteAndCreateIntentAsync: () => Promise.resolve(null),
      claimPreparedWriteRecoveryAsync: () => {
        const { proposal } = state;
        return Promise.resolve(
          proposal === undefined
            ? null
            : { ...stored(input?.alterProposal?.(proposal) ?? proposal), recoveryClaim },
        );
      },
      createPreparedWriteAsync: (proposal: McpPreparedWriteProposal) => {
        state.proposal = proposal;
        return Promise.resolve(stored(proposal));
      },
      readPreparedWriteRecoveryAsync: () =>
        Promise.resolve({ outcome: input?.currentOutcome ?? 'executing' }),
      settlePreparedWriteAsync: () => Promise.resolve(),
      settlePreparedWriteRecoveryAndRecordAuditAsync: ({
        outcome,
      }: {
        readonly outcome: string;
      }) => {
        state.settlements.push(outcome);
        return Promise.resolve();
      },
    } as McpPreparedWriteStore,
  };
}

export function createRegistry(store: McpPreparedWriteStore) {
  return createMcpRegistry({
    auditSink: { recordAsync: (_event: McpWriteAuditEvent) => Promise.resolve() },
    integrations: [
      createGoogleAdsMcpIntegration({
        configuration: {
          accessTokenAsync: () => Promise.resolve('test-token'),
          allowedCustomerId: accountId,
        },
        now: () => '2026-11-01T00:00:00.000Z',
        writeEnabled: true,
      }),
    ],
    preparedWriteStore: store,
  });
}

export function installGoogleAdsTransport(
  mode: 'confirmed' | 'conflicting' | 'invalid-json' | 'missing' | 'network-error',
) {
  const state = { calls: 0, mutations: 0, reads: 0, recovery: false };
  const transport = Object.assign(
    (url: string | URL | Request, init?: RequestInit) => {
      state.calls += 1;
      const body = typeof init?.body === 'string' ? init.body : '';
      if (requestUrl(url).includes(':mutate') || body.includes('"validateOnly"'))
        state.mutations += 1;
      if (!state.recovery && body.includes('ad_group_criterion.ad_group'))
        return Promise.resolve(json([]));
      if (state.recovery && mode === 'network-error')
        return Promise.reject(new Error('network unavailable'));
      state.reads += 1;
      if (state.recovery && mode === 'invalid-json')
        return Promise.resolve(new Response('{', { status: 200 }));
      if (state.recovery && mode === 'missing') return Promise.resolve(json([]));
      return Promise.resolve(
        json([
          {
            results: [
              {
                campaignBudget: {
                  amountMicros:
                    state.recovery && mode === 'conflicting' ? '1' : budgetInput.amountMicros,
                  resourceName: budgetInput.campaignBudgetResourceName,
                },
              },
            ],
          },
        ]),
      );
    },
    { preconnect: () => undefined },
  );
  const spy = spyOn(globalThis, 'fetch').mockImplementation(transport);
  return createTransportController(state, () => spy.mockRestore());
}

function createTransportController(
  state: { calls: number; mutations: number; reads: number; recovery: boolean },
  restore: () => void,
) {
  return {
    get calls() {
      return state.calls;
    },
    get mutations() {
      return state.mutations;
    },
    get reads() {
      return state.reads;
    },
    reset: () => {
      state.calls = 0;
      state.mutations = 0;
      state.reads = 0;
      state.recovery = true;
    },
    restore,
  };
}

function stored(proposal: McpPreparedWriteProposal) {
  return {
    approvalId: executionClaim.approvalId,
    expiresAt: '2030-01-01T00:00:00.000Z',
    proposal,
    snapshotFingerprint: createHash('sha256')
      .update(JSON.stringify(sort(proposal)))
      .digest('hex'),
  };
}
function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort(item)]),
  );
}
function requestUrl(url: string | URL | Request): string {
  if (typeof url === 'string') return url;
  return url instanceof URL ? url.href : url.url;
}
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
