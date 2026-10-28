import type { AdsChangeDescriptor, AdsProviderExtension } from '@ankhorage/contracts/ads';

/*** A Google Ads account explicitly permitted for one provider instance. */
export interface GoogleAdsProviderConfiguration {
  readonly allowedCustomerId: string;
  readonly developerToken: string;
  readonly accessToken: string;
  /** Google Ads v26 is the first supported runtime API version. */
  readonly apiVersion?: 'v26';
  readonly loginCustomerId?: string;
}

/*** Supported Google Ads keyword match modes. */
export type GoogleAdsKeywordMatchType = 'BROAD' | 'PHRASE' | 'EXACT';

/*** Explicit resources and fields that this provider can mutate. */
export type GoogleAdsMutation =
  | {
      readonly kind: 'create-keyword' | 'create-ad-group-negative-keyword';
      readonly adGroupResourceName: string;
      readonly text: string;
      readonly matchType: GoogleAdsKeywordMatchType;
    }
  | {
      readonly kind: 'create-campaign-negative-keyword';
      readonly campaignResourceName: string;
      readonly text: string;
      readonly matchType: GoogleAdsKeywordMatchType;
    }
  | {
      readonly kind:
        'remove-keyword' | 'remove-ad-group-negative-keyword' | 'remove-campaign-negative-keyword';
      readonly criterionResourceName: string;
    }
  | {
      readonly kind: 'set-keyword-cpc';
      readonly criterionResourceName: string;
      readonly cpcBidMicros: string;
    }
  | {
      readonly kind: 'set-ad-group-cpc';
      readonly adGroupResourceName: string;
      readonly cpcBidMicros: string;
    }
  | {
      readonly kind: 'set-budget';
      readonly campaignBudgetResourceName: string;
      readonly amountMicros: string;
    }
  | {
      readonly kind: 'set-campaign-status';
      readonly campaignResourceName: string;
      readonly status: 'ENABLED' | 'PAUSED';
    }
  | {
      readonly kind: 'set-ad-group-status';
      readonly adGroupResourceName: string;
      readonly status: 'ENABLED' | 'PAUSED';
    };

/*** Immutable proposal which must be approved outside this provider before execution. */
export interface GoogleAdsMutationProposal {
  readonly accountId: string;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly change: AdsChangeDescriptor;
  readonly createdAt: string;
  readonly fingerprint: string;
  readonly mutation: GoogleAdsMutation;
  readonly resourceName: string;
}

/*** A consumed external approval bound to exactly one proposed mutation. */
export interface GoogleAdsApproval {
  readonly approvalId: string;
  readonly fingerprint: string;
}

/*** The durable audit payload emitted around a write attempt. */
export interface GoogleAdsAuditEvent {
  readonly accountId: string;
  readonly approvalId?: string;
  readonly fingerprint: string;
  readonly outcome: 'intent' | 'executed' | 'failed' | 'indeterminate';
  readonly resourceName: string;
}

/*** Sanitized Google Ads read result retaining provider-only values explicitly. */
export interface GoogleAdsReadResult {
  readonly extensions?: readonly AdsProviderExtension[];
  readonly resourceName: string;
  readonly values: Readonly<Record<string, unknown>>;
}
