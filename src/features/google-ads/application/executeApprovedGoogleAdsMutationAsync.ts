import type {
  GoogleAdsApproval,
  GoogleAdsMutationProposal,
  GoogleAdsReadResult,
} from '../../../types/googleAds.js';
import type {
  GoogleAdsApprovalPort,
  GoogleAdsAuditPort,
  GoogleAdsMutationPort,
  GoogleAdsReadPort,
} from '../ports/googleAdsPorts.js';

/*** Consume an external approval, audit intent, execute once, then re-read the changed resource. */
export async function executeApprovedGoogleAdsMutationAsync(input: {
  readonly approval: GoogleAdsApproval;
  readonly approvals: GoogleAdsApprovalPort;
  readonly audit: GoogleAdsAuditPort;
  readonly mutations: GoogleAdsMutationPort;
  readonly proposal: GoogleAdsMutationProposal;
  readonly reads: GoogleAdsReadPort;
}): Promise<void> {
  await assertUnchangedAsync(input);
  const approved = await input.approvals.consumeAsync({
    approval: input.approval,
    proposal: input.proposal,
  });
  if (!approved) throw new Error('Google Ads approval was rejected, expired, or already consumed.');
  await recordAuditAsync(input, 'intent');
  let result;
  try {
    result = await input.mutations.mutateAsync({
      customerId: input.proposal.accountId,
      mutation: input.proposal.mutation,
      validateOnly: false,
    });
  } catch (error) {
    await recordIndeterminateAsync(input, error);
    throw error;
  }
  try {
    const resourceName = result.resourceName ?? input.proposal.resourceName;
    const verified = await input.reads.readResourceAsync({
      customerId: input.proposal.accountId,
      resourceName,
    });
    if (!matchesExpectedState(input.proposal, verified))
      throw new Error('Google Ads post-write verification did not match the approved state.');
    await recordAuditAsync(input, 'executed');
  } catch (error) {
    await recordIndeterminateAsync(input, error);
    throw error;
  }
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

/*** Verify an absence for deletes and exact approved field values for every other operation. */
function matchesExpectedState(
  proposal: GoogleAdsMutationProposal,
  result: GoogleAdsReadResult | null,
): boolean {
  if (proposal.mutation.kind.startsWith('remove-')) return result === null;
  if (result === null || proposal.after === null) return false;
  return Object.entries(proposal.after).every(([key, value]) =>
    Object.entries(result.values).some(
      ([resultKey, resultValue]) =>
        resultKey === key && JSON.stringify(resultValue) === JSON.stringify(value),
    ),
  );
}

/*** Compare serialized provider snapshots deterministically without identity assumptions. */
function sameValues(
  left: Readonly<Record<string, unknown>> | null,
  right: Readonly<Record<string, unknown>> | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/*** Preserve a terminal indeterminate outcome without masking the provider failure. */
async function recordIndeterminateAsync(
  input: {
    readonly approval: GoogleAdsApproval;
    readonly audit: GoogleAdsAuditPort;
    readonly proposal: GoogleAdsMutationProposal;
  },
  error: unknown,
): Promise<void> {
  try {
    await recordAuditAsync(input, 'indeterminate');
  } catch {
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
  outcome: 'intent' | 'executed' | 'failed' | 'indeterminate',
): Promise<void> {
  return input.audit.recordAsync({
    accountId: input.proposal.accountId,
    approvalId: input.approval.approvalId,
    fingerprint: input.proposal.fingerprint,
    outcome,
    resourceName: input.proposal.resourceName,
  });
}
