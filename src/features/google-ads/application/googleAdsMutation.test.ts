import { expect, test } from 'bun:test';

import type {
  GoogleAdsMutationAttempt,
  GoogleAdsMutationProposal,
} from '../../../types/googleAds.js';
import type { GoogleAdsMutationAttemptPort } from '../ports/googleAdsPorts.js';
import { executeApprovedGoogleAdsMutationAsync } from './executeApprovedGoogleAdsMutationAsync.js';
import { prepareGoogleAdsMutationAsync } from './prepareGoogleAdsMutationAsync.js';
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
        return Promise.resolve({});
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

/*** Reconciliation claims one attempt atomically, preventing duplicate settlements in parallel. */
test('prevents concurrent and repeated reconciliation settlement', async () => {
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
  await assertRejectsAsync(
    () =>
      reconcileApprovedGoogleAdsMutationAsync({
        approval: approvalFor(proposal),
        attempts: attempts.port,
        proposal,
        reads: reads(),
      }),
    'not available',
  );
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
        mutations: { mutateAsync: () => Promise.resolve({}) },
        proposal: { ...proposal, createdAt: '2030-01-01T00:00:00.000Z' },
        reads: reads(),
      }),
    'integrity',
  );
  expect(attempts.created).toBe(0);
});

/*** Prepare a deterministic fixture proposal. */
function createProposalAsync(): Promise<GoogleAdsMutationProposal> {
  return prepareGoogleAdsMutationAsync({
    customerId: '8810770460',
    mutation,
    now: () => '2026-10-28T00:00:00.000Z',
    mutations: { mutateAsync: () => Promise.resolve({}) },
    reads: reads(),
  });
}

/*** Create the only permitted persistent lifecycle test double. */
function createAttemptPort(): {
  readonly port: GoogleAdsMutationAttemptPort;
  readonly created: number;
} {
  const lifecycle: AttemptLifecycle = { created: 0, status: 'intent' };
  return {
    get created() {
      return lifecycle.created;
    },
    port: {
      consumeApprovalAndCreateIntentAsync: (input) => consumeIntentAsync(lifecycle, input),
      markIndeterminateAsync: (input) => markIndeterminateAsync(lifecycle, input),
      settleExecutedAsync: (input) => settleExecutedAsync(lifecycle, input),
      claimIndeterminateAttemptAsync: (input) => claimIndeterminateAttemptAsync(lifecycle, input),
      completeReconciliationAsync: (input) => completeReconciliationAsync(lifecycle, input),
    },
  };
}

interface AttemptLifecycle {
  created: number;
  attempt?: GoogleAdsMutationAttempt;
  status: 'intent' | 'indeterminate' | 'reconciling' | 'settled';
}

function consumeIntentAsync(
  lifecycle: AttemptLifecycle,
  {
    approval,
    proposal,
  }: Parameters<GoogleAdsMutationAttemptPort['consumeApprovalAndCreateIntentAsync']>[0],
) {
  if (lifecycle.attempt !== undefined || approval.fingerprint !== proposal.fingerprint)
    return Promise.resolve(null);
  lifecycle.created += 1;
  lifecycle.attempt = {
    accountId: proposal.accountId,
    approvalId: approval.approvalId,
    attemptId: 'attempt-1',
    fingerprint: proposal.fingerprint,
    operation: proposal.mutation.kind,
    resourceName: proposal.resourceName,
  };
  return Promise.resolve(lifecycle.attempt);
}

function markIndeterminateAsync(
  lifecycle: AttemptLifecycle,
  {
    attempt,
    providerResourceName,
  }: Parameters<GoogleAdsMutationAttemptPort['markIndeterminateAsync']>[0],
) {
  if (lifecycle.attempt?.attemptId !== attempt.attemptId || lifecycle.status !== 'intent')
    return Promise.resolve(false);
  lifecycle.attempt = {
    ...lifecycle.attempt,
    ...(providerResourceName === undefined ? {} : { providerResourceName }),
  };
  lifecycle.status = 'indeterminate';
  return Promise.resolve(true);
}

function settleExecutedAsync(
  lifecycle: AttemptLifecycle,
  { attempt }: Parameters<GoogleAdsMutationAttemptPort['settleExecutedAsync']>[0],
) {
  if (lifecycle.attempt?.attemptId !== attempt.attemptId || lifecycle.status !== 'intent')
    return Promise.resolve(false);
  lifecycle.status = 'settled';
  return Promise.resolve(true);
}

function claimIndeterminateAttemptAsync(
  lifecycle: AttemptLifecycle,
  {
    approval,
    proposal,
  }: Parameters<GoogleAdsMutationAttemptPort['claimIndeterminateAttemptAsync']>[0],
) {
  if (
    lifecycle.status !== 'indeterminate' ||
    lifecycle.attempt?.approvalId !== approval.approvalId ||
    lifecycle.attempt.fingerprint !== proposal.fingerprint ||
    lifecycle.attempt.accountId !== proposal.accountId
  )
    return Promise.resolve(null);
  lifecycle.status = 'reconciling';
  return Promise.resolve(lifecycle.attempt);
}

function completeReconciliationAsync(
  lifecycle: AttemptLifecycle,
  { attempt }: Parameters<GoogleAdsMutationAttemptPort['completeReconciliationAsync']>[0],
) {
  if (lifecycle.status !== 'reconciling' || lifecycle.attempt?.attemptId !== attempt.attemptId)
    return Promise.resolve(false);
  lifecycle.status = 'settled';
  return Promise.resolve(true);
}

/*** Execute one ambiguous write to persist a reconcilable attempt. */
function createIndeterminateAttemptAsync(
  proposal: GoogleAdsMutationProposal,
  attempts: GoogleAdsMutationAttemptPort,
): Promise<unknown> {
  return executeApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts,
    mutations: { mutateAsync: () => Promise.resolve({}) },
    proposal,
    reads: reads(),
  });
}

/*** Construct a proposal-bound external approval fixture. */
function approvalFor(proposal: GoogleAdsMutationProposal) {
  return { approvalId: 'approval-1', fingerprint: proposal.fingerprint };
}

/*** Return deterministic Google Ads read fixtures without making a live request. */
function reads(input: { readonly created?: boolean; readonly duplicate?: boolean } = {}) {
  return {
    findKeywordDuplicatesAsync: () =>
      Promise.resolve(
        input.duplicate
          ? [{ resourceName: 'customers/8810770460/adGroupCriteria/99', values: {} }]
          : [],
      ),
    readResourceAsync: ({ resourceName }: { readonly resourceName: string }) =>
      Promise.resolve(
        input.created
          ? {
              resourceName,
              values: { keyword: { matchType: 'EXACT', text: 'airport taxi' }, negative: false },
            }
          : null,
      ),
  };
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
