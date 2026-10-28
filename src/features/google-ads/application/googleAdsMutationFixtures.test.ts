import type {
  GoogleAdsMutation,
  GoogleAdsMutationAttempt,
  GoogleAdsMutationProposal,
} from '../../../types/googleAds.js';
import { createProposalFingerprint } from '../domain/createMutationFingerprint.js';
import type { GoogleAdsMutationAttemptPort } from '../ports/googleAdsPorts.js';
import { executeApprovedGoogleAdsMutationAsync } from './executeApprovedGoogleAdsMutationAsync.js';
import { prepareGoogleAdsMutationAsync } from './prepareGoogleAdsMutationAsync.js';

/*** Create a host lifecycle double that enforces the production claim invariants. */
export function createAttemptPort(): {
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
      claimRecoverableAttemptAsync: (input) => claimRecoverableAttemptAsync(lifecycle, input),
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

function claimRecoverableAttemptAsync(
  lifecycle: AttemptLifecycle,
  {
    approval,
    proposal,
  }: Parameters<GoogleAdsMutationAttemptPort['claimRecoverableAttemptAsync']>[0],
) {
  const { attempt } = lifecycle;
  if (
    (lifecycle.status !== 'indeterminate' && lifecycle.status !== 'intent') ||
    attempt?.approvalId !== approval.approvalId ||
    attempt.fingerprint !== proposal.fingerprint ||
    attempt.accountId !== proposal.accountId ||
    attempt.resourceName !== proposal.resourceName ||
    attempt.operation !== proposal.mutation.kind
  )
    return Promise.resolve(null);
  lifecycle.status = 'reconciling';
  return Promise.resolve({ attempt, fenceToken: 'claim-1' });
}

function completeReconciliationAsync(
  lifecycle: AttemptLifecycle,
  { claim, outcome }: Parameters<GoogleAdsMutationAttemptPort['completeReconciliationAsync']>[0],
) {
  if (
    lifecycle.status !== 'reconciling' ||
    lifecycle.attempt?.attemptId !== claim.attempt.attemptId ||
    claim.fenceToken !== 'claim-1'
  )
    return Promise.resolve(false);
  lifecycle.status = outcome === 'indeterminate' ? 'indeterminate' : 'settled';
  return Promise.resolve(true);
}

/*** Execute one ambiguous write to persist a reconcilable attempt. */
export function createIndeterminateAttemptAsync(
  proposal: GoogleAdsMutationProposal,
  attempts: GoogleAdsMutationAttemptPort,
): Promise<unknown> {
  return executeApprovedGoogleAdsMutationAsync({
    approval: approvalFor(proposal),
    attempts,
    mutations: { mutateAsync: () => Promise.reject(new Error('response lost after write')) },
    proposal,
    reads: reads(),
  });
}

/*** Prepare a proposal for a supported mutation against deterministic read fixtures. */
export function createProposalForAsync(
  operation: GoogleAdsMutation,
  readPort: ReturnType<typeof reads> | ReturnType<typeof readSequence>,
): Promise<GoogleAdsMutationProposal> {
  return prepareGoogleAdsMutationAsync({
    customerId: '8810770460',
    mutation: operation,
    now: () => '2026-10-28T00:00:00.000Z',
    mutations: {
      mutateAsync: () =>
        Promise.resolve({ resourceName: 'customers/8810770460/adGroupCriteria/validate-only' }),
    },
    reads: readPort,
  });
}

/*** Construct a proposal-bound external approval fixture. */
export function approvalFor(proposal: GoogleAdsMutationProposal) {
  return { approvalId: 'approval-1', fingerprint: proposal.fingerprint };
}

/*** Return deterministic Google Ads read fixtures without making a live request. */
export function reads(input: { readonly created?: boolean; readonly duplicate?: boolean } = {}) {
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

/*** Return one resource state per consecutive read, retaining the resource identity. */
export function readSequence(...values: readonly (Readonly<Record<string, unknown>> | null)[]) {
  let index = 0;
  return {
    findKeywordDuplicatesAsync: () => Promise.resolve([]),
    readResourceAsync: ({ resourceName }: { readonly resourceName: string }) => {
      const value = values.at(index) ?? null;
      index += 1;
      return Promise.resolve(value === null ? null : { resourceName, values: value });
    },
  };
}

/*** Return the canonical resource name that a successful v26 fixture would acknowledge. */
export function resultFor(proposal: GoogleAdsMutationProposal) {
  return {
    resourceName: `customers/${proposal.accountId}/${proposal.mutation.kind === 'create-campaign-negative-keyword' ? 'campaignCriteria' : 'adGroupCriteria'}/99`,
  };
}

/*** Rebind a deliberately different proposal so the host claim, rather than integrity, rejects it. */
export function proposalWith(
  proposal: GoogleAdsMutationProposal,
  patch: Partial<Omit<GoogleAdsMutationProposal, 'fingerprint'>>,
): GoogleAdsMutationProposal {
  const { fingerprint: _, ...immutableProposal } = { ...proposal, ...patch };
  return { ...immutableProposal, fingerprint: createProposalFingerprint(immutableProposal) };
}

/*** Assert that an async operation rejects with the expected safe message fragment. */
export async function assertRejectsAsync(
  operation: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error) {
      expectMessage(error, message);
      return;
    }
    throw error;
  }
  throw new Error('Expected operation to reject.');
}

function expectMessage(error: Error, message: string): void {
  if (!error.message.includes(message)) throw new Error(`Expected error containing ${message}.`);
}
