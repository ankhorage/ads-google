import { createMcpRegistry } from '@ankhorage/mcp';
import { expect, spyOn, test } from 'bun:test';

import { createGoogleAdsMcpIntegration } from './index.js';

const configuration = {
  accessTokenAsync: () => Promise.resolve('access-token'),
  allowedCustomerId: '8810770460',
};

/** Expose only read and discovery tools until the trusted host explicitly enables prepared writes. */
test('exposes read and discovery tools without the legacy prepare mutation tool', () => {
  const registry = createMcpRegistry({
    integrations: [
      createGoogleAdsMcpIntegration({
        configuration,
      }),
    ],
  });
  expect(registry.listTools().map(({ toolId }) => toolId)).toEqual([
    'google-ads.list-ad-groups',
    'google-ads.list-campaign-negative-keywords',
    'google-ads.list-campaigns',
    'google-ads.list-keywords',
    'google-ads.list-negative-keywords',
    'google-ads.read-resource',
  ]);
});

/** Expose only canonical prepared-write definitions when the trusted host enables writes. */
test('exposes only canonical prepared-write definitions when writes are enabled', () => {
  const registry = createMcpRegistry({
    integrations: [createGoogleAdsMcpIntegration({ configuration, writeEnabled: true })],
  });
  const toolIds = registry.listTools().map(({ toolId }) => toolId);
  expect(toolIds).not.toContain('google-ads.prepare-mutation');
  expect(toolIds).toEqual([
    'google-ads.create-ad-group-negative-keyword',
    'google-ads.create-keyword',
    'google-ads.list-ad-groups',
    'google-ads.list-campaign-negative-keywords',
    'google-ads.list-campaigns',
    'google-ads.list-keywords',
    'google-ads.list-negative-keywords',
    'google-ads.read-resource',
    'google-ads.set-budget',
  ]);
});

/** Query campaign discovery through v26 while preserving account scope and mutable identifiers. */
test('discovers campaign resource IDs, budgets, and status without a mutation request', () => {
  const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(
      JSON.stringify([
        {
          results: [
            {
              campaign: {
                resourceName: 'customers/8810770460/campaigns/7',
                status: 'ENABLED',
              },
            },
          ],
        },
      ]),
      { status: 200 },
    ),
  );
  try {
    const registry = createMcpRegistry({
      integrations: [createGoogleAdsMcpIntegration({ configuration })],
    });
    expect(
      registry.executeAsync(
        'google-ads.list-campaigns',
        { accountId: '8810770460' },
        { actorId: 'test', allowedAccounts: ['8810770460'] },
      ),
    ).resolves.toEqual([
      {
        resourceName: 'customers/8810770460/campaigns/7',
        values: {
          resourceName: 'customers/8810770460/campaigns/7',
          status: 'ENABLED',
        },
      },
    ]);
    expect(fetchSpy.mock.calls[0]?.[1]?.body).toContain('campaign_budget.amount_micros');
    expect(
      fetchSpy.mock.calls.some(
        ([, init]) => typeof init?.body === 'string' && init.body.includes('validateOnly'),
      ),
    ).toBeFalse();
  } finally {
    fetchSpy.mockRestore();
  }
});
