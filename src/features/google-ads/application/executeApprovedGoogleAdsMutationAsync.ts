import type {
  GoogleAdsApproval,
  GoogleAdsAuditEvent,
  GoogleAdsMutationExecutionResult,
  GoogleAdsMutationProposal,
  GoogleAdsMutationReconciliationResult,
  GoogleAdsReadResult,
} from '../../../types/googleAds.js';
import { createProposalFingerprint } from '../domain/createMutationFingerprint.js';
import type {
  GoogleAdsApprovalPort,
  GoogleAdsAuditPort,
  GoogleAdsMutationPort,
  GoogleAdsReadPort,
} from '../ports/googleAdsPorts.js';

/*** Consume an approval once, execute exactly once, and return durable evidence or an indeterminate result. */
export async function executeApprovedGoogleAdsMutationAsync(input: {
  readonly approval: GoogleAdsApproval;
  readonly approvals: GoogleAdsApprovalPort;
  readonly audit: GoogleAdsAuditPort;
  readonly mutations: GoogleAdsMutationPort;
  readonly proposal: GoogleAdsMutationProposal;
  readonly reads: GoogleAdsReadPort;
}): Promise<GoogleAdsMutationExecutionResult> {
  assertProposalIntegrity(input.proposal, input.approval);
  await assertUnchangedAsync(input);
  const approved = await input.approvals.consumeAsync({
    approval: input.approval,
    proposal: input.proposal,
  });
  if (!approved) throw new Error('Google Ads approval was rejected, expired, or already consumed.');
  await recordAuditAsync(input, 'intent');
  try {
    const result = await input.mutations.mutateAsync({
      customerId: input.proposal.accountId,
      mutation: input.proposal.mutation,
      validateOnly: false,
    });
    const reconciliation = await reconcileStateAsync(input, result.resourceName);
    if (reconciliation === 'applied') {
      await recordAuditAsync(input, 'executed');
      return { outcome: 'executed' };
    }
    return await recordIndeterminateAsync(input, 'Post-write verification was not conclusive.');
  } catch (error) {
    return await recordIndeterminateAsync(input, getErrorMessage(error));
  }
}

/*** Re-read an already-consumed approved proposal without issuing another Google Ads mutation. */
export async function reconcileApprovedGoogleAdsMutationAsync(input: {
  readonly approval: GoogleAdsApproval;
  readonly audit: GoogleAdsAuditPort;
  readonly proposal: GoogleAdsMutationProposal;
  readonly reads: GoogleAdsReadPort;
}): Promise<GoogleAdsMutationReconciliationResult> {
  assertProposalIntegrity(input.proposal, input.approval);
  try {
    const outcome = await reconcileStateAsync(input);
    if (outcome === 'indeterminate')
      return {
        outcome,
        reason: 'The current provider state does not prove either approved outcome.',
      };
    await recordAuditAsync(input, `reconciled-${outcome}`);
    return { outcome };
  } catch (error) {
    return { outcome: 'indeterminate', reason: getErrorMessage(error) };
  }
}

/*** Reject locally tampered proposals before an external approval can be consumed. */
function assertProposalIntegrity(
  proposal: GoogleAdsMutationProposal,
  approval: GoogleAdsApproval,
): void {
  const { createdAt: _, fingerprint: __, ...immutableProposal } = proposal;
  const fingerprint = createProposalFingerprint(immutableProposal);
  if (proposal.fingerprint !== fingerprint || approval.fingerprint !== fingerprint)
    throw new Error('Google Ads proposal integrity check failed.');
}

/*** Re-read the approved target and reject proposals that changed after validation. */
async function assertUnchangedAsync(input: {
  readonly proposal: GoogleAdsMutationProposal;
  readonly reads: GoogleAdsReadPort;
}): Promise<void> {
  if (input.proposal.mutation.kind.startsWith('create-')) {
    await assertNoDuplicateAtExecutionAsync(input);
    return;
  }
  const current = await input.reads.readResourceAsync({
    customerId: input.proposal.accountId,
    resourceName: input.proposal.resourceName,
  });
  if (!sameValues(current?.values ?? null, input.proposal.before))
    throw new Error('Google Ads proposal is stale and requires a new approval.');
}

/*** Re-check a keyword uniqueness invariant immediately before consuming approval. */
async function assertNoDuplicateAtExecutionAsync(input: {
  readonly proposal: GoogleAdsMutationProposal;
  readonly reads: GoogleAdsReadPort;
}): Promise<void> {
  const { mutation } = input.proposal;
  if (!('text' in mutation)) return;
  const parentResourceName =
    'adGroupResourceName' in mutation
      ? mutation.adGroupResourceName
      : mutation.campaignResourceName;
  const duplicates = await input.reads.findKeywordDuplicatesAsync({
    customerId: input.proposal.accountId,
    matchType: mutation.matchType,
    negative: mutation.kind !== 'create-keyword',
    parentResourceName,
    text: mutation.text,
  });
  if (duplicates.length > 0)
    throw new Error('Google Ads proposal is stale because the keyword now exists.');
}

