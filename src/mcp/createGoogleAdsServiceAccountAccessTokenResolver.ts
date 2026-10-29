import { readFileSync } from 'node:fs';

import { JWT } from 'google-auth-library';

import type { GoogleAdsAccessTokenResolver } from '../types/googleAds.js';

const adwordsScope = 'https://www.googleapis.com/auth/adwords';
const refreshBeforeExpiryMilliseconds = 5 * 60 * 1000;

/*** Create a host-owned service-account resolver with Google Auth's cached, proactive refresh. */
export function createGoogleAdsServiceAccountAccessTokenResolver(input: {
  readonly credentialsFile: string;
}): GoogleAdsAccessTokenResolver {
  const credentials = readServiceAccountCredentials(input.credentialsFile);
  const client = new JWT({
    eagerRefreshThresholdMillis: refreshBeforeExpiryMilliseconds,
    email: credentials.client_email,
    key: credentials.private_key,
    keyId: credentials.private_key_id,
    scopes: [adwordsScope],
  });
  return async () => {
    try {
      const { token } = await client.getAccessToken();
      if (typeof token !== 'string' || token === '')
        throw new Error(
          'Google Ads service-account authentication did not return an access token.',
        );
      return token;
    } catch {
      throw new Error('Google Ads service-account authentication did not return an access token.');
    }
  };
}

interface ServiceAccountCredentials {
  readonly client_email: string;
  readonly private_key: string;
  readonly private_key_id?: string;
  readonly type: 'service_account';
}

/*** Read only the host-selected service-account file and reject every other credential type. */
function readServiceAccountCredentials(credentialsFile: string): ServiceAccountCredentials {
  if (credentialsFile === '')
    throw new Error('Google Ads service-account configuration is incomplete.');
  try {
    const value: unknown = JSON.parse(readFileSync(credentialsFile, 'utf8'));
    if (!isServiceAccountCredentials(value))
      throw new Error('Google Ads service-account configuration is invalid.');
    return value;
  } catch {
    throw new Error('Google Ads service-account configuration is invalid.');
  }
}

/*** Recognize the minimal, non-routable identity fields required by Google Auth's service-account client. */
function isServiceAccountCredentials(value: unknown): value is ServiceAccountCredentials {
  if (typeof value !== 'object' || value === null) return false;
  return (
    Reflect.get(value, 'type') === 'service_account' &&
    typeof Reflect.get(value, 'client_email') === 'string' &&
    Reflect.get(value, 'client_email') !== '' &&
    typeof Reflect.get(value, 'private_key') === 'string' &&
    Reflect.get(value, 'private_key') !== '' &&
    (Reflect.get(value, 'private_key_id') === undefined ||
      typeof Reflect.get(value, 'private_key_id') === 'string')
  );
}
