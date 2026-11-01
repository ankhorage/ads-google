import { createHash } from 'node:crypto';

import { createMcpRegistry } from '@ankhorage/mcp';
import type {
  McpPreparedWriteProposal,
  McpPreparedWriteSettlement,
  McpPreparedWriteStore,
} from '@ankhorage/mcp/types';
import { expect, spyOn, test } from 'bun:test';

import type { GoogleAdsHttpTransport } from '../types/googleAds.js';
import { createGoogleAdsMcpIntegration } from './index.js';

const accountId = '8810770460';
const context = { actorId: 'operator', allowedAccounts: [accountId] };
const input = {
  accountId,
  adGroupResourceName: `customers/${accountId}/adGroups/7`,
  matchType: 'EXACT',
  text: 'airport taxi',
};

/** Exercise the public integration through the MCP registry and its trusted prepared-write host. */
test('preserves one original proposal and permits exactly one verified provider mutation', async () => {
  const host = createHost();
  const fetchSpy = installGoogleAdsTransport();
  try {
    const registry = createRegistry(host.store, fetchSpy);
    await registry.prepareWriteAsync('google-ads.create-keyword', input, context);
    const original = host.proposal;
    expect(original).toBeDefined();
    expect(
      await registry.executeAsync(
        'google-ads.create-keyword',
        { approvalId: 'approval-1' },
        context,
      ),
    ).toEqual({ outcome: 'executed' });
    expect(host.created).toBe(1);
    expect(host.proposal).toEqual(original);
    expect(host.settlements).toEqual(['executed']);
    expect(
      fetchSpy.mock.calls.filter(([, init]) => requestBody(init).includes('"validateOnly":false')),
    ).toHaveLength(1);
  } finally {
    fetchSpy.mockRestore();
  }
});

/** Reject each persisted binding change before the Google Ads mutation endpoint can be reached. */
test('rejects altered stored fingerprints, account, operation, resource, payload version, and proposal', async () => {
  for (const alter of [
    (proposal: McpPreparedWriteProposal) => ({ ...proposal, fingerprint: 'tampered' }),
    (proposal: McpPreparedWriteProposal) => ({ ...proposal, accountId: 'other' }),
    (proposal: McpPreparedWriteProposal) => ({ ...proposal, operation: 'set-budget' }),
    (proposal: McpPreparedWriteProposal) => ({
      ...proposal,
      change: { ...proposal.change, resourceId: `customers/${accountId}/adGroups/8` },
    }),
    (proposal: McpPreparedWriteProposal) => ({
      ...proposal,
      payload: { ...proposal.payload, version: 'tampered/v1' },
    }),
    (proposal: McpPreparedWriteProposal) => ({
      ...proposal,
      payload: {
        ...proposal.payload,
        serialized: proposal.payload.serialized.replace('airport taxi', 'tampered taxi'),
      },
    }),
  ]) {
    const host = createHost(alter);
    const fetchSpy = installGoogleAdsTransport();
    try {
      const registry = createRegistry(host.store, fetchSpy);
      await registry.prepareWriteAsync('google-ads.create-keyword', input, context);
      await assertRejectedAsync(
        registry.executeAsync('google-ads.create-keyword', { approvalId: 'approval-1' }, context),
      );
      expect(
        fetchSpy.mock.calls.filter(([, init]) =>
          requestBody(init).includes('"validateOnly":false'),
        ),
      ).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  }
});

/** Require the configured provider account even if a malicious host claims the proposal. */
test('rejects a proposal whose original account differs from configuration', async () => {
  const host = createHost((proposal) => ({ ...proposal, accountId: 'other' }));
  const fetchSpy = installGoogleAdsTransport();
  try {
    const registry = createRegistry(host.store, fetchSpy);
    await registry.prepareWriteAsync('google-ads.create-keyword', input, context);
    await assertRejectedAsync(
      registry.executeAsync('google-ads.create-keyword', { approvalId: 'approval-1' }, context),
    );
    expect(
      fetchSpy.mock.calls.filter(([, init]) => requestBody(init).includes('"validateOnly":false')),
    ).toHaveLength(0);
  } finally {
    fetchSpy.mockRestore();
  }
});

/** Model the host's atomic consume-and-claim transition so replay cannot create another provider call. */
function createHost(alter?: (proposal: McpPreparedWriteProposal) => McpPreparedWriteProposal): {
  readonly store: McpPreparedWriteStore;
  readonly created: number;
  readonly proposal: McpPreparedWriteProposal | undefined;
  readonly settlements: readonly string[];
} {
  const state: {
    claimed: boolean;
    created: number;
    proposal?: McpPreparedWriteProposal;
    settlements: string[];
  } = { claimed: false, created: 0, settlements: [] };
  return {
    get created() {
      return state.created;
    },
    get proposal() {
      return state.proposal;
    },
    get settlements() {
      return state.settlements;
    },
    store: createStore(state, alter),
  };
}

/** Create the host-owned persistence contract with one atomic approval claim. */
function createStore(
  state: {
    claimed: boolean;
    created: number;
    proposal?: McpPreparedWriteProposal;
    settlements: string[];
  },
  alter: ((proposal: McpPreparedWriteProposal) => McpPreparedWriteProposal) | undefined,
): McpPreparedWriteStore {
  return {
    createPreparedWriteAsync: (proposal) => {
      state.created += 1;
      state.proposal = proposal;
      return Promise.resolve(stored(proposal));
    },
    claimApprovedWriteAndCreateIntentAsync: ({ approvalId, actorId, allowedAccounts, toolId }) => {
      const { proposal } = state;
      if (
        state.claimed ||
        proposal === undefined ||
        approvalId !== 'approval-1' ||
        actorId !== proposal.actorId ||
        !allowedAccounts.includes(proposal.accountId) ||
        toolId !== proposal.toolId
      )
        return Promise.resolve(null);
      state.claimed = true;
      const claimed = alter?.(proposal) ?? proposal;
      return Promise.resolve({
        ...stored(claimed),
        executionClaim: { approvalId, intentId: 'intent-1' },
      });
    },
    settlePreparedWriteAsync: (settlement: McpPreparedWriteSettlement) => {
      state.settlements.push(settlement.outcome);
      return Promise.resolve();
    },
  };
}

/** Build a host record whose snapshot always matches its stored proposal, including adversarial storage tests. */
function stored(proposal: McpPreparedWriteProposal) {
  return {
    approvalId: 'approval-1',
    expiresAt: '2030-01-01T00:00:00.000Z',
    proposal,
    snapshotFingerprint: fingerprint(proposal),
  };
}

/** Mirror the public host snapshot contract without importing MCP internals. */
function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sort(value)))
    .digest('hex');
}

