import type {
  GoogleAdsProvider,
  GoogleAdsProviderConfiguration,
} from '../../../types/googleAds.js';
import { createGoogleAdsRestPorts } from '../adapters/createGoogleAdsRestPorts.js';
import { executeApprovedGoogleAdsMutationAsync } from '../application/executeApprovedGoogleAdsMutationAsync.js';
import { reconcileApprovedGoogleAdsMutationAsync } from '../application/executeApprovedGoogleAdsMutationAsync.js';
import { prepareGoogleAdsMutationAsync } from '../application/prepareGoogleAdsMutationAsync.js';
import type { GoogleAdsApprovalPort, GoogleAdsAuditPort } from '../ports/googleAdsPorts.js';

/*** Compose the real v26 REST adapter behind the approval-gated public provider boundary. */
export function createGoogleAdsProvider(input: {
  readonly approvals: GoogleAdsApprovalPort;
  readonly audit: GoogleAdsAuditPort;
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly now?: () => string;
}): GoogleAdsProvider {
  const ports = createGoogleAdsRestPorts(input.configuration);
  const now = input.now ?? (() => new Date().toISOString());
  return {
    prepareMutationAsync: ({ customerId, mutation }) =>
      prepareGoogleAdsMutationAsync({ customerId, mutation, mutations: ports, now, reads: ports }),
    executeApprovedMutationAsync: ({ approval, proposal }) =>
      executeApprovedGoogleAdsMutationAsync({
        approval,
        approvals: input.approvals,
        audit: input.audit,
        mutations: ports,
        proposal,
        reads: ports,
      }),
    reconcileApprovedMutationAsync: ({ approval, proposal }) =>
      reconcileApprovedGoogleAdsMutationAsync({
        approval,
        audit: input.audit,
        proposal,
        reads: ports,
      }),
  };
}
