# Public API

## createGoogleAdsProvider

Kind: `function`
Module: `src/features/google-ads/composition/createGoogleAdsProvider.ts`
Source: `src/features/google-ads/composition/createGoogleAdsProvider.ts:12:1`

Compose the real v26 REST adapter behind the approval-gated public provider boundary.

### Signatures

- `(input: { readonly attempts: GoogleAdsMutationAttemptPort; readonly configuration: GoogleAdsProviderConfiguration; readonly now?: () => string; }) => GoogleAdsProvider`
  - input: `{ readonly attempts: GoogleAdsMutationAttemptPort; readonly configuration: GoogleAdsProviderConfiguration; readonly now?: () => string; }`
  - returns: `GoogleAdsProvider`

## executeApprovedGoogleAdsMutationAsync

Kind: `function`
Module: `src/features/google-ads/application/executeApprovedGoogleAdsMutationAsync.ts`
Source: `src/features/google-ads/application/executeApprovedGoogleAdsMutationAsync.ts:15:1`

Consume approval with a durable intent before issuing exactly one Google Ads mutation.

### Signatures

- `(input: { readonly approval: GoogleAdsApproval; readonly attempts: GoogleAdsMutationAttemptPort; readonly mutations: GoogleAdsMutationPort; readonly proposal: GoogleAdsMutationProposal; readonly reads: GoogleAdsReadPort; }) => Promise<GoogleAdsMutationExecutionResult>`
  - input: `{ readonly approval: GoogleAdsApproval; readonly attempts: GoogleAdsMutationAttemptPort; readonly mutations: GoogleAdsMutationPort; readonly proposal: GoogleAdsMutationProposal; readonly reads: GoogleAdsReadPort; }`
  - returns: `Promise<GoogleAdsMutationExecutionResult>`

## executePersistedGoogleAdsMutationAsync

Kind: `function`
Module: `src/features/google-ads/application/executePersistedGoogleAdsMutationAsync.ts`
Source: `src/features/google-ads/application/executePersistedGoogleAdsMutationAsync.ts:14:1`

### Signatures

- `(input: { readonly approvalId: string; readonly attempts: GoogleAdsMutationAttemptPort; readonly mutations: GoogleAdsMutationPort; readonly proposal: GoogleAdsMutationProposal; readonly reads: GoogleAdsReadPort; }) => Promise<GoogleAdsMutationExecutionResult>`
  - input: `{ readonly approvalId: string; readonly attempts: GoogleAdsMutationAttemptPort; readonly mutations: GoogleAdsMutationPort; readonly proposal: GoogleAdsMutationProposal; readonly reads: GoogleAdsReadPort; }`
  - returns: `Promise<GoogleAdsMutationExecutionResult>`

## GoogleAdsAccessTokenResolver

Kind: `unknown`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:14:1`

Resolve a short-lived OAuth access token immediately before a Google Ads API request.

## GoogleAdsApproval

Kind: `type`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:119:1`

A consumed external approval bound to exactly one proposed mutation.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| approvalId | property | `string` | yes |  |
| fingerprint | property | `string` | yes |  |

## GoogleAdsMutation

Kind: `unknown`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:20:1`

Explicit resources and fields that this provider can mutate.

## GoogleAdsMutationAttempt

Kind: `type`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:77:1`

A durable, approval-bound write attempt owned by the trusted host runtime.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| accountId | property | `string` | yes |  |
| approvalId | property | `string` | yes |  |
| attemptId | property | `string` | yes |  |
| fingerprint | property | `string` | yes |  |
| operation | property | `"create-keyword" \| "create-ad-group-negative-keyword" \| "create-campaign-negative-keyword" \| "remove-keyword" \| "remove-ad-group-negative-keyword" \| "remove-campaign-negative-keyword" \| "set-keyword-cpc" \| "set-ad-group-cpc" \| "set-budget" \| "set-campaign-status" \| "set-ad-group-status"` | yes |  |
| providerResourceName | property | `string \| undefined` | no |  |
| resourceName | property | `string` | yes |  |

## GoogleAdsMutationAttemptPort

Kind: `type`
Module: `src/features/google-ads/ports/googleAdsPorts.ts`
Source: `src/features/google-ads/ports/googleAdsPorts.ts:47:1`

