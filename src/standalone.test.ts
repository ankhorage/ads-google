import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'bun:test';

const packageName = '@ankhorage/ads-google';
const mcpVersion = '0.4.0';

/** Exercise the packed public package through Node, Bun, and an actual MCP STDIO child process. */
test('installs the packed package into an isolated MCP consumer', async () => {
  const root = await mkdtemp(join(acceptanceTmpdir(), 'ads-google-standalone-'));
  let tarball: string | undefined;
  try {
    const environment = {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: join(root, 'bun-cache'),
      TMPDIR: join(root, 'tmp'),
      npm_config_cache: join(root, 'npm-cache'),
    };
    await runAsync(['mkdir', '-p', environment.BUN_INSTALL_CACHE_DIR, environment.TMPDIR]);
    await runAsync(['bun', 'run', 'build']);
    tarball = await packAsync();
    const consumer = join(root, 'consumer');
    await writeFile(join(root, 'package.json'), JSON.stringify({ private: true }));
    await runAsync(['mkdir', '-p', consumer]);
    await writeConsumerFilesAsync(consumer, tarball);
    await runAsync(['bun', 'install'], consumer, environment);
    await runAsync(['node', '--input-type=module', '--eval', importCheck], consumer);
    await runAsync(['bun', '--eval', importCheck], consumer);
    const { stdout } = await runAsync(['node', 'client.mjs'], consumer);
    expect(JSON.parse(stdout)).toEqual({ status: 'accepted' });
  } finally {
    await Promise.all([
      rm(root, { force: true, recursive: true }),
      ...(tarball === undefined ? [] : [rm(tarball, { force: true })]),
    ]);
  }
}, 60_000);

const importCheck = `await import('${packageName}'); await import('${packageName}/mcp');`;

/** Use an explicitly supplied writable parent when constrained runners cannot use their default temporary directory. */
function acceptanceTmpdir(): string {
  return process.env['ADS_GOOGLE_ACCEPTANCE_TMPDIR'] ?? tmpdir();
}

/** Create the tarball under the repository so Bun owns its lifecycle, then return its exact path. */
async function packAsync(): Promise<string> {
  const { stdout } = await runAsync(['bun', 'pm', 'pack']);
  const filename = stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.endsWith('.tgz'));
  if (filename === undefined || filename.length === 0)
    throw new Error('bun pm pack did not return a tarball.');
  return join(process.cwd(), filename);
}

/** Run one process and retain its output as test evidence without exposing it on success. */
function runAsync(
  command: string[],
  cwd = process.cwd(),
  env?: NodeJS.ProcessEnv,
): Promise<{ readonly stdout: string }> {
  const result = Bun.spawnSync(command, { cwd, env, stderr: 'pipe', stdout: 'pipe' });
  const stdout = new TextDecoder().decode(result.stdout);
  if (result.exitCode === 0) return Promise.resolve({ stdout });
  return Promise.reject(
    new Error(`${command.join(' ')} failed: ${new TextDecoder().decode(result.stderr)}`),
  );
}

/** Write the consumer manifest and the only two test-only process boundaries. */
async function writeConsumerFilesAsync(consumer: string, tarball: string): Promise<void> {
  await Promise.all([
    writeFile(
      join(consumer, 'package.json'),
      JSON.stringify({
        dependencies: { [packageName]: tarball, '@ankhorage/mcp': mcpVersion },
        private: true,
      }),
    ),
    writeFile(join(consumer, 'server.mjs'), serverSource),
    writeFile(join(consumer, 'client.mjs'), clientSource),
  ]);
}

const serverSource = String.raw`
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createMcpStdioServerAsync } from '@ankhorage/mcp';
import { createGoogleAdsMcpIntegration } from '@ankhorage/ads-google/mcp';
const file = process.argv[2];
const load = async () => JSON.parse(await readFile(file, 'utf8'));
const save = async (state) => writeFile(file, JSON.stringify(state));
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
globalThis.fetch = async (_url, init = {}) => {
  const state = await load();
  const body = typeof init.body === 'string' ? init.body : '';
  state.requests.push(body);
  if (body.includes('"validateOnly":false')) {
    state.mutations += 1;
    await save(state);
    if (state.indeterminate) throw new Error('simulated uncertain provider outcome');
    return new Response(JSON.stringify({ results: [{ resourceName: 'customers/8810770460/adGroupCriteria/99' }] }));
  }
  await save(state);
  if (body.includes('"validateOnly":true')) return new Response(JSON.stringify({}));
  if (body.includes('ad_group_criterion.ad_group =')) return new Response(JSON.stringify([]));
  return new Response(JSON.stringify([{ results: [{ adGroupCriterion: { keyword: { matchType: 'EXACT', text: 'airport taxi' }, negative: false, resourceName: 'customers/8810770460/adGroupCriteria/99' } }] }]));
};
const store = {
  async createPreparedWriteAsync(proposal) {
    const state = await load(); state.proposal = proposal; await save(state);
    return { approvalId: 'approval-1', expiresAt: '2030-01-01T00:00:00.000Z', proposal, snapshotFingerprint: fingerprint(proposal) };
  },
  async claimApprovedWriteAndCreateIntentAsync(input) {
    const state = await load(); const proposal = state.proposal;
    if (!state.approved || state.claimed || !proposal || input.approvalId !== 'approval-1' || input.actorId !== proposal.actorId || !input.allowedAccounts.includes(proposal.accountId) || input.toolId !== proposal.toolId) return null;
    state.claimed = true; await save(state);
    return { approvalId: 'approval-1', expiresAt: '2030-01-01T00:00:00.000Z', proposal, snapshotFingerprint: fingerprint(proposal), executionClaim: { approvalId: 'approval-1', intentId: 'intent-1' } };
  },
  async reconcilePreparedWriteAsync() { const state = await load(); return { outcome: state.settlement ?? 'executing' }; },
  async settlePreparedWriteAsync(settlement) { const state = await load(); state.settlement = settlement.outcome; state.settlements.push(settlement); await save(state); },
};
await createMcpStdioServerAsync({ auditSink: { async recordAsync(event) { const state = await load(); state.audit.push(event); await save(state); } }, context: { actorId: 'operator', allowedAccounts: ['8810770460'] }, integrations: [createGoogleAdsMcpIntegration({ configuration: { accessTokenAsync: async () => 'secret-access-token', allowedCustomerId: '8810770460' }, now: () => '2026-11-01T00:00:00.000Z', writeEnabled: process.argv[3] !== 'read-only' })], preparedWriteStore: store, version: 'test' });
`;

