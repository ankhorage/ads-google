import type { McpIntegration } from '@ankhorage/mcp/types';

import { createGoogleAdsRestPorts } from '../features/google-ads/adapters/createGoogleAdsRestPorts.js';
import type { GoogleAdsHttpTransport, GoogleAdsProviderConfiguration } from '../types/googleAds.js';
import { createGoogleAdsMcpWriteTools } from './createGoogleAdsMcpWriteTools.js';

export { createGoogleAdsServiceAccountAccessTokenResolver } from './createGoogleAdsServiceAccountAccessTokenResolver.js';
export { createIntegrationAsync } from './createIntegrationAsync.js';

/*** Compose account-isolated discovery and optionally host-bound prepared-write tools. */
export function createGoogleAdsMcpIntegration(input: {
  readonly configuration: GoogleAdsProviderConfiguration;
  readonly now?: () => string;
  /** Privileged host-only dependency; MCP clients and proposals cannot configure it. */
  readonly transport?: GoogleAdsHttpTransport;
  readonly writeEnabled?: boolean;
}): McpIntegration {
  const ports = createGoogleAdsRestPorts(input.configuration, input.transport);
  const now = input.now ?? (() => new Date().toISOString());
  return {
    id: 'google-ads',
    tools: [
      createReadResourceTool(ports),
      createDiscoveryTool(
        ports,
        'campaigns',
        'List campaigns with status and budget resource IDs.',
      ),
      createDiscoveryTool(ports, 'ad-groups', 'List ad groups with status and CPC resource IDs.'),
      createDiscoveryTool(ports, 'keywords', 'List mutable keyword resource IDs and CPC values.'),
      createDiscoveryTool(
        ports,
        'negative-keywords',
        'List ad-group negative keyword resource IDs.',
      ),
      createDiscoveryTool(
        ports,
        'campaign-negative-keywords',
        'List campaign negative keyword resource IDs.',
      ),
      ...(input.writeEnabled === true
        ? createGoogleAdsMcpWriteTools({
            accountId,
            configuration: input.configuration,
            now,
            transport: input.transport,
          })
        : []),
    ],
  };
}

/*** Expose one resource lookup without accepting credentials or a caller-selected account scope. */
function createReadResourceTool(ports: ReturnType<typeof createGoogleAdsRestPorts>) {
  return {
    accountId,
    description: 'Read one Google Ads resource in the configured account.',
    executeAsync: async (value: Readonly<Record<string, unknown>>) => {
      const resourceName = stringAt(value, 'resourceName');
      return (
        (await ports.readResourceAsync({ customerId: requiredAccountId(value), resourceName })) ?? {
          resourceName,
          values: null,
        }
      );
    },
    id: 'read-resource',
    inputSchema: accountResourceSchema,
    risk: 'read' as const,
    scope: 'account' as const,
    title: 'Read Google Ads resource',
  };
}

/*** Expose a bounded discovery collection so an agent can find canonical resource names. */
function createDiscoveryTool(
  ports: ReturnType<typeof createGoogleAdsRestPorts>,
  kind: Parameters<ReturnType<typeof createGoogleAdsRestPorts>['listResourcesAsync']>[0]['kind'],
  description: string,
) {
  return {
    accountId,
    description,
    executeAsync: async (value: Readonly<Record<string, unknown>>) =>
      await ports.listResourcesAsync({ customerId: requiredAccountId(value), kind }),
    id: `list-${kind}`,
    inputSchema: accountSchema,
    risk: 'read' as const,
    scope: 'account' as const,
    title: `List Google Ads ${kind}`,
  };
}

const accountSchema = {
  additionalProperties: false,
  properties: { accountId: { type: 'string' as const } },
  required: ['accountId'],
  type: 'object' as const,
};
const accountResourceSchema = {
  additionalProperties: false,
  properties: { accountId: { type: 'string' as const }, resourceName: { type: 'string' as const } },
  required: ['accountId', 'resourceName'],
  type: 'object' as const,
};
/*** Derive scope only from the canonical account argument. */
function accountId(value: Readonly<Record<string, unknown>>): string | null {
  const result = value['accountId'];
  return typeof result === 'string' && result.length > 0 ? result : null;
}

/*** Require a nonempty account identity before scope and provider checks. */
function requiredAccountId(value: Readonly<Record<string, unknown>>): string {
  const result = accountId(value);
  if (result === null) throw new Error('Google Ads accountId is required.');
  return result;
}
/*** Read one required nonempty JSON string without coercion. */
function stringAt(
  value: Readonly<Record<string, unknown>>,
  key: 'accountId' | 'resourceName',
): string {
  const result = valueForStringKey(value, key);
  if (typeof result !== 'string' || result.length === 0)
    throw new Error(`Google Ads ${key} must be a nonempty string.`);
  return result;
}
/*** Select from the finite public grammar without a caller-controlled object lookup. */
function valueForStringKey(
  value: Readonly<Record<string, unknown>>,
  key: 'accountId' | 'resourceName',
): unknown {
  switch (key) {
    case 'accountId':
      return value['accountId'];
    case 'resourceName':
      return value['resourceName'];
  }
}
