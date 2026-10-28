import { createHash } from 'node:crypto';

import type { GoogleAdsMutationProposal } from '../../../types/googleAds.js';

/*** Create a stable fingerprint over the complete immutable operation proposal. */
export function createMutationFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortValue(value)))
    .digest('hex');
}

/*** Recompute the immutable approval binding from the proposal that will be executed. */
export function createProposalFingerprint(
  proposal: Omit<GoogleAdsMutationProposal, 'createdAt' | 'fingerprint'>,
): string {
  return createMutationFingerprint(proposal);
}

/*** Recursively sort object keys so equivalent proposals have one fingerprint. */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  );
}
