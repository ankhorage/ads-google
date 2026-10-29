import type { GoogleAdsMutation } from '../../../types/googleAds.js';

/*** Reject a resource whose canonical Google collection cannot carry the requested mutation. */
export function assertGoogleAdsMutationResourceKind(
  mutation: GoogleAdsMutation,
  resourceName: string,
): void {
  const collection = resourceName.split('/').at(-2);
  if (collection !== getExpectedResourceCollection(mutation))
    throw new Error('Google Ads resource kind is inconsistent with the requested mutation.');
}

/*** Map each supported operation to the one canonical Google resource collection it may mutate. */
function getExpectedResourceCollection(mutation: GoogleAdsMutation): string {
  if (mutation.kind === 'create-keyword' || mutation.kind === 'create-ad-group-negative-keyword')
    return 'adGroups';
  if (mutation.kind === 'create-campaign-negative-keyword') return 'campaigns';
  if (mutation.kind === 'remove-keyword' || mutation.kind === 'remove-ad-group-negative-keyword')
    return 'adGroupCriteria';
  if (mutation.kind === 'remove-campaign-negative-keyword') return 'campaignCriteria';
  if (mutation.kind === 'set-keyword-cpc') return 'adGroupCriteria';
  if (mutation.kind === 'set-ad-group-cpc' || mutation.kind === 'set-ad-group-status')
    return 'adGroups';
  if (mutation.kind === 'set-budget') return 'campaignBudgets';
  return 'campaigns';
}