Atomically consumes approval and persists the host-owned lifecycle of a Google Ads write attempt.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| claimExecutionAsync | method | `(input: { readonly approvalId: string; readonly proposal: GoogleAdsMutationProposal; }) => Promise<GoogleAdsMutationExecutionClaim \| null>` | yes | Atomically claim a host-persisted intent for its one normal provider invocation. |
| claimRecoverableAttemptAsync | method | `(input: { readonly approval: GoogleAdsApproval; readonly proposal: GoogleAdsMutationProposal; }) => Promise<GoogleAdsMutationReconciliationClaim \| null>` | yes | Atomically bind and lease only this approval's orphaned intent or indeterminate attempt.

The trusted host validates approval ID, account, fingerprint, resource, and operation in the
same transition, returns an opaque fencing token, and never causes another provider write. |
| completeReconciliationAsync | method | `(input: { readonly claim: GoogleAdsMutationReconciliationClaim; readonly outcome: "applied" \| "not-applied" \| "indeterminate"; }) => Promise<boolean>` | yes | Fence a reconciliation transition; indeterminate releases the lease, terminal outcomes settle it. |
| consumeApprovalAndCreateIntentAsync | method | `(input: { readonly approval: GoogleAdsApproval; readonly proposal: GoogleAdsMutationProposal; }) => Promise<GoogleAdsMutationAttempt \| null>` | yes |  |
| markClaimedExecutionIndeterminateAsync | method | `(input: { readonly claim: GoogleAdsMutationExecutionClaim; readonly providerResourceName?: string; }) => Promise<boolean>` | yes | Fence an ambiguous normal execution before handing it to reconciliation. |
| markIndeterminateAsync | method | `(input: { readonly attempt: GoogleAdsMutationAttempt; readonly providerResourceName?: string; }) => Promise<boolean>` | yes |  |
| settleClaimedExecutionAsync | method | `(input: { readonly claim: GoogleAdsMutationExecutionClaim; }) => Promise<boolean>` | yes | Settle only the current execution lease after exact post-write evidence. |
| settleExecutedAsync | method | `(input: { readonly attempt: GoogleAdsMutationAttempt; }) => Promise<boolean>` | yes |  |

## GoogleAdsMutationExecutionClaim

Kind: `type`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:94:1`

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| attempt | property | `GoogleAdsMutationAttempt` | yes |  |
| fenceToken | property | `string` | yes |  |

## GoogleAdsMutationExecutionResult

Kind: `unknown`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:100:1`

The terminal outcome of one approved mutation attempt.

## GoogleAdsMutationPort

Kind: `type`
Module: `src/features/google-ads/ports/googleAdsPorts.ts`
Source: `src/features/google-ads/ports/googleAdsPorts.ts:38:1`

Validates and applies an exact Google Ads mutation at the provider boundary.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| mutateAsync | method | `(input: { readonly customerId: string; readonly mutation: GoogleAdsMutation; readonly validateOnly: boolean; }) => Promise<GoogleAdsMutationResult \| undefined>` | yes |  |

## GoogleAdsMutationProposal

Kind: `type`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:65:1`

Immutable proposal which must be approved outside this provider before execution.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| accountId | property | `string` | yes |  |
| after | property | `Readonly<Record<string, unknown>> \| null` | yes |  |
| before | property | `Readonly<Record<string, unknown>> \| null` | yes |  |
| change | property | `AdsChangeDescriptor` | yes |  |
| createdAt | property | `string` | yes |  |
| fingerprint | property | `string` | yes |  |
| mutation | property | `GoogleAdsMutation` | yes |  |
| resourceName | property | `string` | yes |  |

## GoogleAdsMutationReconciliationClaim

Kind: `type`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:88:1`

An exclusively leased host-owned attempt recovery claim, fenced by an opaque token.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| attempt | property | `GoogleAdsMutationAttempt` | yes |  |
| fenceToken | property | `string` | yes |  |

## GoogleAdsMutationReconciliationResult

Kind: `unknown`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:108:1`

The evidence-based settlement of an indeterminate approved mutation.

## GoogleAdsMutationResult

Kind: `type`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:114:1`

The exact provider resource affected by one validated mutation.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| resourceName | property | `string` | yes |  |

## GoogleAdsProvider

