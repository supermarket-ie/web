import type { SupabaseClient } from '@supabase/supabase-js';
import { isPreviewEnv } from './runtime-env';

/** Reason string when a Supabase write is blocked by the read-only guard. */
export const SUPABASE_READ_ONLY_REASON =
  'Supabase is read-only in this environment (preview/test isolation guard).';

/**
 * True when the shared Supabase clients must reject ALL writes.
 *
 * Active in the pre-cutover TEST posture (`APP_ENV=preview`) or whenever
 * `SUPABASE_READ_ONLY=true`. Lives here (no `server-only`) so it is safe to
 * import from BOTH the Next.js server tree and the Eve agent (Nitro) bundle.
 */
export function supabaseReadOnly(): boolean {
  if (isPreviewEnv()) return true;
  return process.env.SUPABASE_READ_ONLY === 'true';
}

/** Thrown when a write is attempted while the read-only guard is active. */
export class PreviewReadOnlyError extends Error {
  readonly code = 'PREVIEW_READ_ONLY';
  constructor(operation: string) {
    super(`${SUPABASE_READ_ONLY_REASON} (blocked operation: ${operation})`);
    this.name = 'PreviewReadOnlyError';
  }
}

// Mutating methods on the PostgREST query builder that must be blocked.
const BLOCKED_BUILDER_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

// Pure read/select RPCs allowed in read-only mode. Everything else — writes AND
// anything reaching a third-party service (e.g. get_pepesto_api_key) — is blocked.
const READ_ONLY_RPCS = new Set<string>([
  'match_product_search_embeddings', // product search (pure read)
]);

function readOnlyFromBuilder<T extends object>(builder: T): T {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && BLOCKED_BUILDER_METHODS.has(prop)) {
        return () => {
          throw new PreviewReadOnlyError(`from().${prop}()`);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Wrap a Supabase client so all writes are rejected in-app, independently of the
 * key's own privileges. Blocks `.from().insert/update/upsert/delete` and any
 * `.rpc()` not on the read-only allowlist. SELECTs pass through.
 *
 * Shared by BOTH the website service client (`src/lib/supabase.ts`) and the Eve
 * agent client (`agent/lib/supabase.ts`) so the pre-cutover read-only test
 * posture covers agent tool writes too.
 */
export function makeSupabaseReadOnly<T extends SupabaseClient>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => readOnlyFromBuilder((target as SupabaseClient).from(table));
      }
      if (prop === 'rpc') {
        return (fn: string, args?: unknown, options?: unknown) => {
          if (!READ_ONLY_RPCS.has(fn)) {
            throw new PreviewReadOnlyError(`rpc(${fn})`);
          }
          // @ts-expect-error passthrough of the original rpc signature
          return (target as SupabaseClient).rpc(fn, args, options);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}
