/*** Run a privileged request boundary callback without exposing implementation failures. */
export function sanitizeGoogleAdsRequestFailureAsync<T>(
  operation: () => T | Promise<T>,
): Promise<T> {
  return Promise.resolve()
    .then(operation)
    .catch(() => Promise.reject(new Error('Google Ads API request failed.')));
}
