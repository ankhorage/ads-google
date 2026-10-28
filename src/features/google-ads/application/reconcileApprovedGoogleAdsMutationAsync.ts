import type {
  GoogleAdsApproval,
  GoogleAdsMutationAttempt,
  GoogleAdsMutationProposal,
  GoogleAdsMutationReconciliationResult,
} from '../../../types/googleAds.js';
import { createProposalFingerprint } from '../domain/createMutationFingerprint.js';
import type { GoogleAdsMutationAttemptPort, GoogleAdsReadPort } from '../ports/googleAdsPorts.js';
import { getGoogleAdsMutationEvidenceAsync } from './getGoogleAdsMutationEvidenceAsync.js';

/*** Settle only a host-persisted indeterminate attempt, without issuing another Google Ads mutation. */
export async function reconcileApprovedGoogleAdsMutationAsync(input: {
  readonly approval: GoogleAdsApproval;
  readonly attempts: GoogleAdsMutationAttemptPort;
  readonly proposal: GoogleAdsMutationProposal;
  readonly reads: GoogleAdsReadPort;
}): Promise<GoogleAdsMutationReconciliationResult> {
  assertProposalIntegrity(input.proposal, input.approval);
  const attempt = await input.attempts.claimIndeterminateAttemptAsync({
    approval: input.approval,
    proposal: input.proposal,
  });
  if (attempt === null)
    throw new Error('Google Ads indeterminate attempt was not available for reconciliation.');
  assertAttemptBinding(attempt, input.proposal, input.approval);
  try {
    const outcome = await getGoogleAdsMutationEvidenceAsync({
      proposal: input.proposal,
      providerResourceName: attempt.providerResourceName,
      reads: input.reads,
    });
    await completeReconciliationAsync(input.attempts, attempt, outcome);
    return outcome === 'indeterminate'
      ? { outcome, reason: 'Google Ads state is not causal evidence of this write attempt.' }
      : { outcome };
  } catch {
    await completeReconciliationAsync(input.attempts, attempt, 'indeterminate');
    return {
      outcome: 'indeterminate',
      reason: 'Google Ads reconciliation could not establish causal evidence.',
    };
  }
}

/*** Reject a proposal whose canonical timestamp, operation, or approval differs from the approved data. */
function assertProposalIntegrity(
  proposal: GoogleAdsMutationProposal,
  approval: GoogleAdsApproval,
): void {
  const { fingerprint: _, ...immutableProposal } = proposal;
  const fingerprint = createProposalFingerprint(immutableProposal);
  if (proposal.fingerprint !== fingerprint || approval.fingerprint !== fingerprint)
    throw new Error('Google Ads proposal integrity check failed.');
}

/*** Ensure the claimed durable record belongs to exactly this approval and immutable operation. */
function assertAttemptBinding(
  attempt: GoogleAdsMutationAttempt,
  proposal: GoogleAdsMutationProposal,
  approval: GoogleAdsApproval,
): void {
  if (
    attempt.approvalId !== approval.approvalId ||
    attempt.accountId !== proposal.accountId ||
    attempt.fingerprint !== proposal.fingerprint ||
    attempt.resourceName !== proposal.resourceName ||
    attempt.operation !== proposal.mutation.kind
  )
    throw new Error('Google Ads indeterminate attempt does not match the approved proposal.');
}

/*** Release or settle the exclusive reconciliation claim through one atomic host transition. */
async function completeReconciliationAsync(
  attempts: GoogleAdsMutationAttemptPort,
  attempt: GoogleAdsMutationAttempt,
  outcome: 'applied' | 'not-applied' | 'indeterminate',
): Promise<void> {
  if (!(await attempts.completeReconciliationAsync({ attempt, outcome })))
    throw new Error('Google Ads indeterminate attempt could not be settled.');
}
