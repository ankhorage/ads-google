import type { McpPreparedWriteProposal, McpToolExecutionContext } from '@ankhorage/mcp/types';

import type {
  GoogleAdsMutation,
  GoogleAdsMutationProposal,
  GoogleAdsProviderConfiguration,
} from '../types/googleAds.js';

/*** Keep recovery indeterminate unless Google Ads supplies evidence bound to this exact mutation attempt. */
export function reconcileGoogleAdsMcpPreparedWriteAsync(input: {
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly context: McpToolExecutionContext;
  readonly kind: GoogleAdsMutation['kind'];
  readonly parseProposal: (stored: McpPreparedWriteProposal) => GoogleAdsMutationProposal;
  readonly stored: McpPreparedWriteProposal;
}): Promise<'executed' | 'indeterminate' | 'not_applied'> {
  try {
    assertRecoveryBinding(input.stored, input.context, input.kind);
    input.parseProposal(input.stored);
    // A resource read can establish only its current state. Google Ads v26 SearchStream does not
    // expose a request or operation identity that proves this recovered attempt caused that state.
    return Promise.resolve('indeterminate');
  } catch {
    return Promise.resolve('indeterminate');
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
