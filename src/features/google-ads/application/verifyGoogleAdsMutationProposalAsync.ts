import type { GoogleAdsMutationProposal } from '../../../types/googleAds.js';
import { createProposalFingerprint } from '../domain/createMutationFingerprint.js';
import type { GoogleAdsReadPort } from '../ports/googleAdsPorts.js';

/*** Verify that an approved proposal still describes the current provider state without mutating it. */
export async function verifyGoogleAdsMutationProposalAsync(input: {
  readonly proposal: GoogleAdsMutationProposal;
  readonly reads: GoogleAdsReadPort;
}): Promise<boolean> {
  assertProposalIntegrity(input.proposal);
  if (input.proposal.mutation.kind.startsWith('create-'))
    return await hasNoDuplicateAsync(input.proposal, input.reads);
  return await hasExpectedBeforeStateAsync(input.proposal, input.reads);
}

/*** Reject an altered proposal before it can be used at the provider boundary. */
function assertProposalIntegrity(proposal: GoogleAdsMutationProposal): void {
  const { fingerprint: _, ...immutableProposal } = proposal;
  if (proposal.fingerprint !== createProposalFingerprint(immutableProposal))
    throw new Error('Google Ads proposal integrity check failed.');
}

/*** Require the persisted before-state to remain unchanged before an approved update can run. */
async function hasExpectedBeforeStateAsync(
  proposal: GoogleAdsMutationProposal,
  reads: GoogleAdsReadPort,
): Promise<boolean> {
  const current = await reads.readResourceAsync({
    customerId: proposal.accountId,
    resourceName: proposal.resourceName,
  });
  return JSON.stringify(current?.values ?? null) === JSON.stringify(proposal.before);
}

/*** Preserve the keyword uniqueness invariant at execution time without consuming any approval. */
async function hasNoDuplicateAsync(
  proposal: GoogleAdsMutationProposal,
  reads: GoogleAdsReadPort,
): Promise<boolean> {
  const { mutation } = proposal;
  if (!('text' in mutation)) return true;
  const parentResourceName =
    'adGroupResourceName' in mutation
      ? mutation.adGroupResourceName
      : mutation.campaignResourceName;
  const duplicates = await reads.findKeywordDuplicatesAsync({
    customerId: proposal.accountId,
    matchType: mutation.matchType,
    negative: mutation.kind !== 'create-keyword',
    parentResourceName,
    text: mutation.text,
  });
  return duplicates.length === 0;
}
