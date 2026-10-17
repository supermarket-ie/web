/**
 * Runtime environment helpers.
 *
 * The app originally keyed preview/staging behaviour off Vercel's `VERCEL_ENV`.
 * For the AWS migration we introduce `APP_ENV` as the platform-neutral source of
 * truth. `VERCEL_ENV` is kept as a fallback so existing Vercel production and
 * preview behaviour is unchanged while the app also runs correctly on AWS.
 *
 * Resolution order: APP_ENV -> VERCEL_ENV -> 'production'.
 */

export type RuntimeEnv = 'development' | 'preview' | 'production' | (string & {});

export function runtimeEnv(): RuntimeEnv {
  const appEnv = process.env.APP_ENV?.trim();
  if (appEnv) return appEnv as RuntimeEnv;
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv) return vercelEnv as RuntimeEnv;
  return 'production';
}

/** True in a non-production (preview/staging) deployment. */
export function isPreviewEnv(): boolean {
  return runtimeEnv() === 'preview';
}

/**
 * True when the deployment must not be indexed by search engines.
 *
 * Preserves the original behaviour (a `staging` host is noindex) and adds
 * coverage for any `preview` environment regardless of its hostname, so the
 * AWS-generated preview URL is never indexed.
 */
export function isNoIndexEnv(baseUrl?: string): boolean {
  const url = (baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').trim();
  if (url.includes('staging')) return true;
  const env = runtimeEnv();
  return env === 'preview' || env === 'development';
}
