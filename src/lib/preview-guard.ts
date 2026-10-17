import 'server-only';
import { isPreviewEnv } from './runtime-env';

/**
 * Environment safety guards (defence in depth).
 *
 * Two triggers, each independent and ADDITIVE (they never weaken existing
 * safeguards — per-store `*_WORKER_ENABLED` flags, `CRON_SECRET` auth, egress
 * pool, cooldowns, idempotency receipts):
 *
 *  1. `APP_ENV=preview` — full pre-cutover TEST posture: read-only Supabase, no
 *     email, no retailer collection. Used to verify the AWS deployment against
 *     the existing production database without altering any data.
 *
 *  2. Explicit `DISABLE_*` env flags — usable in ANY environment, including
 *     `APP_ENV=production`. During the website migration the AWS production task
 *     sets `DISABLE_RETAILER_COLLECTION=true` and `DISABLE_OUTBOUND_EMAIL=true`
 *     so retailer collection and scheduled email keep running ONLY on Vercel and
 *     are never duplicated on AWS, even though the AWS app is otherwise in full
 *     production (read/write) mode.
 *
 * On Vercel (APP_ENV unset / VERCEL_ENV=production and no DISABLE_* flags) every
 * guard is a no-op, so existing Vercel behaviour is unchanged.
 */

/**
 * True when outbound retailer collection (scraping / price renewal) must be
 * blocked for this deployment. Independent of the per-store enable flags.
 */
export function retailerCollectionBlocked(): boolean {
  if (isPreviewEnv()) return true;
  // Explicit global kill-switch usable in any environment.
  return process.env.DISABLE_RETAILER_COLLECTION === 'true';
}

/**
 * True when outbound email/notifications must be blocked for this deployment.
 */
export function outboundEmailBlocked(): boolean {
  if (isPreviewEnv()) return true;
  return process.env.DISABLE_OUTBOUND_EMAIL === 'true';
}

// The Supabase read-only control lives in a `server-only`-free module so it can
// be imported by both the Next.js tree and the Eve agent (Nitro) bundle.
// Re-exported here for existing callers.
export { supabaseReadOnly, SUPABASE_READ_ONLY_REASON } from './supabase-readonly-wrap';

/** Reason string for logs/responses when retailer collection is blocked. */
export const RETAILER_COLLECTION_BLOCKED_REASON =
  'Retailer collection is disabled in this environment (preview safety guard).';

/** Reason string for logs when outbound email is blocked. */
export const OUTBOUND_EMAIL_BLOCKED_REASON =
  'Outbound email is disabled in this environment (preview safety guard).';
