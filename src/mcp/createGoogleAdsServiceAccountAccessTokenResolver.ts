import { GoogleAuth } from 'google-auth-library';

import type { GoogleAdsAccessTokenResolver } from '../types/googleAds.js';

const adwordsScope = 'https://www.googleapis.com/auth/adwords';
const refreshBeforeExpiryMilliseconds = 5 * 60 * 1000;

/*** Create a host-owned service-account resolver with Google Auth's cached, proactive refresh. */
export function createGoogleAdsServiceAccountAccessTokenResolver(input: {
  readonly credentialsFile: string;
}): GoogleAdsAccessTokenResolver {
  const { credentialsFile } = input;
  const auth = new GoogleAuth({
    clientOptions: { eagerRefreshThresholdMillis: refreshBeforeExpiryMilliseconds },
    scopes: [adwordsScope],
  });
  validateCredentialFile(credentialsFile);
  const clientAsync = auth.getClient();
  return async () => {
    const { token } = await (await clientAsync).getAccessToken();
    if (typeof token !== 'string' || token === '')
      throw new Error('Google Ads service-account authentication did not return an access token.');
    return token;
  };
}

/*** Require the host's standard ADC credential-file setting without reading or serializing its secret. */
function validateCredentialFile(credentialsFile: string): void {
  if (credentialsFile === '')
    throw new Error('Google Ads service-account configuration is incomplete.');
}
