import { expect, test } from 'bun:test';

import type { GoogleAdsMutationProposal } from '../../../types/googleAds.js';
import { executeApprovedGoogleAdsMutationAsync } from './executeApprovedGoogleAdsMutationAsync.js';
import {
  approvalFor,
  assertRejectsAsync,
  createAttemptPort,
  createIndeterminateAttemptAsync,
  createProposalForAsync,
  proposalWith,
  reads,
  readSequence,
  resultFor,
} from './googleAdsMutationFixtures.test.js';
import { reconcileApprovedGoogleAdsMutationAsync } from './reconcileApprovedGoogleAdsMutationAsync.js';

const mutation = {
  adGroupResourceName: 'customers/8810770460/adGroups/7',
  kind: 'create-keyword' as const,
  matchType: 'EXACT' as const,
  text: 'airport taxi',
};

/*** Persist an indeterminate attempt after a lost response and never retry its mutation. */
test('keeps a lost response with a stale read indeterminate without another mutate request', async () => {
  const proposal = await createProposalAsync();
  const attempts = createAttemptPort();
  let writes = 0;
  const result = await executeApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts: attempts.port,
    mutations: {
      mutateAsync: () => {
        writes += 1;
        return Promise.reject(new Error('response lost after write'));
      },
    },
    proposal,
    reads: reads(),
  });
  expect(result.outcome).toBe('indeterminate');
  const reconciliation = await reconcileApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts: attempts.port,
    proposal,
    reads: reads({ duplicate: true }),
  });
  expect(reconciliation.outcome).toBe('indeterminate');
  expect(writes).toBe(1);
});

/*** Reconcile a persisted response identity after post-write verification failed, without retrying. */
test('settles a later exact returned-resource read as applied', async () => {
  const proposal = await createProposalAsync();
  const attempts = createAttemptPort();
  const execution = await executeApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts: attempts.port,
    mutations: {
      mutateAsync: () =>
        Promise.resolve({ resourceName: 'customers/8810770460/adGroupCriteria/99' }),
    },
    proposal,
    reads: reads(),
  });
  expect(execution.outcome).toBe('indeterminate');
  const reconciliation = await reconcileApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts: attempts.port,
    proposal,
    reads: reads({ created: true }),
  });
  expect(reconciliation).toEqual({ outcome: 'applied' });
});

/*** Reject reconciliation when no durable original write attempt exists. */
test('rejects reconciliation without a prior indeterminate attempt', async () => {
  const proposal = await createProposalAsync();
  await assertRejectsAsync(
    () =>
      reconcileApprovedGoogleAdsMutationAsync({
        approval: approvalFor(proposal),
        attempts: createAttemptPort().port,
        proposal,
        reads: reads(),
      }),
    'not available',
  );
});

/*** Reject approval, account, and fingerprint mismatches before reconciliation can claim an attempt. */
test('rejects mismatched reconciliation bindings', async () => {
  const proposal = await createProposalAsync();
  const attempts = createAttemptPort();
  await createIndeterminateAttemptAsync(proposal, attempts.port);
  await assertRejectsAsync(
    () =>
      reconcileApprovedGoogleAdsMutationAsync({
        approval: { approvalId: 'other', fingerprint: proposal.fingerprint },
        attempts: attempts.port,
        proposal,
        reads: reads(),
      }),
    'not available',
  );
  await assertRejectsAsync(
    () =>
      reconcileApprovedGoogleAdsMutationAsync({
        approval: approvalFor(proposal),
        attempts: attempts.port,
        proposal: { ...proposal, accountId: 'other' },
        reads: reads(),
      }),
    'integrity',
  );
});

/*** Require the trusted atomic claim to reject every durable binding mismatch without settling it. */
test('does not claim an attempt for a wrong approval, account, resource, or operation', async () => {
  const proposal = await createProposalAsync();
  for (const candidate of [
    { approval: { approvalId: 'other', fingerprint: proposal.fingerprint }, proposal },
    { approval: undefined, proposal: proposalWith(proposal, { accountId: 'other' }) },
    {
      approval: undefined,
      proposal: proposalWith(proposal, { resourceName: 'customers/8810770460/adGroups/8' }),
    },
    {
      approval: undefined,
      proposal: proposalWith(proposal, {
        mutation: {
          adGroupResourceName: 'customers/8810770460/adGroups/7',
          kind: 'create-ad-group-negative-keyword',
          matchType: 'EXACT',
          text: 'airport taxi',
        },
      }),
    },
  ]) {
    const attempts = createAttemptPort();
    await createIndeterminateAttemptAsync(proposal, attempts.port);
    await assertRejectsAsync(
      () =>
        reconcileApprovedGoogleAdsMutationAsync({
          approval: candidate.approval ?? approvalFor(candidate.proposal),
          attempts: attempts.port,
          proposal: candidate.proposal,
          reads: reads(),
        }),
      'not available',
    );
  }
});

