import type {
  GoogleAdsApproval,
  GoogleAdsKeywordMatchType,
  GoogleAdsMutation,
  GoogleAdsMutationAttempt,
  GoogleAdsMutationExecutionClaim,
  GoogleAdsMutationProposal,
  GoogleAdsMutationReconciliationClaim,
  GoogleAdsMutationResult,
  GoogleAdsReadResult,
} from '../../../types/googleAds.js';

/*** Reads an exact Google Ads resource within an already isolated customer scope. */
export interface GoogleAdsReadPort {
  readResourceAsync(input: {
    readonly customerId: string;
    readonly resourceName: string;
  }): Promise<GoogleAdsReadResult | null>;
  findKeywordDuplicatesAsync(input: {
    readonly customerId: string;
    readonly matchType: GoogleAdsKeywordMatchType;
    readonly negative: boolean;
    readonly parentResourceName: string;
    readonly text: string;
  }): Promise<readonly GoogleAdsReadResult[]>;
}

/*** Lists bounded mutable resource collections for agent discovery. */
export interface GoogleAdsDiscoveryPort {
  listResourcesAsync(input: {
    readonly customerId: string;
    readonly kind:
      'ad-groups' | 'campaign-negative-keywords' | 'campaigns' | 'keywords' | 'negative-keywords';
  }): Promise<readonly GoogleAdsReadResult[]>;
}

/*** Validates and applies an exact Google Ads mutation at the provider boundary. */
export interface GoogleAdsMutationPort {
  mutateAsync(input: {
    readonly customerId: string;
    readonly mutation: GoogleAdsMutation;
    readonly validateOnly: boolean;
  }): Promise<GoogleAdsMutationResult | undefined>;
}

/*** Atomically consumes approval and persists the host-owned lifecycle of a Google Ads write attempt. */
export interface GoogleAdsMutationAttemptPort {
  consumeApprovalAndCreateIntentAsync(input: {
    readonly approval: GoogleAdsApproval;
    readonly proposal: GoogleAdsMutationProposal;
  }): Promise<GoogleAdsMutationAttempt | null>;
  markIndeterminateAsync(input: {
    readonly attempt: GoogleAdsMutationAttempt;
    readonly providerResourceName?: string;
  }): Promise<boolean>;
  settleExecutedAsync(input: { readonly attempt: GoogleAdsMutationAttempt }): Promise<boolean>;
  /*** Atomically claim a host-persisted intent for its one normal provider invocation. */
  claimExecutionAsync(input: {
    readonly approvalId: string;
    readonly proposal: GoogleAdsMutationProposal;
  }): Promise<GoogleAdsMutationExecutionClaim | null>;
  /*** Fence an ambiguous normal execution before handing it to reconciliation. */
  markClaimedExecutionIndeterminateAsync(input: {
    readonly claim: GoogleAdsMutationExecutionClaim;
    readonly providerResourceName?: string;
  }): Promise<boolean>;
  /*** Settle only the current execution lease after exact post-write evidence. */
  settleClaimedExecutionAsync(input: {
    readonly claim: GoogleAdsMutationExecutionClaim;
  }): Promise<boolean>;
  /*** Atomically bind and lease only this approval's orphaned intent or indeterminate attempt.
   *
   * The trusted host validates approval ID, account, fingerprint, resource, and operation in the
   * same transition, returns an opaque fencing token, and never causes another provider write.
   */
  claimRecoverableAttemptAsync(input: {
    readonly approval: GoogleAdsApproval;
    readonly proposal: GoogleAdsMutationProposal;
  }): Promise<GoogleAdsMutationReconciliationClaim | null>;
  /*** Fence a reconciliation transition; indeterminate releases the lease, terminal outcomes settle it. */
  completeReconciliationAsync(input: {
    readonly claim: GoogleAdsMutationReconciliationClaim;
    readonly outcome: 'applied' | 'not-applied' | 'indeterminate';
  }): Promise<boolean>;
}
