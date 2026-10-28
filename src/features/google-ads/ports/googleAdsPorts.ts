import type {
  GoogleAdsApproval,
  GoogleAdsKeywordMatchType,
  GoogleAdsMutation,
  GoogleAdsMutationAttempt,
  GoogleAdsMutationProposal,
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

/*** Validates and applies an exact Google Ads mutation at the provider boundary. */
export interface GoogleAdsMutationPort {
  mutateAsync(input: {
    readonly customerId: string;
    readonly mutation: GoogleAdsMutation;
    readonly validateOnly: boolean;
  }): Promise<GoogleAdsMutationResult>;
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
  claimIndeterminateAttemptAsync(input: {
    readonly approval: GoogleAdsApproval;
    readonly proposal: GoogleAdsMutationProposal;
  }): Promise<GoogleAdsMutationAttempt | null>;
  completeReconciliationAsync(input: {
    readonly attempt: GoogleAdsMutationAttempt;
    readonly outcome: 'applied' | 'not-applied' | 'indeterminate';
  }): Promise<boolean>;
}
