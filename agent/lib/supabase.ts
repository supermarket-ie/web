import { createClient } from '@supabase/supabase-js';
// Import from the `server-only`-free module so the eve/Nitro bundle builds.
import { makeSupabaseReadOnly, supabaseReadOnly } from '../../src/lib/supabase-readonly-wrap';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
if (!supabaseServiceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

// Eve runs as a private server-side service. Never import this module into the
// browser-facing Next.js bundle; tools are the only public execution surface.
const rawAgentClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Apply the SAME read-only guard as the website client so the pre-cutover TEST
// posture (APP_ENV=preview / SUPABASE_READ_ONLY=true) also prevents the Eve
// agent's tools from writing to the existing production database. In production
// mode the raw client is used unchanged.
export const agentSupabase = supabaseReadOnly() ? makeSupabaseReadOnly(rawAgentClient) : rawAgentClient;
