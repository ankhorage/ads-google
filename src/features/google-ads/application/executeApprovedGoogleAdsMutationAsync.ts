import type {
  GoogleAdsApproval,
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

/*** Consume approval with a durable intent before issuing exactly one Google Ads mutation. */
export async function executeApprovedGoogleAdsMutationAsync(input: {
  readonly approval: GoogleAdsApproval;
  readonly attempts: GoogleAdsMutationAttemptPort;
  readonly mutations: GoogleAdsMutationPort;
  readonly proposal: GoogleAdsMutationProposal;
  readonly reads: GoogleAdsReadPort;
}): Promise<GoogleAdsMutationExecutionResult> {
  assertProposalIntegrity(input.proposal, input.approval);
  await assertUnchangedAsync(input);
  const attempt = await input.attempts.consumeApprovalAndCreateIntentAsync({
    approval: input.approval,
    proposal: input.proposal,
  });
  if (attempt === null)
    throw new Error('Google Ads approval was rejected, expired, or already consumed.');
  try {
    const result = await input.mutations.mutateAsync({
      customerId: input.proposal.accountId,
      mutation: input.proposal.mutation,
      validateOnly: false,
    });
    if (result === undefined) return await recordIndeterminateAsync(input, attempt);
    const evidence = await getGoogleAdsMutationEvidenceAsync({
      proposal: input.proposal,
      providerResourceName: result.resourceName,
      reads: input.reads,
    });
    if (evidence === 'applied' && (await input.attempts.settleExecutedAsync({ attempt })))
      return { outcome: 'executed' };
    return await recordIndeterminateAsync(input, attempt, result.resourceName);
  } catch {
    return await recordIndeterminateAsync(input, attempt);
  }
}

/*** Reject locally tampered proposals before their trusted approval lifecycle is entered. */
function assertProposalIntegrity(
  proposal: GoogleAdsMutationProposal,
  approval: GoogleAdsApproval,
): void {
  const { fingerprint: _, ...immutableProposal } = proposal;
  const fingerprint = createProposalFingerprint(immutableProposal);
  if (proposal.fingerprint !== fingerprint || approval.fingerprint !== fingerprint)
    throw new Error('Google Ads proposal integrity check failed.');
}

/*** Re-read the approved target and reject proposals that changed before approval consumption. */
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
  if (JSON.stringify(current?.values ?? null) !== JSON.stringify(input.proposal.before))
    throw new Error('Google Ads proposal is stale and requires a new approval.');
}

/*** Re-check the keyword uniqueness invariant immediately before approval is atomically consumed. */
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

/*** Preserve an ambiguous outcome durably; no caller may use it to retry a Google Ads write. */
async function recordIndeterminateAsync(
  input: { readonly attempts: GoogleAdsMutationAttemptPort },
  attempt: Parameters<GoogleAdsMutationAttemptPort['markIndeterminateAsync']>[0]['attempt'],
  providerResourceName?: string,
): Promise<GoogleAdsMutationExecutionResult> {
  const recorded = await input.attempts.markIndeterminateAsync({ attempt, providerResourceName });
  if (!recorded)
    throw new Error('Google Ads outcome is indeterminate and could not be durably recorded.');
  return { outcome: 'indeterminate', reason: 'Google Ads mutation outcome could not be verified.' };
}
