import 'server-only';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
if (!supabaseServiceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

// Server-only service-role client. `server-only` makes accidental import into a
// Client Component a build-time error, preventing the privileged key from ever
// being bundled for the browser.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
