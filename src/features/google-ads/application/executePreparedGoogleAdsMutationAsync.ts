import type {
  GoogleAdsMutationExecutionResult,
  GoogleAdsMutationProposal,
} from '../../../types/googleAds.js';
import type { GoogleAdsMutationPort, GoogleAdsReadPort } from '../ports/googleAdsPorts.js';
import { getGoogleAdsMutationEvidenceAsync } from './getGoogleAdsMutationEvidenceAsync.js';

/*** Invoke one already host-claimed Google Ads proposal and report only verified completion. */
export async function executePreparedGoogleAdsMutationAsync(input: {
  readonly mutations: GoogleAdsMutationPort;
  readonly proposal: GoogleAdsMutationProposal;
  readonly reads: GoogleAdsReadPort;
}): Promise<GoogleAdsMutationExecutionResult> {
  try {
    const result = await input.mutations.mutateAsync({
      customerId: input.proposal.accountId,
      mutation: input.proposal.mutation,
      validateOnly: false,
    });
    if (result === undefined) return indeterminateResult();
    const evidence = await getGoogleAdsMutationEvidenceAsync({
      proposal: input.proposal,
      providerResourceName: result.resourceName,
      reads: input.reads,
    });
    return evidence === 'applied' ? { outcome: 'executed' } : indeterminateResult();
  } catch {
    return indeterminateResult();
  }
}

/*** Keep all post-provider uncertainty reconciliation-only under the MCP host lifecycle. */
function indeterminateResult(): GoogleAdsMutationExecutionResult {
  return { outcome: 'indeterminate', reason: 'Google Ads mutation outcome could not be verified.' };
}