/*** Reconciliation claims one attempt atomically and releases only an inconclusive claim. */
test('prevents concurrent claims while allowing a later reconciliation after indeterminate evidence', async () => {
  const proposal = await createProposalAsync();
  const attempts = createAttemptPort();
  await createIndeterminateAttemptAsync(proposal, attempts.port);
  const first = reconcileApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts: attempts.port,
    proposal,
    reads: reads(),
  });
  const second = reconcileApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts: attempts.port,
    proposal,
    reads: reads(),
  });
  const outcomes = await Promise.allSettled([first, second]);
  expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  const later = await reconcileApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts: attempts.port,
    proposal,
    reads: reads(),
  });
  expect(later.outcome).toBe('indeterminate');
});

/*** Bind createdAt to the canonical approval fingerprint. */
test('rejects a timestamp-tampered proposal before it can consume approval', async () => {
  const proposal = await createProposalAsync();
  const attempts = createAttemptPort();
  await assertRejectsAsync(
    () =>
      executeApprovedGoogleAdsMutationAsync({
        approval: approvalFor(proposal),
        attempts: attempts.port,
        mutations: { mutateAsync: () => Promise.resolve(resultFor(proposal)) },
        proposal: { ...proposal, createdAt: '2030-01-01T00:00:00.000Z' },
        reads: reads(),
      }),
    'integrity',
  );
  expect(attempts.created).toBe(0);
});

/*** Settle an acknowledged update only after its exact approved state is visible. */
test('settles an acknowledged update after v26 result and post-write state verification', async () => {
  const update = {
    campaignResourceName: 'customers/8810770460/campaigns/7',
    kind: 'set-campaign-status' as const,
    status: 'ENABLED' as const,
  };
  const before = { status: 'PAUSED' };
  const proposal = await createProposalForAsync(
    update,
    readSequence(before, before, { status: 'ENABLED' }),
  );
  const attempts = createAttemptPort();
  const result = await executeApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts: attempts.port,
    mutations: { mutateAsync: () => Promise.resolve({ resourceName: proposal.resourceName }) },
    proposal,
    reads: readSequence(before, { status: 'ENABLED' }),
  });
  expect(result).toEqual({ outcome: 'executed' });
});

/*** Settle an acknowledged delete only after the exact returned criterion is absent. */
test('settles an acknowledged delete after its exact criterion is absent', async () => {
  const remove = {
    criterionResourceName: 'customers/8810770460/adGroupCriteria/7',
    kind: 'remove-keyword' as const,
  };
  const present = { keyword: { matchType: 'EXACT', text: 'airport taxi' }, negative: false };
  const proposal = await createProposalForAsync(remove, readSequence(present, present, null));
  const attempts = createAttemptPort();
  const result = await executeApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts: attempts.port,
    mutations: { mutateAsync: () => Promise.resolve({ resourceName: proposal.resourceName }) },
    proposal,
    reads: readSequence(present, null),
  });
  expect(result).toEqual({ outcome: 'executed' });
});

/*** Keep wrong resource acknowledgements and wrong post-write values indeterminate. */
test('does not settle a malformed acknowledgement or an unverified post-write value', async () => {
  const proposal = await createProposalAsync();
  const attempts = createAttemptPort();
  const wrongResult = await executeApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts: attempts.port,
    mutations: { mutateAsync: () => Promise.resolve({ resourceName: proposal.resourceName }) },
    proposal,
    reads: reads({ created: true }),
  });
  expect(wrongResult.outcome).toBe('indeterminate');
  const secondProposal = await createProposalAsync();
  const wrongValue = await executeApprovedGoogleAdsMutationAsync({
    approval: approvalFor(secondProposal),
    attempts: createAttemptPort().port,
    mutations: { mutateAsync: () => Promise.resolve(resultFor(secondProposal)) },
    proposal: secondProposal,
    reads: reads(),
  });
  expect(wrongValue.outcome).toBe('indeterminate');
});

/*** Recover orphaned intents without ever sending another Google Ads mutate request. */
test('recovers crashes before, during, and after a mutation response conservatively', async () => {
  const proposal = await createProposalAsync();
  for (const stage of ['before', 'during', 'after'] as const) {
    const attempts = createAttemptPort();
    const attempt = await attempts.port.consumeApprovalAndCreateIntentAsync({
      approval: approvalFor(proposal),
      proposal,
    });
    expect(attempt).not.toBeNull();
    let writes = 0;
    const outcome = await reconcileApprovedGoogleAdsMutationAsync({
      approval: approvalFor(proposal),
      attempts: attempts.port,
      proposal,
      reads: stage === 'after' ? reads({ created: true }) : reads(),
    });
    writes += 0;
    expect(outcome.outcome).toBe('indeterminate');
    expect(writes).toBe(0);
  }
});

/*** Prepare a deterministic fixture proposal. */
function createProposalAsync(): Promise<GoogleAdsMutationProposal> {
  return createProposalForAsync(mutation, reads());
}
