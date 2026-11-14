// Record single-use, evidence-bound first-price approvals (migration 20261113090000).
// Dry run by default: assesses candidates and reports, but records NOTHING.
//   APPROVAL_APPLY=1     record approvals (requires the migration applied)
//   APPROVAL_LIMIT=25    approvals to prepare this invocation
//   APPROVAL_TTL_HOURS=48
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (+ AWS creds for Bedrock).
import { createClient } from '@supabase/supabase-js';
import { prepareFirstPriceApprovals } from '../src/lib/tesco-first-price-approval';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const summary = await prepareFirstPriceApprovals(sb, {
    limit: Number(process.env.APPROVAL_LIMIT ?? 25),
    apply: process.env.APPROVAL_APPLY === '1',
    ttlHours: Number(process.env.APPROVAL_TTL_HOURS ?? 48),
    log: (e) => console.log(JSON.stringify(e)),
  });
  console.log(JSON.stringify({ event: 'approval_summary', apply: process.env.APPROVAL_APPLY === '1', ...summary }));
}
main().catch((e) => { console.error(JSON.stringify({ event: 'fatal', message: e instanceof Error ? e.message : 'error' })); process.exitCode = 1; });
