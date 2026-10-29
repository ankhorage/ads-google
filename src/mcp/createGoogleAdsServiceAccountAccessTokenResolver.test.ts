import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, spyOn, test } from 'bun:test';

import { createGoogleAdsRestPorts } from '../features/google-ads/adapters/createGoogleAdsRestPorts.js';
import { createGoogleAdsServiceAccountAccessTokenResolver } from './createGoogleAdsServiceAccountAccessTokenResolver.js';

/** Bind Google Auth to the selected service-account file instead of ambient ADC. */
test('uses only the host-selected service-account identity', async () => {
  const fixtures = createCredentialsFixtures();
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    toFetchImplementation((_input, init) => {
      const assertion = new URLSearchParams(formBody(init?.body)).get('assertion');
      expect(assertion).not.toBeNull();
      expect(serviceAccountAssertionPayload(assertion ?? '')).toContain(fixtures.selected.email);
      return Promise.resolve(tokenResponse('bound-token', 3600));
    }),
  );
  const originalApplicationCredentials = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  process.env['GOOGLE_APPLICATION_CREDENTIALS'] = fixtures.ambient.file;
  try {
    const accessTokenAsync = createGoogleAdsServiceAccountAccessTokenResolver({
      credentialsFile: fixtures.selected.file,
    });
    expect(await accessTokenAsync()).toBe('bound-token');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  } finally {
    if (originalApplicationCredentials === undefined)
      delete process.env['GOOGLE_APPLICATION_CREDENTIALS'];
    else process.env['GOOGLE_APPLICATION_CREDENTIALS'] = originalApplicationCredentials;
    fetchSpy.mockRestore();
    fixtures.dispose();
  }
});

/** Reject non-service-account configuration before it can select a credential flow or send a request. */
test('rejects another credential type without exposing its contents', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ads-google-auth-'));
  const credentialsFile = join(directory, 'not-a-service-account.json');
  const secret = 'credential-content-that-must-not-leak';
  writeFileSync(
    credentialsFile,
    JSON.stringify({ client_secret: secret, type: 'authorized_user' }),
    'utf8',
  );
  try {
    const error = (() => {
      try {
        createGoogleAdsServiceAccountAccessTokenResolver({ credentialsFile });
        return new Error('Expected service-account validation to fail.');
      } catch (reason) {
        return reason;
      }
    })();
    expect(error).toHaveProperty('message', 'Google Ads service-account configuration is invalid.');
    expect(error instanceof Error && error.message).not.toContain(secret);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** Refresh a cached Google Auth token before expiry and use its replacement for the next read request. */
test('refreshes the bearer token before expiry without exposing refresh failures or writing Google Ads', async () => {
  const fixtures = createCredentialsFixtures();
  const fetch = createRefreshFetch();
  const nowSpy = spyOn(Date.prototype, 'getTime');
  let now = 0;
  nowSpy.mockImplementation(() => now);
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(fetch.implementation);
  try {
    const accessTokenAsync = createGoogleAdsServiceAccountAccessTokenResolver({
      credentialsFile: fixtures.selected.file,
    });
    const ports = createGoogleAdsRestPorts({
      accessTokenAsync,
      allowedCustomerId: '8810770460',
    });
    await ports.listResourcesAsync({ customerId: '8810770460', kind: 'campaigns' });
    await ports.listResourcesAsync({ customerId: '8810770460', kind: 'campaigns' });
    now = 1001;
    await ports.listResourcesAsync({ customerId: '8810770460', kind: 'campaigns' });
    now = 2002;
    const error = await accessTokenAsync().then(
      () => new Error('Expected a refresh failure.'),
      (reason: unknown) => reason,
    );

    expect(fetch.tokenRequestCount()).toBeGreaterThanOrEqual(3);
    expect(fetch.sentAuthorizationHeaders).toEqual([
      'Bearer first-bearer-token',
      'Bearer first-bearer-token',
      'Bearer second-bearer-token',
    ]);
    expect(fetch.calledUrls.some((url) => url.includes(':mutate'))).toBe(false);
    expect(error).toHaveProperty(
      'message',
      'Google Ads service-account authentication did not return an access token.',
    );
    expect(error instanceof Error && error.message).not.toContain(
      'refresh-secret-that-must-not-leak',
    );
  } finally {
    fetchSpy.mockRestore();
    nowSpy.mockRestore();
    fixtures.dispose();
  }
});

function createCredentialsFixtures() {
  const directory = mkdtempSync(join(tmpdir(), 'ads-google-auth-'));
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const ambient = writeServiceAccountCredentials({
    directory,
    email: 'ambient-service-account@example.test',
    fileName: 'ambient.json',
    privateKey,
  });
  const selected = writeServiceAccountCredentials({
    directory,
    email: 'selected-service-account@example.test',
    fileName: 'selected.json',
    privateKey,
  });
  return { ambient, dispose: () => rmSync(directory, { force: true, recursive: true }), selected };
}

function writeServiceAccountCredentials(input: {
  readonly directory: string;
  readonly email: string;
  readonly fileName: string;
  readonly privateKey: string;
}) {
  const file = join(input.directory, input.fileName);
  writeFileSync(
    file,
    JSON.stringify({
      client_email: input.email,
      private_key: input.privateKey,
      private_key_id: 'test-key-id',
      type: 'service_account',
    }),
    'utf8',
  );
  return { email: input.email, file };
}

function serviceAccountAssertionPayload(assertion: string): string {
  const [, encodedPayload = ''] = assertion.split('.');
  return Buffer.from(encodedPayload, 'base64url').toString('utf8');
}

function tokenResponse(accessToken: string, expiresInSeconds: number): Response {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresInSeconds }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

function toFetchImplementation(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(implementation, { preconnect: globalThis.fetch.preconnect });
}

function formBody(body: unknown): string {
  return typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : '';
}

function createRefreshFetch() {
  const sentAuthorizationHeaders: string[] = [];
  const calledUrls: string[] = [];
  let requestCount = 0;
  return {
    calledUrls,
    implementation: toFetchImplementation((input, init) => {
      const url = requestUrl(input);
      calledUrls.push(url);
      if (url === 'https://oauth2.googleapis.com/token')
        return Promise.resolve(tokenResponseForRequest());
      sentAuthorizationHeaders.push(new Headers(init?.headers).get('Authorization') ?? '');
      return Promise.resolve(new Response(JSON.stringify([{ results: [] }]), { status: 200 }));
    }),
    sentAuthorizationHeaders,
    tokenRequestCount: () => requestCount,
  };

  function tokenResponseForRequest(): Response {
    requestCount += 1;
    if (requestCount >= 3)
      return new Response(JSON.stringify({ error: 'refresh-secret-that-must-not-leak' }), {
        status: 500,
      });
    return tokenResponse(requestCount === 1 ? 'first-bearer-token' : 'second-bearer-token', 301);
  }
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
