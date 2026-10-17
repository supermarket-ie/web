import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseReadOnly, SUPABASE_READ_ONLY_REASON } from './preview-guard';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
if (!supabaseServiceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

// Server-only service-role client. `server-only` makes accidental import into a
// Client Component a build-time error, preventing the privileged key from ever
// being bundled for the browser.
const rawClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Thrown when a write is attempted while the preview read-only guard is active. */
export class PreviewReadOnlyError extends Error {
  readonly code = 'PREVIEW_READ_ONLY';
  constructor(operation: string) {
    super(`${SUPABASE_READ_ONLY_REASON} (blocked operation: ${operation})`);
    this.name = 'PreviewReadOnlyError';
  }
}

// Mutating methods on the PostgREST query builder that must be blocked in the
// isolated preview. SELECT and other read paths are unaffected.
const BLOCKED_BUILDER_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

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
 * Wrap the service-role client so that, when the preview read-only guard is
 * active (APP_ENV=preview or SUPABASE_READ_ONLY=true), ALL writes are rejected
 * in-app — independently of the Supabase key's own privileges.
 *
 * This is the isolation control the reviewer asked for: worker/email guards
 * alone cannot stop writes from other routes (subscribe, auth, vendor, agent
 * tools, ops, etc.). Enforcing at the single client every server route shares
 * blocks them all. It is defence in depth ON TOP OF using a restricted/read-only
 * Supabase key; either control alone prevents production writes.
 *
 * Blocked: .from(table).insert/update/upsert/delete and mutating .rpc() calls.
 * Allowed: .from(table).select(...) and read-only RPCs on an allowlist.
 */
function makeReadOnly(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => readOnlyFromBuilder(target.from(table));
      }
      if (prop === 'rpc') {
        // Read-only RPCs the preview legitimately needs (pure reads/selects).
        // Anything not on this allowlist is treated as a potential write and
        // blocked. Write RPCs (finalize_*, claim_*, mark_*, pause_*, set_*,
        // resolve_*, finalize_*) are intentionally absent.
        const READ_ONLY_RPCS = new Set<string>([
          'get_pepesto_api_key',
          'select_store_products_for_refresh',
          'select_dunnes_discovery_targets',
          'match_product_search_embeddings',
        ]);
        return (fn: string, args?: unknown, options?: unknown) => {
          if (!READ_ONLY_RPCS.has(fn)) {
            throw new PreviewReadOnlyError(`rpc(${fn})`);
          }
          // @ts-expect-error passthrough of the original rpc signature
          return target.rpc(fn, args, options);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as SupabaseClient;
}

export const supabaseAdmin: SupabaseClient = supabaseReadOnly() ? makeReadOnly(rawClient) : rawClient;
