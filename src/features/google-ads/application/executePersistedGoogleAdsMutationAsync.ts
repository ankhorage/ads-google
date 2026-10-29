import type {
  GoogleAdsMutationExecutionResult,
  GoogleAdsMutationProposal,
} from '../../../types/googleAds.js';
import { createProposalFingerprint } from '../domain/createMutationFingerprint.js';
import type {
  GoogleAdsMutationAttemptPort,
  GoogleAdsMutationPort,
  GoogleAdsReadPort,
} from '../ports/googleAdsPorts.js';
import { getGoogleAdsMutationEvidenceAsync } from './getGoogleAdsMutationEvidenceAsync.js';

/** Execute exactly one host-persisted attempt; the MCP approval was already consumed before entry. */
export async function executePersistedGoogleAdsMutationAsync(input: {
  readonly approvalId: string;
  readonly attempts: GoogleAdsMutationAttemptPort;
  readonly mutations: GoogleAdsMutationPort;
  readonly proposal: GoogleAdsMutationProposal;
  readonly reads: GoogleAdsReadPort;
}): Promise<GoogleAdsMutationExecutionResult> {
  assertProposalIntegrity(input.proposal);
  const claim = await input.attempts.claimExecutionAsync({
    approvalId: input.approvalId,
    proposal: input.proposal,
  });
  if (claim === null)
    throw new Error(
      'Google Ads persisted attempt was unavailable, already claimed, or bound differently.',
    );
  try {
    const result = await input.mutations.mutateAsync({
      customerId: input.proposal.accountId,
      mutation: input.proposal.mutation,
      validateOnly: false,
    });
    if (result === undefined) return await markIndeterminateAsync(input.attempts, claim);
    const evidence = await getGoogleAdsMutationEvidenceAsync({
      proposal: input.proposal,
      providerResourceName: result.resourceName,
      reads: input.reads,
    });
    if (evidence === 'applied' && (await input.attempts.settleClaimedExecutionAsync({ claim })))
      return { outcome: 'executed' };
    return await markIndeterminateAsync(input.attempts, claim, result.resourceName);
  } catch {
    return await markIndeterminateAsync(input.attempts, claim);
  }
}

/** Reject an altered proposal before it can select a host-created attempt. */
function assertProposalIntegrity(proposal: GoogleAdsMutationProposal): void {
  const { fingerprint: _, ...immutableProposal } = proposal;
  if (proposal.fingerprint !== createProposalFingerprint(immutableProposal))
    throw new Error('Google Ads proposal integrity check failed.');
}

/** Preserve ambiguity durably so retry is reconciliation-only, never another provider mutation. */
async function markIndeterminateAsync(
  attempts: GoogleAdsMutationAttemptPort,
  claim: Parameters<
    GoogleAdsMutationAttemptPort['markClaimedExecutionIndeterminateAsync']
  >[0]['claim'],
  providerResourceName?: string,
): Promise<GoogleAdsMutationExecutionResult> {
  if (!(await attempts.markClaimedExecutionIndeterminateAsync({ claim, providerResourceName })))
    throw new Error('Google Ads outcome is indeterminate and could not be durably recorded.');
  return { outcome: 'indeterminate', reason: 'Google Ads mutation outcome could not be verified.' };
}