Kind: `type`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:132:1`

The safe public Google Ads boundary: reads, preparation, approved execution, and reconciliation.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| executeApprovedMutationAsync | method | `(input: { readonly approval: GoogleAdsApproval; readonly proposal: GoogleAdsMutationProposal; }) => Promise<GoogleAdsMutationExecutionResult>` | yes |  |
| prepareMutationAsync | method | `(input: { readonly customerId: string; readonly mutation: GoogleAdsMutation; }) => Promise<GoogleAdsMutationProposal>` | yes |  |
| reconcileApprovedMutationAsync | method | `(input: { readonly approval: GoogleAdsApproval; readonly proposal: GoogleAdsMutationProposal; }) => Promise<GoogleAdsMutationReconciliationResult>` | yes |  |

## GoogleAdsProviderConfiguration

Kind: `type`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:4:1`

A Google Ads account explicitly permitted for one provider instance.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| accessTokenAsync | property | `GoogleAdsAccessTokenResolver` | yes |  |
| allowedCustomerId | property | `string` | yes |  |
| apiVersion | property | `"v26" \| undefined` | no |  |
| developerToken | property | `string \| undefined` | no |  |
| loginCustomerId | property | `string \| undefined` | no |  |

## GoogleAdsReadPort

Kind: `type`
Module: `src/features/google-ads/ports/googleAdsPorts.ts`
Source: `src/features/google-ads/ports/googleAdsPorts.ts:14:1`

Reads an exact Google Ads resource within an already isolated customer scope.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| findKeywordDuplicatesAsync | method | `(input: { readonly customerId: string; readonly matchType: GoogleAdsKeywordMatchType; readonly negative: boolean; readonly parentResourceName: string; readonly text: string; }) => Promise<readonly GoogleAdsReadResult[]>` | yes |  |
| readResourceAsync | method | `(input: { readonly customerId: string; readonly resourceName: string; }) => Promise<GoogleAdsReadResult \| null>` | yes |  |

## GoogleAdsReadResult

Kind: `type`
Module: `src/types/googleAds.ts`
Source: `src/types/googleAds.ts:125:1`

Sanitized Google Ads read result retaining provider-only values explicitly.

### Members

| Name | Kind | Type | Required | Description |
| --- | --- | --- | --- | --- |
| extensions | property | `readonly AdsProviderExtension[] \| undefined` | no |  |
| resourceName | property | `string` | yes |  |
| values | property | `Readonly<Record<string, unknown>>` | yes |  |

## prepareGoogleAdsMutationAsync

Kind: `function`
Module: `src/features/google-ads/application/prepareGoogleAdsMutationAsync.ts`
Source: `src/features/google-ads/application/prepareGoogleAdsMutationAsync.ts:11:1`

Read, diff, duplicate-check, and API-validate a mutation before external approval.

### Signatures

- `(input: { readonly customerId: string; readonly mutation: GoogleAdsMutation; readonly mutations: GoogleAdsMutationPort; readonly now: () => string; readonly reads: GoogleAdsReadPort; }) => Promise<GoogleAdsMutationProposal>`
  - input: `{ readonly customerId: string; readonly mutation: GoogleAdsMutation; readonly mutations: GoogleAdsMutationPort; readonly now: () => string; readonly reads: GoogleAdsReadPort; }`
  - returns: `Promise<GoogleAdsMutationProposal>`

## reconcileApprovedGoogleAdsMutationAsync

Kind: `function`
Module: `src/features/google-ads/application/reconcileApprovedGoogleAdsMutationAsync.ts`
Source: `src/features/google-ads/application/reconcileApprovedGoogleAdsMutationAsync.ts:12:1`

Settle only a host-persisted indeterminate attempt, without issuing another Google Ads mutation.

### Signatures

- `(input: { readonly approval: GoogleAdsApproval; readonly attempts: GoogleAdsMutationAttemptPort; readonly proposal: GoogleAdsMutationProposal; readonly reads: GoogleAdsReadPort; }) => Promise<GoogleAdsMutationReconciliationResult>`
  - input: `{ readonly approval: GoogleAdsApproval; readonly attempts: GoogleAdsMutationAttemptPort; readonly proposal: GoogleAdsMutationProposal; readonly reads: GoogleAdsReadPort; }`
  - returns: `Promise<GoogleAdsMutationReconciliationResult>`
