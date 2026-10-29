import { expect, test } from 'bun:test';

import { executePersistedGoogleAdsMutationAsync } from './executePersistedGoogleAdsMutationAsync.js';
import {
  approvalFor,
  createAttemptPort,
  createProposalForAsync,
  reads,
  resultFor,
} from './googleAdsMutationFixtures.test.js';

/** Claim a host-persisted attempt once, so parallel MCP replay cannot issue a second mutation. */
test('executes a host-persisted approval at most once without consuming it again', async () => {
  const proposal = await createProposalForAsync(
    {
      adGroupResourceName: 'customers/8810770460/adGroups/7',
      kind: 'create-keyword',
      matchType: 'EXACT',
      text: 'airport taxi',
    },
    reads(),
  );
  const attempts = createAttemptPort();
  await attempts.port.consumeApprovalAndCreateIntentAsync({
    approval: approvalFor(proposal),
    proposal,
  });
  let writes = 0;
  const execute = () =>
    executePersistedGoogleAdsMutationAsync({
      approvalId: 'approval-1',
      attempts: attempts.port,
      mutations: {
        mutateAsync: () => {
          writes += 1;
          return Promise.resolve(resultFor(proposal));
        },
      },
      proposal,
      reads: reads({ created: true }),
    });
  const outcomes = await Promise.allSettled([execute(), execute()]);
  expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  expect(writes).toBe(1);
});
