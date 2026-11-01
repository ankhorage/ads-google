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

test('keeps a budget already at its target indeterminate when recovery has no causal mutation evidence', async () => {
  await expectIndeterminateBudgetRecoveryAsync('confirmed');
});

test('keeps a foreign actor setting the same budget target indeterminate', async () => {
  await expectIndeterminateBudgetRecoveryAsync('confirmed');
});

test('keeps a budget whose mutation was never started indeterminate despite its matching post-state', async () => {
  await expectIndeterminateBudgetRecoveryAsync('confirmed');
});

test('keeps a crash after the provider request indeterminate without its confirmed result', async () => {
  await expectIndeterminateBudgetRecoveryAsync('confirmed');
});

test('returns host-proven not_applied without provider recovery calls', async () => {
  const host = createRecoveryHost({ currentOutcome: 'not_applied' });
  const transport = installGoogleAdsTransport('confirmed');
  try {
    const registry = createRegistry(host.store, transport.transport);
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

test('does not treat missing, contradictory, or invalid observed provider evidence as causal', async () => {
  for (const mode of ['missing', 'conflicting', 'network-error', 'invalid-json'] as const) {
    await expectIndeterminateBudgetRecoveryAsync(mode);
  }
});

test('keeps create recovery indeterminate without a confirmed Google Ads resource ID', async () => {
  const host = createRecoveryHost();
  const transport = installGoogleAdsTransport('confirmed');
  try {
    const registry = createRegistry(host.store, transport.transport);
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
    const registry = createRegistry(tamperedHost.store, tamperedTransport.transport);
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
    const registry = createRegistry(host.store, transport.transport);
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

test('repeats recovery conservatively without a Google Ads read or mutate request', async () => {
  const host = createRecoveryHost();
  const transport = installGoogleAdsTransport('confirmed');
  try {
    const registry = createRegistry(host.store, transport.transport);
    await registry.prepareWriteAsync('google-ads.set-budget', budgetInput, context);
    transport.reset();
    const tool = registry.listTools().find((item) => item.toolId === 'google-ads.set-budget')?.tool;
    if (tool?.risk !== 'write' || host.proposal === undefined)
      throw new Error('Expected Google Ads write tool and proposal.');
    expect(await tool.reconcilePreparedWriteAsync?.(host.proposal, recoveryContext)).toBe(
      'indeterminate',
    );
    expect(await tool.reconcilePreparedWriteAsync?.(host.proposal, recoveryContext)).toBe(
      'indeterminate',
    );
    expect(transport.reads).toBe(0);
    expect(transport.mutations).toBe(0);
  } finally {
    transport.restore();
  }
});

/** Prove that recovery cannot upgrade any matching observed state without attempt-bound provider evidence. */
async function expectIndeterminateBudgetRecoveryAsync(
  mode: 'confirmed' | 'conflicting' | 'invalid-json' | 'missing' | 'network-error',
): Promise<void> {
  const host = createRecoveryHost();
  const transport = installGoogleAdsTransport(mode);
  try {
    const registry = createRegistry(host.store, transport.transport);
    await registry.prepareWriteAsync('google-ads.set-budget', budgetInput, context);
    transport.reset();
    expect(
      await registry.reconcilePreparedWriteAsync('google-ads.set-budget', executionClaim, context),
    ).toEqual({ outcome: 'indeterminate' });
    expect(host.settlements).toEqual(['indeterminate']);
    expect(transport.reads).toBe(0);
    expect(transport.mutations).toBe(0);
  } finally {
    transport.restore();
  }
}
