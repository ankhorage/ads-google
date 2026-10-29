import type { McpIntegration } from '@ankhorage/mcp/types';

import { createGoogleAdsServiceAccountAccessTokenResolver } from './createGoogleAdsServiceAccountAccessTokenResolver.js';
import { createGoogleAdsMcpIntegration } from './index.js';

/*** Create the discoverable read-only integration from process-local secrets, never tool input. */
export function createIntegrationAsync(): Promise<McpIntegration> {
  const developerToken = optionalEnvironmentValue('ANKH_GOOGLE_ADS_DEVELOPER_TOKEN');
  const loginCustomerId = optionalEnvironmentValue('ANKH_GOOGLE_ADS_LOGIN_CUSTOMER_ID');
  return Promise.resolve(
    createGoogleAdsMcpIntegration({
      configuration: {
        accessTokenAsync: createGoogleAdsServiceAccountAccessTokenResolver({
          credentialsFile: requiredEnvironmentValue('GOOGLE_APPLICATION_CREDENTIALS'),
        }),
        allowedCustomerId: requiredEnvironmentValue('ANKH_GOOGLE_ADS_ALLOWED_CUSTOMER_ID'),
        ...(developerToken === undefined ? {} : { developerToken }),
        ...(loginCustomerId === undefined ? {} : { loginCustomerId }),
      },
    }),
  );
}

/*** Read a required process-local secret without ever returning it in an error. */
function requiredEnvironmentValue(name: string): string {
  const value = optionalEnvironmentValue(name);
  if (value === undefined) throw new Error('Google Ads MCP host configuration is incomplete.');
  return value;
}

/*** Read a nonempty host configuration value. */
function optionalEnvironmentValue(name: string): string | undefined {
  const value = environmentValue(name);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/*** Select only the fixed environment names owned by this integration. */
function environmentValue(name: string): string | undefined {
  if (name === 'ANKH_GOOGLE_ADS_ALLOWED_CUSTOMER_ID')
    return process.env['ANKH_GOOGLE_ADS_ALLOWED_CUSTOMER_ID'];
  if (name === 'ANKH_GOOGLE_ADS_DEVELOPER_TOKEN')
    return process.env['ANKH_GOOGLE_ADS_DEVELOPER_TOKEN'];
  if (name === 'ANKH_GOOGLE_ADS_LOGIN_CUSTOMER_ID')
    return process.env['ANKH_GOOGLE_ADS_LOGIN_CUSTOMER_ID'];
  if (name === 'GOOGLE_APPLICATION_CREDENTIALS')
    return process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  throw new Error('Unsupported Google Ads MCP environment variable.');
}
