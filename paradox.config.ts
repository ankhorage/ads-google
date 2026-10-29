import { defineParadoxConfig } from '@ankhorage/paradox';

export default defineParadoxConfig({
  mode: 'write',
  docs: {
    description: 'Google Ads provider with externally approved, account-scoped mutations.',
    title: '@ankhorage/ads-google',
  },
  output: { dir: './paradox' },
  package: {
    entrypoints: ['src/index.ts'],
    root: '.',
  },
});
