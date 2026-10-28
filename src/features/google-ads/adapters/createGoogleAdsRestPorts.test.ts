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
        {
          results: [
            { campaign: { resourceName: 'customers/8810770460/campaigns/7', status: 'PAUSED' } },
          ],
        },
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
    values: { resourceName: 'customers/8810770460/campaigns/7', status: 'PAUSED' },
  });
  expect(fetchSpy).toHaveBeenLastCalledWith(
    'https://googleads.googleapis.com/v26/customers/8810770460/googleAds:searchStream',
    expect.objectContaining({
      body: JSON.stringify({
        query:
          "SELECT campaign.resource_name, campaign.status FROM campaign WHERE campaign.resource_name = 'customers/8810770460/campaigns/7'",
      }),
    }),
  );
}

/*** Keep every mutable v26 resource projection limited to fields owned by that resource. */
test('uses schema-grounded v26 read projections for every mutable resource', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch');
  const ports = createGoogleAdsRestPorts(configuration);
  const cases = [
    ['campaigns/7', 'campaign.resource_name, campaign.status'],
    ['adGroups/7', 'ad_group.resource_name, ad_group.status, ad_group.cpc_bid_micros'],
    ['campaignBudgets/7', 'campaign_budget.resource_name, campaign_budget.amount_micros'],
    [
      'adGroupCriteria/7',
      'ad_group_criterion.resource_name, ad_group_criterion.negative, ad_group_criterion.cpc_bid_micros, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type',
    ],
    [
      'campaignCriteria/7',
      'campaign_criterion.resource_name, campaign_criterion.negative, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type',
    ],
  ] as const;
  try {
    for (const [path, fields] of cases) {
      const resourceName = `customers/${configuration.allowedCustomerId}/${path}`;
      const resource = fields.split('.').at(0);
      if (resource === undefined) throw new Error('Fixture must declare a GAQL resource.');
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
      await ports.readResourceAsync({
        customerId: configuration.allowedCustomerId,
        resourceName,
      });
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            query: `SELECT ${fields} FROM ${resource} WHERE ${resource}.resource_name = '${resourceName}'`,
          }),
        }),
      );
    }
  } finally {
    fetchSpy.mockRestore();
  }
});

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
  await verifyForeignMutationRejectedAsync(ports);
  await verifyWrongResourceKindRejectedAsync(ports);
  expect(fetchSpy).toHaveBeenCalledTimes(2);
}

/*** Ensure resource names cannot escape the configured customer even on a permitted request URL. */
function verifyForeignMutationRejectedAsync(
  ports: ReturnType<typeof createGoogleAdsRestPorts>,
): Promise<void> {
  return assertRejectsAsync(
    () =>
      ports.mutateAsync({
        customerId: '8810770460',
        mutation: {
          campaignResourceName: 'customers/other/campaigns/7',
          kind: 'set-campaign-status',
          status: 'PAUSED',
        },
        validateOnly: true,
      }),
    'outside',
  );
}

/*** Reject a permitted customer resource when its collection cannot carry the requested operation. */
function verifyWrongResourceKindRejectedAsync(
  ports: ReturnType<typeof createGoogleAdsRestPorts>,
): Promise<void> {
  return assertRejectsAsync(
    () =>
      ports.mutateAsync({
        customerId: '8810770460',
        mutation: {
          criterionResourceName: 'customers/8810770460/campaignCriteria/7',
          cpcBidMicros: '1000000',
          kind: 'set-keyword-cpc',
        },
        validateOnly: true,
      }),
    'kind',
  );
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
