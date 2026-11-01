import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { agentSupabase } from '../../../agent/lib/supabase';

/**
 * Supabase clients for the lightweight agent PoC.
 *
 * Two distinct clients, by design:
 *
 *  - {@link catalogueSupabase} — the SHARED, read-only-guarded agent client
 *    (`agentSupabase`). In the preview/test posture (APP_ENV=preview or
 *    SUPABASE_READ_ONLY=true) every write and non-allowlisted RPC throws. All
 *    catalogue + price reads MUST go through this client so price truth stays
 *    read-only exactly as the Eve tools do.
 *
 *  - {@link safeguardSupabase} — a SEPARATE raw service-role client used ONLY
 *    for the PoC's own safeguard tables (conversations, turns ledger, guest
 *    rate limits, Bedrock spend ledger). These rows MUST be writable even in
 *    preview so the safeguards can be exercised end-to-end, so this client is
 *    intentionally NOT wrapped by the read-only guard. It is scoped — callers
 *    only ever touch the `agent_*` PoC tables/RPCs through it.
 *
 * Keeping the two clients separate is what lets the PoC record usage and
 * enforce limits in preview while catalogue/price reads stay read-only.
 */

export const catalogueSupabase = agentSupabase;

let cachedSafeguardClient: SupabaseClient | null = null;

export function safeguardSupabase(): SupabaseClient {
  if (cachedSafeguardClient) return cachedSafeguardClient;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!supabaseServiceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  cachedSafeguardClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedSafeguardClient;
}

/** Test seam: inject a stub safeguard client (used by unit tests). */
export function __setSafeguardClientForTests(client: SupabaseClient | null): void {
  cachedSafeguardClient = client;
}
