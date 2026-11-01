import type { McpChangeDescriptor } from '@ankhorage/mcp/types';

import type { GoogleAdsMutationProposal } from '../types/googleAds.js';

/** Convert the core proposal into the host-owned approval descriptor without changing its binding. */
export function toGoogleAdsMcpChangeDescriptor(
  proposal: GoogleAdsMutationProposal,
): McpChangeDescriptor {
  return {
    after: proposal.after,
    before: proposal.before,
    resourceId: proposal.resourceName,
  };
}

/** Compare immutable JSON values without coercing or accepting non-serializable tool state. */
export function isSameGoogleAdsMcpChange(
  left: McpChangeDescriptor,
  right: McpChangeDescriptor,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Recognize only the exact post-read-back evidence result as a successful provider execution. */
export function isExecutedGoogleAdsMcpOutcome(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { outcome?: unknown }).outcome === 'executed'
  );
}
