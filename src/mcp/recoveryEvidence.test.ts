import { expect, test } from 'bun:test';

import {
  budgetInput,
  context,
  createRecoveryHost,
  createRegistry,
  executionClaim,
  installGoogleAdsTransport,
  keywordInput,
  recoveryContext,
} from './recoveryEvidenceFixtures.test.js';

test('reconciles confirmed budget evidence through read-only Google Ads calls', async () => {
  const host = createRecoveryHost();
  const transport = installGoogleAdsTransport('confirmed');
  try {
    const registry = createRegistry(host.store);
    await registry.prepareWriteAsync('google-ads.set-budget', budgetInput, context);
    transport.reset();
    expect(
      await registry.reconcilePreparedWriteAsync('google-ads.set-budget', executionClaim, context),
    ).toEqual({
      outcome: 'executed',
    });
    expect(host.settlements).toEqual(['executed']);
    expect(transport.mutations).toBe(0);
    expect(transport.reads).toBe(1);
  } finally {
    transport.restore();
  }
});

test('returns host-proven not_applied without provider recovery calls', async () => {
  const host = createRecoveryHost({ currentOutcome: 'not_applied' });
  const transport = installGoogleAdsTransport('confirmed');
  try {
    const registry = createRegistry(host.store);
    await registry.prepareWriteAsync('google-ads.set-budget', budgetInput, context);
    transport.reset();
    expect(
      await registry.reconcilePreparedWriteAsync('google-ads.set-budget', executionClaim, context),
    ).toEqual({
      outcome: 'not_applied',
    });
    expect(host.settlements).toEqual([]);
    expect(transport.calls).toBe(0);
  } finally {
    transport.restore();
  }
});

test('keeps ambiguous recovery evidence indeterminate without a provider mutation', async () => {
  for (const mode of ['missing', 'conflicting', 'network-error', 'invalid-json'] as const) {
    const host = createRecoveryHost();
    const transport = installGoogleAdsTransport(mode);
    try {
      const registry = createRegistry(host.store);
      await registry.prepareWriteAsync('google-ads.set-budget', budgetInput, context);
      transport.reset();
      expect(
        await registry.reconcilePreparedWriteAsync(
          'google-ads.set-budget',
          executionClaim,
          context,
        ),
      ).toEqual({ outcome: 'indeterminate' });
      expect(host.settlements).toEqual(['indeterminate']);
      expect(transport.mutations).toBe(0);
    } finally {
      transport.restore();
    }
  }
});

test('keeps create recovery indeterminate without a confirmed Google Ads resource ID', async () => {
  const host = createRecoveryHost();
  const transport = installGoogleAdsTransport('confirmed');
  try {
    const registry = createRegistry(host.store);
    await registry.prepareWriteAsync('google-ads.create-keyword', keywordInput, context);
    transport.reset();
    expect(
      await registry.reconcilePreparedWriteAsync(
        'google-ads.create-keyword',
        executionClaim,
        context,
      ),
    ).toEqual({ outcome: 'indeterminate' });
    expect(host.settlements).toEqual(['indeterminate']);
    expect(transport.calls).toBe(0);
  } finally {
    transport.restore();
  }
});

test('keeps tampered proposals and mismatched actor bindings away from Google Ads', async () => {
  const tamperedHost = createRecoveryHost({
    alterProposal: (proposal) => ({ ...proposal, fingerprint: 'tampered' }),
  });
  const tamperedTransport = installGoogleAdsTransport('confirmed');
  try {
    const registry = createRegistry(tamperedHost.store);
    await registry.prepareWriteAsync('google-ads.set-budget', budgetInput, context);
    tamperedTransport.reset();
    expect(
      await registry.reconcilePreparedWriteAsync('google-ads.set-budget', executionClaim, context),
    ).toEqual({
      outcome: 'indeterminate',
    });
    expect(tamperedTransport.calls).toBe(0);
  } finally {
    tamperedTransport.restore();
  }

  const host = createRecoveryHost();
  const transport = installGoogleAdsTransport('confirmed');
  try {
    const registry = createRegistry(host.store);
    await registry.prepareWriteAsync('google-ads.set-budget', budgetInput, context);
    transport.reset();
    const rejected = await registry
      .reconcilePreparedWriteAsync('google-ads.set-budget', executionClaim, {
        ...context,
        actorId: 'other-actor',
      })
      .then(
        () => false,
        () => true,
      );
    expect(rejected).toBeTrue();
    expect(transport.calls).toBe(0);
  } finally {
    transport.restore();
  }
});

test('repeats recovery evidence as read-only without a Google Ads mutate request', async () => {
  const host = createRecoveryHost();
  const transport = installGoogleAdsTransport('confirmed');
  try {
    const registry = createRegistry(host.store);
    await registry.prepareWriteAsync('google-ads.set-budget', budgetInput, context);
    transport.reset();
    const tool = registry.listTools().find((item) => item.toolId === 'google-ads.set-budget')?.tool;
    if (tool?.risk !== 'write' || host.proposal === undefined)
      throw new Error('Expected Google Ads write tool and proposal.');
    expect(await tool.reconcilePreparedWriteAsync?.(host.proposal, recoveryContext)).toBe(
      'executed',
    );
    expect(await tool.reconcilePreparedWriteAsync?.(host.proposal, recoveryContext)).toBe(
      'executed',
    );
    expect(transport.reads).toBe(2);
    expect(transport.mutations).toBe(0);
  } finally {
    transport.restore();
  }
});
