import type { McpPreparedWriteProposal, McpToolExecutionContext } from '@ankhorage/mcp/types';

import { createGoogleAdsRestPorts } from '../features/google-ads/adapters/createGoogleAdsRestPorts.js';
import { getGoogleAdsMutationEvidenceAsync } from '../features/google-ads/application/getGoogleAdsMutationEvidenceAsync.js';
import type {
  GoogleAdsMutation,
  GoogleAdsMutationProposal,
  GoogleAdsProviderConfiguration,
} from '../types/googleAds.js';

/*** Read causal provider evidence for a host-fenced proposal without invoking a Google Ads mutation. */
export async function reconcileGoogleAdsMcpPreparedWriteAsync(input: {
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly context: McpToolExecutionContext;
  readonly kind: GoogleAdsMutation['kind'];
  readonly parseProposal: (stored: McpPreparedWriteProposal) => GoogleAdsMutationProposal;
  readonly stored: McpPreparedWriteProposal;
}): Promise<'executed' | 'indeterminate' | 'not_applied'> {
  try {
    assertRecoveryBinding(input.stored, input.context, input.kind);
    const proposal = input.parseProposal(input.stored);
    const outcome = await getGoogleAdsMutationEvidenceAsync({
      proposal,
      providerResourceName: providerResourceNameForRecovery(proposal),
      reads: createGoogleAdsRestPorts(input.configuration),
    });
    return outcome === 'applied' ? 'executed' : 'indeterminate';
  } catch {
    return 'indeterminate';
  }
}

/*** Require the same account, actor, tool, operation, and host claim that the recovery fence authorized. */
function assertRecoveryBinding(
  stored: McpPreparedWriteProposal,
  context: McpToolExecutionContext,
  kind: GoogleAdsMutation['kind'],
): void {
  if (
    context.executionClaim === undefined ||
    stored.actorId !== context.actorId ||
    !context.allowedAccounts.includes(stored.accountId) ||
    stored.toolId !== `google-ads.${kind}`
  )
    throw new Error('Google Ads prepared write recovery binding is invalid.');
}

/*** Use only an approved pre-existing resource identity; creates lack causal recovery identity. */
function providerResourceNameForRecovery(proposal: GoogleAdsMutationProposal): string | undefined {
  return proposal.mutation.kind.startsWith('create-') ? undefined : proposal.resourceName;
}
