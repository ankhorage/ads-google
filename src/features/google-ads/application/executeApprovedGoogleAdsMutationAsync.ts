import type { GoogleAdsApproval, GoogleAdsMutationProposal } from '../../../types/googleAds.js';
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
  const approved = await input.approvals.consumeAsync({
    approval: input.approval,
    proposal: input.proposal,
  });
  if (!approved) throw new Error('Google Ads approval was rejected, expired, or already consumed.');
  await recordAuditAsync(input, 'intent');
  try {
    await input.mutations.mutateAsync({
      customerId: input.proposal.accountId,
      mutation: input.proposal.mutation,
      validateOnly: false,
    });
  } catch (error) {
    await recordAuditAsync(input, 'indeterminate');
    throw error;
  }
  const verified = await input.reads.readResourceAsync({
    customerId: input.proposal.accountId,
    resourceName: input.proposal.resourceName,
  });
  if (verified === null && !input.proposal.mutation.kind.startsWith('remove-')) {
    await recordAuditAsync(input, 'failed');
    throw new Error('Google Ads post-write verification could not find the expected resource.');
  }
  await recordAuditAsync(input, 'executed');
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
