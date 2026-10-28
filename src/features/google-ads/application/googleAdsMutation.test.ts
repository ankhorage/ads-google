import { expect, test } from 'bun:test';

import { executeApprovedGoogleAdsMutationAsync } from './executeApprovedGoogleAdsMutationAsync.js';
import { prepareGoogleAdsMutationAsync } from './prepareGoogleAdsMutationAsync.js';

const mutation = {
  adGroupResourceName: 'customers/8810770460/adGroups/7',
  kind: 'create-keyword' as const,
  matchType: 'EXACT' as const,
  text: 'airport taxi',
};

/*** Verify preparation reads first, rejects duplicates, and only validates the exact proposal. */
test('prepares an exact mutation with validate-only after reading its target', async () => {
  const calls: string[] = [];
  const proposal = await prepareGoogleAdsMutationAsync({
    customerId: '8810770460',
    mutation,
    mutations: {
      mutateAsync: ({ validateOnly }) => {
        calls.push(validateOnly ? 'validate' : 'write');
        return Promise.resolve();
      },
    },
    now: () => '2026-10-28T00:00:00.000Z',
    reads: {
      findKeywordDuplicatesAsync: () => Promise.resolve([]),
      readResourceAsync: () => {
        calls.push('read');
        return Promise.resolve(null);
      },
    },
  });
  expect(calls).toEqual(['read', 'validate']);
  expect(proposal.before).toBeNull();
  expect(proposal.after).toMatchObject({ text: 'airport taxi' });
});

/*** Reject duplicate criteria before validation or approval can be requested. */
test('rejects a duplicate keyword', async () => {
  await assertRejectsAsync(
    () =>
      prepareGoogleAdsMutationAsync({
        customerId: '8810770460',
        mutation,
        mutations: { mutateAsync: () => Promise.resolve() },
        now: () => '2026-10-28T00:00:00.000Z',
        reads: {
          findKeywordDuplicatesAsync: () =>
            Promise.resolve([
              { resourceName: 'customers/8810770460/adGroupCriteria/8', values: {} },
            ]),
          readResourceAsync: () => Promise.resolve(null),
        },
      }),
    'duplicate',
  );
});

/*** Ensure approval and durable intent are both mandatory before a write can occur. */
test('fails closed when external approval is rejected', async () => {
  const proposal = await createProposalAsync();
  const writes: boolean[] = [];
  await assertRejectsAsync(
    () =>
      executeApprovedGoogleAdsMutationAsync({
        approval: { approvalId: 'approval-1', fingerprint: proposal.fingerprint },
        approvals: { consumeAsync: () => Promise.resolve(false) },
        audit: { recordAsync: () => Promise.resolve() },
        mutations: {
          mutateAsync: ({ validateOnly }) => {
            writes.push(validateOnly);
            return Promise.resolve();
          },
        },
        proposal,
        reads: {
          findKeywordDuplicatesAsync: () => Promise.resolve([]),
          readResourceAsync: () =>
            Promise.resolve({ resourceName: proposal.resourceName, values: {} }),
        },
      }),
    'approval',
  );
  expect(writes).toEqual([]);
});

/*** Prepare a deterministic fixture proposal for approval-pipeline tests. */
function createProposalAsync() {
  return prepareGoogleAdsMutationAsync({
    customerId: '8810770460',
    mutation,
    now: () => '2026-10-28T00:00:00.000Z',
    mutations: { mutateAsync: () => Promise.resolve() },
    reads: {
      findKeywordDuplicatesAsync: () => Promise.resolve([]),
      readResourceAsync: () => Promise.resolve(null),
    },
  });
}

async function assertRejectsAsync(
  operation: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(message);
    return;
  }
  throw new Error('Expected operation to reject.');
}
