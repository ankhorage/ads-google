import { expect, test } from 'bun:test';

import { createGoogleAdsRestPorts } from './createGoogleAdsRestPorts.js';

const configuration = {
  accessTokenAsync: () => Promise.resolve('access-token-that-must-not-leak'),
  allowedCustomerId: '8810770460',
  developerToken: 'developer-token-that-must-not-leak',
} as const;
const sensitiveText =
  'access-token-that-must-not-leak developer-token-that-must-not-leak request-body';

/*** Sanitize every trusted-transport and response-decoder failure without retrying a provider request. */
test('sanitizes synchronous and asynchronous transport and decoder failures', async () => {
  const read = () => ({
    customerId: configuration.allowedCustomerId,
    resourceName: 'customers/8810770460/campaigns/7',
  });
  const synchronousTransport = () => {
    throw new Error(sensitiveText);
  };
  const rejectedTransport = () => Promise.reject(new Error(sensitiveText));
  const synchronousJson = responseWithJson(() => {
    throw new Error(sensitiveText);
  });
  const rejectedJson = responseWithJson(() => Promise.reject(new Error(sensitiveText)));

  for (const transport of [synchronousTransport, rejectedTransport])
    expectSanitizedRequestError(
      await getErrorAsync(() =>
        createGoogleAdsRestPorts(configuration, transport).readResourceAsync(read()),
      ),
    );
  for (const response of [synchronousJson, rejectedJson])
    expectSanitizedRequestError(
      await getErrorAsync(() =>
        createGoogleAdsRestPorts(configuration, () => Promise.resolve(response)).readResourceAsync(
          read(),
        ),
      ),
    );
});

/*** Preserve meaningful 4xx and 5xx status errors from an isolated local HTTP fake. */
test('reports local fake-server HTTP statuses without provider secrets or mutations', async () => {
  const server = Bun.serve({
    fetch: (request) =>
      new Response(`${sensitiveText} ${request.method}`, {
        status: request.url.endsWith('/500') ? 500 : 401,
      }),
    port: 0,
  });
  const calls: { readonly init: RequestInit; readonly input: string | URL | Request }[] = [];
  const transport = (input: string | URL | Request, init?: RequestInit) => {
    if (init !== undefined) calls.push({ init, input });
    const status = calls.length === 1 ? 401 : 500;
    return fetch(`http://127.0.0.1:${server.port}/${status}`, init);
  };
  try {
    for (const status of [401, 500]) {
      const error = await getErrorAsync(() =>
        createGoogleAdsRestPorts(configuration, transport).readResourceAsync({
          customerId: configuration.allowedCustomerId,
          resourceName: 'customers/8810770460/campaigns/7',
        }),
      );
      expect(error.message).toContain(`HTTP ${status}`);
      expect(error.message).not.toContain(sensitiveText);
    }
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.init.method === 'POST')).toBeTrue();
    expect(
      calls.every((call) =>
        (typeof call.input === 'string'
          ? call.input
          : call.input instanceof URL
            ? call.input.href
            : call.input.url
        ).includes('googleAds:searchStream'),
      ),
    ).toBeTrue();
  } finally {
    await server.stop(true);
  }
});

/*** Convert an aborting transport into one bounded sanitized failure without retries. */
test('sanitizes a network abort within the caller timeout budget', async () => {
  const calls = { value: 0 };
  const transport = () => {
    calls.value += 1;
    return Promise.reject(new DOMException(`${sensitiveText} network-abort`, 'AbortError'));
  };
  const error = await getErrorBeforeTimeoutAsync(
    () =>
      createGoogleAdsRestPorts(configuration, transport).readResourceAsync({
        customerId: configuration.allowedCustomerId,
        resourceName: 'customers/8810770460/campaigns/7',
      }),
    250,
  );
  expectSanitizedRequestError(error);
  expect(calls.value).toBe(1);
});

function responseWithJson(json: () => unknown): Response {
  const response = new Response('{}', { status: 200 });
  Object.defineProperty(response, 'json', { value: json });
  return response;
}

function expectSanitizedRequestError(error: Error): void {
  expect(error.message).toBe('Google Ads API request failed.');
  expect(error.message).not.toContain(sensitiveText);
}

async function getErrorBeforeTimeoutAsync(
  operation: () => Promise<unknown>,
  timeoutMilliseconds: number,
): Promise<Error> {
  return await Promise.race([
    getErrorAsync(operation),
    new Promise<Error>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error('Google Ads request did not settle before the test timeout.')),
        timeoutMilliseconds,
      );
    }),
  ]);
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
