import type { AdsChangeDescriptor } from '@ankhorage/contracts/ads';

import type { GoogleAdsMutation, GoogleAdsMutationProposal } from '../../../types/googleAds.js';
import {
  createMutationFingerprint,
  createProposalFingerprint,
} from '../domain/createMutationFingerprint.js';
import type { GoogleAdsMutationPort, GoogleAdsReadPort } from '../ports/googleAdsPorts.js';

/*** Read, diff, duplicate-check, and API-validate a mutation before external approval. */
export async function prepareGoogleAdsMutationAsync(input: {
  readonly customerId: string;
  readonly mutation: GoogleAdsMutation;
  readonly mutations: GoogleAdsMutationPort;
  readonly now: () => string;
  readonly reads: GoogleAdsReadPort;
}): Promise<GoogleAdsMutationProposal> {
  const resourceName = getMutationResourceName(input.mutation);
  const before = isCreateKeyword(input.mutation)
    ? null
    : await input.reads.readResourceAsync({ customerId: input.customerId, resourceName });
  if (before === null && !isCreateKeyword(input.mutation))
    throw new Error('Google Ads resource was not found.');
  if (isCreateKeyword(input.mutation))
    await assertNoDuplicateAsync(input.customerId, input.mutation, input.reads);
  const after = describeAfter(input.mutation, before?.values ?? null);
  const change = createChange(
    input.customerId,
    input.mutation,
    resourceName,
    before?.values ?? null,
    after,
  );
  const proposalWithoutFingerprint = {
    accountId: input.customerId,
    after,
    before: before?.values ?? null,
    change,
    createdAt: input.now(),
    mutation: input.mutation,
    resourceName,
  };
  const fingerprint = createProposalFingerprint(proposalWithoutFingerprint);
  const proposal = {
    fingerprint,
    ...proposalWithoutFingerprint,
  };
  await input.mutations.mutateAsync({
    customerId: input.customerId,
    mutation: input.mutation,
    validateOnly: true,
  });
  return proposal;
}

/*** Reject a keyword that Google Ads would otherwise add as a duplicate criterion. */
async function assertNoDuplicateAsync(
  customerId: string,
  mutation: Extract<GoogleAdsMutation, { readonly text: string }>,
  reads: GoogleAdsReadPort,
): Promise<void> {
  const parentResourceName =
    'adGroupResourceName' in mutation
      ? mutation.adGroupResourceName
      : mutation.campaignResourceName;
  const duplicates = await reads.findKeywordDuplicatesAsync({
    customerId,
    matchType: mutation.matchType,
    negative: mutation.kind !== 'create-keyword',
    parentResourceName,
    text: mutation.text,
  });
  if (duplicates.length > 0) throw new Error('Google Ads keyword duplicate detected.');
}

/*** Build a portable change record without exposing provider credentials or headers. */
function createChange(
  accountId: string,
  mutation: GoogleAdsMutation,
  resourceName: string,
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null,
): AdsChangeDescriptor {
  return {
    id: createMutationFingerprint({ accountId, mutation, resourceName }),
    operation: mutation.kind.startsWith('create-')
      ? 'create'
      : mutation.kind.startsWith('remove-')
        ? 'delete'
        : 'update',
    resource: { accountId, kind: getPortableResourceKind(mutation), resourceId: resourceName },
    extensions: [
      { provider: 'google-ads', values: { resourceKind: getGoogleResourceKind(mutation) } },
    ],
    stage: 'prepare',
    values: {
      after: JSON.stringify(after),
      before: JSON.stringify(before),
      operation: mutation.kind,
    },
  };
}

/*** Map each mutable Google resource to its truthful portable hierarchy kind. */
function getPortableResourceKind(mutation: GoogleAdsMutation): 'campaign' | 'ad-group' {
  return 'campaignResourceName' in mutation ||
    'campaignBudgetResourceName' in mutation ||
    ('criterionResourceName' in mutation &&
      mutation.criterionResourceName.includes('/campaignCriteria/'))
    ? 'campaign'
    : 'ad-group';
}

/*** Preserve the exact Google resource kind without falsifying the portable descriptor. */
function getGoogleResourceKind(mutation: GoogleAdsMutation): string {
  if ('criterionResourceName' in mutation)
    return mutation.criterionResourceName.includes('/campaignCriteria/')
      ? 'campaign-criterion'
      : 'ad-group-criterion';
  if ('campaignBudgetResourceName' in mutation) return 'campaign-budget';
  if ('campaignResourceName' in mutation) return 'campaign';
  return 'ad-group';
}

/*** Identify the single Google resource changed by a mutation. */
function getMutationResourceName(mutation: GoogleAdsMutation): string {
  if ('criterionResourceName' in mutation) return mutation.criterionResourceName;
  if ('campaignBudgetResourceName' in mutation) return mutation.campaignBudgetResourceName;
  if ('campaignResourceName' in mutation) return mutation.campaignResourceName;
  return mutation.adGroupResourceName;
}

/*** Identify mutations whose target does not exist until the API creates it. */
function isCreateKeyword(
  mutation: GoogleAdsMutation,
): mutation is Extract<GoogleAdsMutation, { readonly text: string }> {
  return mutation.kind.startsWith('create-');
}

/*** Produce the exact changed fields for a reviewable before/after diff. */
function describeAfter(
  mutation: GoogleAdsMutation,
  before: Readonly<Record<string, unknown>> | null,
): Readonly<Record<string, unknown>> | null {
  if (mutation.kind.startsWith('remove-')) return null;
  if ('text' in mutation)
    return {
      keyword: { matchType: mutation.matchType, text: mutation.text },
      negative: mutation.kind !== 'create-keyword',
    };
  if (mutation.kind === 'set-keyword-cpc' || mutation.kind === 'set-ad-group-cpc')
    return { ...before, cpcBidMicros: mutation.cpcBidMicros };
  if (mutation.kind === 'set-budget') return { ...before, amountMicros: mutation.amountMicros };
  if ('status' in mutation) return { ...before, status: mutation.status };
  throw new Error('Unsupported Google Ads mutation state.');
}
