import 'server-only';
import { isPreviewEnv } from './runtime-env';

/**
 * Preview-environment safety guards (defence in depth).
 *
 * These are ADDITIVE, fail-closed checks for the isolated AWS preview. They do
 * not replace or weaken any existing safeguard (per-store `*_WORKER_ENABLED`
 * flags, `CRON_SECRET` auth, egress pool, cooldowns, idempotency receipts).
 * They exist so that, even if a retailer worker flag or an email key were
 * accidentally present in the preview, no retailer request, price write, or
 * outbound email can occur.
 *
 * Behaviour is keyed off `APP_ENV=preview`. In production (`APP_ENV` unset /
 * `VERCEL_ENV=production`) every guard below is a no-op, so Vercel production
 * behaviour is unchanged.
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

/**
 * True when the shared Supabase service-role client must reject ALL writes.
 *
 * This is the production-isolation control: worker/email guards alone cannot
 * stop writes originating from other routes (subscribe, auth, vendor, agent
 * tools, ops endpoints, etc.). Enforced at the single client every server route
 * shares, it blocks them all — in addition to using a restricted/read-only
 * Supabase key. Either control alone prevents production writes.
 */
export function supabaseReadOnly(): boolean {
  if (isPreviewEnv()) return true;
  return process.env.SUPABASE_READ_ONLY === 'true';
}

/** Reason string for logs/responses when retailer collection is blocked. */
export const RETAILER_COLLECTION_BLOCKED_REASON =
  'Retailer collection is disabled in this environment (preview safety guard).';

/** Reason string for logs when outbound email is blocked. */
export const OUTBOUND_EMAIL_BLOCKED_REASON =
  'Outbound email is disabled in this environment (preview safety guard).';

/** Reason string when a Supabase write is blocked by the read-only guard. */
export const SUPABASE_READ_ONLY_REASON =
  'Supabase is read-only in this environment (preview isolation guard).';
