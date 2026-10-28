export { createGoogleAdsRestPorts } from './features/google-ads/adapters/createGoogleAdsRestPorts.js';
export { executeApprovedGoogleAdsMutationAsync } from './features/google-ads/application/executeApprovedGoogleAdsMutationAsync.js';
export { prepareGoogleAdsMutationAsync } from './features/google-ads/application/prepareGoogleAdsMutationAsync.js';
export type {
  GoogleAdsApprovalPort,
  GoogleAdsAuditPort,
  GoogleAdsMutationPort,
  GoogleAdsReadPort,
} from './features/google-ads/ports/googleAdsPorts.js';
export type {
  GoogleAdsApproval,
  GoogleAdsAuditEvent,
  GoogleAdsMutation,
  GoogleAdsMutationProposal,
  GoogleAdsProviderConfiguration,
  GoogleAdsReadResult,
} from './types/googleAds.js';
