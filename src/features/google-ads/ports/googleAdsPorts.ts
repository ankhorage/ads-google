import type {
  GoogleAdsApproval,
  GoogleAdsAuditEvent,
  GoogleAdsKeywordMatchType,
  GoogleAdsMutation,
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

/*** Consumes a human approval which was issued by infrastructure outside this package. */
export interface GoogleAdsApprovalPort {
  consumeAsync(input: {
    readonly approval: GoogleAdsApproval;
    readonly proposal: GoogleAdsMutationProposal;
  }): Promise<boolean>;
}

/*** Persists audit intent and outcome durably; failures deliberately stop writes. */
export interface GoogleAdsAuditPort {
  recordAsync(event: GoogleAdsAuditEvent): Promise<void>;
}
