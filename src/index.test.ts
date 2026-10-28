import { expect, spyOn, test } from 'bun:test';

import { createGoogleAdsProvider } from './index.js';

/*** Construct the real REST-backed public provider without exposing its raw mutation port. */
test('exports an approval-gated public Google Ads provider factory', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ results: [{ resourceName: 'customers/8810770460/adGroupCriteria/99' }] }),
        { status: 200 },
      ),
    );
  try {
    const provider = createGoogleAdsProvider({
      attempts: {
        claimRecoverableAttemptAsync: () => Promise.resolve(null),
        completeReconciliationAsync: () => Promise.resolve(true),
        consumeApprovalAndCreateIntentAsync: () => Promise.resolve(null),
        markIndeterminateAsync: () => Promise.resolve(true),
        settleExecutedAsync: () => Promise.resolve(true),
      },
      configuration: {
        accessToken: 'access-token',
        allowedCustomerId: '8810770460',
        developerToken: 'developer-token',
      },
      now: () => '2026-10-29T00:00:00.000Z',
    });
    const proposal = await provider.prepareMutationAsync({
      customerId: '8810770460',
      mutation: {
        adGroupResourceName: 'customers/8810770460/adGroups/7',
        kind: 'create-keyword',
        matchType: 'EXACT',
        text: 'airport taxi',
      },
    });
    expect(proposal.fingerprint).toHaveLength(64);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect('mutateAsync' in provider).toBeFalse();
  } finally {
    fetchSpy.mockRestore();
  }
});
