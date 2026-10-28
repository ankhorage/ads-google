import type { Mock } from 'bun:test';
import { expect, spyOn, test } from 'bun:test';

import { createGoogleAdsRestPorts } from './createGoogleAdsRestPorts.js';

const configuration = {
  accessToken: 'access-token-that-must-not-leak',
  allowedCustomerId: '8810770460',
  developerToken: 'developer-token-that-must-not-leak',
} as const;

type FetchSpy = Mock<typeof fetch>;

test('uses v26 fixtures for scoped reads, validate-only writes, and redacted failures', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch');
  const ports = createGoogleAdsRestPorts(configuration);
  try {
    await verifyScopedReadAsync(ports, fetchSpy);
    await verifyValidateOnlyMutationAsync(ports, fetchSpy);
    await verifyRedactedFailureAsync(ports, fetchSpy);
  } finally {
    fetchSpy.mockRestore();
  }
});

async function verifyScopedReadAsync(
  ports: ReturnType<typeof createGoogleAdsRestPorts>,
  fetchSpy: FetchSpy,
): Promise<void> {
  fetchSpy.mockResolvedValueOnce(
    new Response(
      JSON.stringify([
        { results: [{ campaign: { resourceName: 'customers/8810770460/campaigns/7' } }] },
      ]),
      { status: 200 },
    ),
  );
  const result = await ports.readResourceAsync({
    customerId: '8810770460',
    resourceName: 'customers/8810770460/campaigns/7',
  });
  expect(result).toEqual({
    resourceName: 'customers/8810770460/campaigns/7',
    values: { resourceName: 'customers/8810770460/campaigns/7' },
  });
  expect(fetchSpy).toHaveBeenLastCalledWith(
    'https://googleads.googleapis.com/v26/customers/8810770460/googleAds:searchStream',
    expect.objectContaining({
      body: JSON.stringify({
        query:
          "SELECT campaign.resource_name FROM campaign WHERE campaign.resource_name = 'customers/8810770460/campaigns/7'",
      }),
    }),
  );
}

async function verifyValidateOnlyMutationAsync(
  ports: ReturnType<typeof createGoogleAdsRestPorts>,
  fetchSpy: FetchSpy,
): Promise<void> {
  fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
  await ports.mutateAsync({
    customerId: '8810770460',
    mutation: {
      adGroupResourceName: 'customers/8810770460/adGroups/7',
      kind: 'create-ad-group-negative-keyword',
      matchType: 'PHRASE',
      text: 'free taxi',
    },
    validateOnly: true,
  });
  expect(fetchSpy).toHaveBeenLastCalledWith(
    'https://googleads.googleapis.com/v26/customers/8810770460/adGroupCriteria:mutate',
    expect.objectContaining({
      body: JSON.stringify({
        operations: [
          {
            create: {
              adGroup: 'customers/8810770460/adGroups/7',
              keyword: { matchType: 'PHRASE', text: 'free taxi' },
              negative: true,
            },
          },
        ],
        validateOnly: true,
      }),
    }),
  );
  await assertRejectsAsync(
    () =>
      ports.readResourceAsync({
        customerId: 'other-customer',
        resourceName: 'customers/other/campaigns/7',
      }),
    'outside',
  );
  expect(fetchSpy).toHaveBeenCalledTimes(2);
}

async function verifyRedactedFailureAsync(
  ports: ReturnType<typeof createGoogleAdsRestPorts>,
  fetchSpy: FetchSpy,
): Promise<void> {
  fetchSpy.mockResolvedValueOnce(new Response('failure', { status: 401 }));
  const error = await getErrorAsync(() =>
    ports.readResourceAsync({
      customerId: '8810770460',
      resourceName: 'customers/8810770460/campaigns/7',
    }),
  );
  expect(error.message).toContain('HTTP 401');
  expect(error.message).not.toContain('access-token-that-must-not-leak');
}

async function assertRejectsAsync(
  operation: () => Promise<unknown>,
  message: string,
): Promise<void> {
  const error = await getErrorAsync(operation);
  expect(error.message).toContain(message);
}

async function getErrorAsync(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('Expected an Error rejection.', { cause: error });
  }
  throw new Error('Expected operation to reject.');
}