/*** Establish applied, not-applied, or indeterminate from the exact approved provider state. */
async function reconcileStateAsync(
  input: {
    readonly proposal: GoogleAdsMutationProposal;
    readonly reads: GoogleAdsReadPort;
  },
  createdResourceName?: string,
): Promise<'applied' | 'not-applied' | 'indeterminate'> {
  const { proposal } = input;
  const { mutation } = proposal;
  if (mutation.kind.startsWith('create-'))
    return await reconcileCreationAsync(input, createdResourceName);
  const result = await input.reads.readResourceAsync({
    customerId: proposal.accountId,
    resourceName: proposal.resourceName,
  });
  if (mutation.kind.startsWith('remove-')) return result === null ? 'applied' : 'not-applied';
  if (matchesExpectedState(proposal, result)) return 'applied';
  return sameValues(result?.values ?? null, proposal.before) ? 'not-applied' : 'indeterminate';
}

/*** Reconcile a create using its returned criterion ID when available, otherwise exact duplicate identity. */
async function reconcileCreationAsync(
  input: {
    readonly proposal: GoogleAdsMutationProposal;
    readonly reads: GoogleAdsReadPort;
  },
  createdResourceName?: string,
): Promise<'applied' | 'not-applied' | 'indeterminate'> {
  const { proposal } = input;
  const { mutation } = proposal;
  if (!('text' in mutation)) return 'indeterminate';
  if (createdResourceName !== undefined) {
    const created = await input.reads.readResourceAsync({
      customerId: proposal.accountId,
      resourceName: createdResourceName,
    });
    return matchesExpectedState(proposal, created) ? 'applied' : 'indeterminate';
  }
  const parentResourceName =
    'adGroupResourceName' in mutation
      ? mutation.adGroupResourceName
      : mutation.campaignResourceName;
  const matches = await input.reads.findKeywordDuplicatesAsync({
    customerId: proposal.accountId,
    matchType: mutation.matchType,
    negative: mutation.kind !== 'create-keyword',
    parentResourceName,
    text: mutation.text,
  });
  if (matches.length === 0) return 'not-applied';
  return matches.length === 1 ? 'applied' : 'indeterminate';
}

/*** Verify exact approved values without treating resource existence as sufficient evidence. */
function matchesExpectedState(
  proposal: GoogleAdsMutationProposal,
  result: GoogleAdsReadResult | null,
): boolean {
  if (result === null || proposal.after === null) return false;
  return Object.entries(proposal.after).every(([key, value]) => {
    const verified = Object.entries(result.values).find(([resultKey]) => resultKey === key)?.[1];
    return JSON.stringify(verified) === JSON.stringify(value);
  });
}

/*** Compare serialized provider snapshots deterministically without identity assumptions. */
function sameValues(
  left: Readonly<Record<string, unknown>> | null,
  right: Readonly<Record<string, unknown>> | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/*** Persist an indeterminate terminal record; callers must reconcile rather than retry the write. */
async function recordIndeterminateAsync(
  input: {
    readonly approval: GoogleAdsApproval;
    readonly audit: GoogleAdsAuditPort;
    readonly proposal: GoogleAdsMutationProposal;
  },
  reason: string,
): Promise<GoogleAdsMutationExecutionResult> {
  try {
    await recordAuditAsync(input, 'indeterminate');
    return { outcome: 'indeterminate', reason };
  } catch (error) {
    throw new Error('Google Ads outcome is indeterminate and could not be durably audited.', {
      cause: error,
    });
  }
}

/*** Record one durable, approval-bound audit outcome around a mutation attempt. */
function recordAuditAsync(
  input: {
    readonly approval: GoogleAdsApproval;
    readonly audit: GoogleAdsAuditPort;
    readonly proposal: GoogleAdsMutationProposal;
  },
  outcome: GoogleAdsAuditEvent['outcome'],
): Promise<void> {
  return input.audit.recordAsync({
    accountId: input.proposal.accountId,
    approvalId: input.approval.approvalId,
    fingerprint: input.proposal.fingerprint,
    outcome,
    resourceName: input.proposal.resourceName,
  });
}

/*** Render a safe reason from an unknown provider or audit error. */
function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Google Ads provider returned an unknown failure.';
}
