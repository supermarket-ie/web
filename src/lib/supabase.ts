import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { makeSupabaseReadOnly, PreviewReadOnlyError, supabaseReadOnly } from './supabase-readonly-wrap';

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

// Re-export for existing callers/tests.
export { PreviewReadOnlyError };

/**
 * The shared service-role client. When the read-only guard is active
 * (`APP_ENV=preview` or `SUPABASE_READ_ONLY=true`, e.g. the pre-cutover test
 * against the existing production DB) every write is rejected in-app. In
 * production mode the real client is used unchanged.
 */
export const supabaseAdmin: SupabaseClient = supabaseReadOnly() ? makeSupabaseReadOnly(rawClient) : rawClient;
