import { createMcpRegistry } from '@ankhorage/mcp';
import { expect, spyOn, test } from 'bun:test';

import { createGoogleAdsMcpIntegration } from './index.js';

const configuration = {
  accessToken: 'access-token',
  allowedCustomerId: '8810770460',
  developerToken: 'developer-token',
};

/** Discover only account-scoped Google Ads read and validate-only tools from the published MCP API. */
test('exposes scoped read and proposal tools without credentials in their contracts', () => {
  const registry = createMcpRegistry({
    integrations: [
      createGoogleAdsMcpIntegration({
        configuration,
      }),
    ],
  });
  expect(registry.listTools().map(({ toolId }) => toolId)).toEqual([
    'google-ads.prepare-mutation',
    'google-ads.read-resource',
  ]);
});

/** Prepare a keyword proposal through validate-only and reject an account outside host scope. */
test('prepares an account-scoped keyword diff through validate-only', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
  try {
    const registry = createMcpRegistry({
      integrations: [
        createGoogleAdsMcpIntegration({
          configuration,
          now: () => '2026-10-29T00:00:00.000Z',
        }),
      ],
    });
    const output = await registry.executeAsync(
      'google-ads.prepare-mutation',
      {
        accountId: '8810770460',
        adGroupResourceName: 'customers/8810770460/adGroups/7',
        createdAt: '2030-01-01T00:00:00.000Z',
        kind: 'create-keyword',
        matchType: 'EXACT',
        text: 'airport taxi',
      },
      { actorId: 'test', allowedAccounts: ['8810770460'] },
    );
    expect(output).toMatchObject({
      accountId: '8810770460',
      before: null,
      createdAt: '2026-10-29T00:00:00.000Z',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  } finally {
    fetchSpy.mockRestore();
  }
});

/** Deny a request whose claimed account differs from the host-owned allow-list. */
test('rejects an account outside the host scope', async () => {
  const registry = createMcpRegistry({
    integrations: [createGoogleAdsMcpIntegration({ configuration })],
  });
  const error = await registry
    .executeAsync(
      'google-ads.prepare-mutation',
      {
        accountId: 'other',
        adGroupResourceName: 'customers/other/adGroups/7',
        kind: 'create-keyword',
        matchType: 'EXACT',
        text: 'airport taxi',
      },
      { actorId: 'test', allowedAccounts: ['8810770460'] },
    )
    .then(
      () => new Error('Expected scoped account denial.'),
      (reason: unknown) => reason,
    );
  expect(error).toHaveProperty('message', 'MCP request denied: account-not-allowed');
});