const clientSource = String.raw`
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const stateFile = new URL('./state.json', import.meta.url);
const input = { accountId: '8810770460', adGroupResourceName: 'customers/8810770460/adGroups/7', matchType: 'EXACT', text: 'airport taxi' };
const read = async () => JSON.parse(await readFile(stateFile, 'utf8'));
const write = async (state) => writeFile(stateFile, JSON.stringify(state));
const session = async (readOnly = false) => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['server.mjs', stateFile.pathname, ...(readOnly ? ['read-only'] : [])], cwd: process.cwd(), stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', (chunk) => { stderr += chunk; });
  const client = new Client({ name: 'packed-consumer', version: '1.0.0' }); await client.connect(transport);
  return { client, close: async () => { await client.close(); assert(!stderr.includes('secret-access-token')); } };
};
const text = (result) => result.content[0]?.text ?? '';
const call = async (client, name, args) => client.callTool({ name, arguments: args });
const initialize = async (indeterminate = false) => write({ approved: false, audit: [], claimed: false, indeterminate, mutations: 0, proposal: null, requests: [], settlement: null, settlements: [] });
const prepare = async (client) => call(client, 'google-ads.create-keyword.prepare', input);
const deny = async (client) => { const result = await call(client, 'google-ads.create-keyword.execute', { approvalId: 'approval-1' }); assert.equal(result.isError, true); };
await initialize();
{ const { client, close } = await session(true); const tools = await client.listTools(); assert(!tools.tools.some((tool) => tool.name === 'google-ads.create-keyword.execute')); await close(); }
await initialize();
{ const { client, close } = await session(); const tools = await client.listTools(); const names = tools.tools.map((tool) => tool.name); assert(names.includes('google-ads.list-campaigns') && names.includes('google-ads.create-keyword.prepare') && names.includes('google-ads.create-keyword.execute')); await call(client, 'google-ads.list-campaigns', { accountId: '8810770460' }); await prepare(client); const original = (await read()).proposal; let state = await read(); assert.equal(state.requests.filter((body) => body.includes('"validateOnly":true')).length, 1); assert.equal(state.requests.filter((body) => body.includes('"validateOnly":false')).length, 0); await deny(client); assert.equal((await read()).claimed, false); state = await read(); await write({ ...state, approved: true }); const executed = await call(client, 'google-ads.create-keyword.execute', { approvalId: 'approval-1' }); assert.equal(JSON.parse(text(executed)).outcome, 'executed'); state = await read(); assert.deepEqual(state.proposal, original); assert.equal(state.mutations, 1); assert.equal(state.settlement, 'executed'); await deny(client); assert.equal((await read()).mutations, 1); assert(!JSON.stringify(state).includes('secret-access-token')); await close(); }
for (const alter of [(state) => ({ ...state, proposal: { ...state.proposal, actorId: 'attacker' } }), (state) => ({ ...state, proposal: { ...state.proposal, accountId: 'other' } }), (state) => ({ ...state, proposal: { ...state.proposal, payload: { ...state.proposal.payload, serialized: state.proposal.payload.serialized.replace('airport taxi', 'tampered') } } })]) { await initialize(); const { client, close } = await session(); await prepare(client); const state = await read(); await write({ ...alter(state), approved: true }); await deny(client); assert.equal((await read()).mutations, 0); await close(); }
await initialize(true);
{ const { client, close } = await session(); await prepare(client); const state = await read(); await write({ ...state, approved: true }); const result = await call(client, 'google-ads.create-keyword.execute', { approvalId: 'approval-1' }); assert.equal(JSON.parse(text(result)).outcome, 'indeterminate'); const after = await read(); assert.equal(after.mutations, 1); assert.equal(after.settlement, 'indeterminate'); await deny(client); assert.equal((await read()).mutations, 1); await close(); }
process.stdout.write(JSON.stringify({ status: 'accepted' }));
`;
