import type {
  GoogleAdsProvider,
  GoogleAdsProviderConfiguration,
} from '../../../types/googleAds.js';
import { createGoogleAdsRestPorts } from '../adapters/createGoogleAdsRestPorts.js';
import { executeApprovedGoogleAdsMutationAsync } from '../application/executeApprovedGoogleAdsMutationAsync.js';
import { prepareGoogleAdsMutationAsync } from '../application/prepareGoogleAdsMutationAsync.js';
import { reconcileApprovedGoogleAdsMutationAsync } from '../application/reconcileApprovedGoogleAdsMutationAsync.js';
import type { GoogleAdsMutationAttemptPort } from '../ports/googleAdsPorts.js';

/*** Compose the real v26 REST adapter behind the approval-gated public provider boundary. */
export function createGoogleAdsProvider(input: {
  readonly attempts: GoogleAdsMutationAttemptPort;
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
        attempts: input.attempts,
        mutations: ports,
        proposal,
        reads: ports,
      }),
    reconcileApprovedMutationAsync: ({ approval, proposal }) =>
      reconcileApprovedGoogleAdsMutationAsync({
        approval,
        attempts: input.attempts,
        proposal,
        reads: ports,
      }),
  };
}
