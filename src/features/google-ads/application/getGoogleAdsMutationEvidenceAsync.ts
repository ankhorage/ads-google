import type { GoogleAdsMutationProposal, GoogleAdsReadResult } from '../../../types/googleAds.js';
import type { GoogleAdsReadPort } from '../ports/googleAdsPorts.js';

/*** Return applied only for an acknowledged result identity whose approved post-state is readable. */
export async function getGoogleAdsMutationEvidenceAsync(input: {
  readonly proposal: GoogleAdsMutationProposal;
  readonly providerResourceName?: string;
  readonly reads: GoogleAdsReadPort;
}): Promise<'applied' | 'indeterminate'> {
  if (input.providerResourceName === undefined) return 'indeterminate';
  if (!matchesMutationResult(input.proposal, input.providerResourceName)) return 'indeterminate';
  const created = await input.reads.readResourceAsync({
    customerId: input.proposal.accountId,
    resourceName: input.providerResourceName,
  });
  if (input.proposal.mutation.kind.startsWith('remove-'))
    return created === null ? 'applied' : 'indeterminate';
  return matchesExpectedState(input.proposal, input.providerResourceName, created)
    ? 'applied'
    : 'indeterminate';
}

/*** Bind the only acknowledged v26 mutate result to the exact approved operation. */
function matchesMutationResult(proposal: GoogleAdsMutationProposal, resourceName: string): boolean {
  const expectedCollection = getExpectedResultCollection(proposal.mutation.kind);
  const resultPattern = new RegExp(
    `^customers/${escapeRegularExpression(proposal.accountId)}/${expectedCollection}/[^/]+$`,
  );
  if (!resultPattern.test(resourceName)) return false;
  return proposal.mutation.kind.startsWith('create-') || resourceName === proposal.resourceName;
}

/*** Map each supported operation to the collection returned by its v26 mutate result. */
function getExpectedResultCollection(
  mutation: GoogleAdsMutationProposal['mutation']['kind'],
): string {
  if (mutation === 'create-keyword' || mutation === 'create-ad-group-negative-keyword')
    return 'adGroupCriteria';
  if (mutation === 'create-campaign-negative-keyword') return 'campaignCriteria';
  if (mutation === 'remove-campaign-negative-keyword') return 'campaignCriteria';
  if (mutation === 'remove-keyword' || mutation === 'remove-ad-group-negative-keyword')
    return 'adGroupCriteria';
  if (mutation === 'set-keyword-cpc') return 'adGroupCriteria';
  if (mutation === 'set-ad-group-cpc' || mutation === 'set-ad-group-status') return 'adGroups';
  if (mutation === 'set-budget') return 'campaignBudgets';
  return 'campaigns';
}

/*** Escape a literal account identifier before using it in the fixed resource-name expression. */
function escapeRegularExpression(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/*** Compare every approved after-value to the exact resource identity returned by Google Ads. */
function matchesExpectedState(
  proposal: GoogleAdsMutationProposal,
  providerResourceName: string,
  result: GoogleAdsReadResult | null,
): boolean {
  if (result === null || proposal.after === null || result.resourceName !== providerResourceName)
    return false;
  return Object.entries(proposal.after).every(([key, value]) => {
    const actual = Object.entries(result.values).find(([resultKey]) => resultKey === key)?.[1];
    return JSON.stringify(actual) === JSON.stringify(value);
  });
}