/** Canonicalize JSON values for the host's immutable snapshot fingerprint. */
function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sort(item)]),
  );
}

/** Compose writes explicitly; discovery remains tested through the default read-only integration. */
function createRegistry(store: McpPreparedWriteStore, transport: GoogleAdsHttpTransport) {
  return createMcpRegistry({
    auditSink: { recordAsync: () => Promise.resolve() },
    integrations: [
      createGoogleAdsMcpIntegration({
        configuration: {
          accessTokenAsync: () => Promise.resolve('secret-access-token'),
          allowedCustomerId: accountId,
        },
        now: () => '2026-11-01T00:00:00.000Z',
        transport,
        writeEnabled: true,
      }),
    ],
    preparedWriteStore: store,
  });
}

/** Provide deterministic Google Ads validate, verify, mutate, and read-back responses without credentials. */
function installGoogleAdsTransport() {
  const transport = Object.assign(
    (_url: string | URL | Request, init?: RequestInit) => {
      const body = requestBody(init);
      if (body.includes('"validateOnly":true')) return Promise.resolve(json({}));
      if (body.includes('"validateOnly":false'))
        return Promise.resolve(
          json({ results: [{ resourceName: `customers/${accountId}/adGroupCriteria/99` }] }),
        );
      if (body.includes('ad_group_criterion.ad_group =')) return Promise.resolve(json([]));
      return Promise.resolve(
        json([
          {
            results: [
              {
                adGroupCriterion: {
                  keyword: { matchType: 'EXACT', text: 'airport taxi' },
                  negative: false,
                  resourceName: `customers/${accountId}/adGroupCriteria/99`,
                },
              },
            ],
          },
        ]),
      );
    },
    { preconnect: () => undefined },
  );
  return spyOn({ fetch: globalThis.fetch }, 'fetch').mockImplementation(transport);
}

/** Read only textual request bodies from the fake Google Ads transport. */
function requestBody(init: RequestInit | BunFetchRequestInit | undefined): string {
  return typeof init?.body === 'string' ? init.body : '';
}

/** Assert that an untrusted stored proposal was rejected without exposing provider internals. */
async function assertRejectedAsync(operation: Promise<unknown>): Promise<void> {
  const result = await operation.then(
    () => false,
    () => true,
  );
  expect(result).toBeTrue();
}

/** Return a JSON HTTP success response for the fake Google Ads transport. */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}
