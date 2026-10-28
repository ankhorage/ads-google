import type { GoogleAdsMutationProposal, GoogleAdsReadResult } from '../../../types/googleAds.js';
import type { GoogleAdsReadPort } from '../ports/googleAdsPorts.js';

/*** Return applied only when Google returned a created-resource identity and its exact approved state is readable.
 *
 * A stale or matching resource read, a missing criterion, and an unchanged pre-write value do not
 * identify the original request in Google Ads v26, so they remain indeterminate. This provider has
 * no authoritative negative acknowledgement or queryable request receipt and therefore never
 * derives `not-applied` from a read alone.
 */
export async function getGoogleAdsMutationEvidenceAsync(input: {
  readonly proposal: GoogleAdsMutationProposal;
  readonly providerResourceName?: string;
  readonly reads: GoogleAdsReadPort;
}): Promise<'applied' | 'indeterminate'> {
  if (
    !input.proposal.mutation.kind.startsWith('create-') ||
    input.providerResourceName === undefined
  )
    return 'indeterminate';
  const created = await input.reads.readResourceAsync({
    customerId: input.proposal.accountId,
    resourceName: input.providerResourceName,
  });
  return matchesExpectedState(input.proposal, created) ? 'applied' : 'indeterminate';
}

/*** Compare every approved after-value to the exact resource identity returned by Google Ads. */
function matchesExpectedState(
  proposal: GoogleAdsMutationProposal,
  result: GoogleAdsReadResult | null,
): boolean {
  if (result === null || proposal.after === null) return false;
  return Object.entries(proposal.after).every(([key, value]) => {
    const actual = Object.entries(result.values).find(([resultKey]) => resultKey === key)?.[1];
    return JSON.stringify(actual) === JSON.stringify(value);
  });
}
