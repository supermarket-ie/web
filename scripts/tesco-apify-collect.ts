// Unattended Tesco Apify collection entrypoint for ECS Fargate.
//
// Runs through the service_role PostgREST RPC transport (migration
// 20261108200000). No arbitrary SQL, no human bridge, no reentry approval.
// Env:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — service_role client
//   APIFY_TOKEN                                          — Apify API token
//   APIFY_MODE          = renewal | expansion            (default renewal)
//   APIFY_BATCH_LIMIT   = batch size                     (default 25)
//   APIFY_BUDGET_USD    = campaign budget cap            (default 10)
//   APIFY_PER_REQUEST_USD = marginal cost per request    (default 0.002)
//   APIFY_MAX_BATCHES   = batches this invocation        (default 1)
//   APIFY_REQUIRE_FRESHNESS = '0' to RELAX freshness (default: enforced)
import { createClient } from '@supabase/supabase-js';
import { collectTescoApify, type ApifyCollectionResult } from '../src/lib/tesco-apify-collection';
import { createApifyRunClient, createApifyFetchPage, type ApifyProviderIdentity } from '../src/lib/tesco-apify-fetch';

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v == null) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const mode = (process.env.APIFY_MODE ?? 'renewal') as 'renewal' | 'expansion';
  const limit = Number(process.env.APIFY_BATCH_LIMIT ?? 25);
  const budgetUsd = Number(process.env.APIFY_BUDGET_USD ?? 10);
  const perRequestUsd = Number(process.env.APIFY_PER_REQUEST_USD ?? 0.002);
  const maxBatches = Number(process.env.APIFY_MAX_BATCHES ?? 1);
  // Freshness is ENFORCED by default (fail closed); only '0' relaxes it.
  const requireFreshness = process.env.APIFY_REQUIRE_FRESHNESS !== '0';

  const client = createApifyRunClient({ maxItems: Math.max(1, limit) });

  // One Apify run per URL so one request == one run (budget/ledger line up).
  const fetchApify = (u: string) => new Promise<{ response: Awaited<ReturnType<ReturnType<typeof createApifyFetchPage>>>; provider: ApifyProviderIdentity | null }>((resolve, reject) => {
    let captured: ApifyProviderIdentity | null = null;
    const fetchPage = createApifyFetchPage({
      client,
      onProviderIdentity: (i) => { captured = i; },
      requireVerifiedFreshness: requireFreshness,
    });
    fetchPage(u).then((response) => resolve({ response, provider: captured })).catch(reject);
  });

  // Durable campaign budget accounting (defect 5): seed spentUsd from the actual
  // provider usage already recorded for this campaign's runs, so the cap holds
  // across invocations/restarts — not just within one process.
  async function reconciledSpendUsd(): Promise<number> {
    // Sum recorded provider charges from prior Apify runs' evidence. Each
    // provider-evidence row corresponds to one billed provider request.
    const { count } = await sb.from('tesco_apify_provider_evidence')
      .select('id', { count: 'exact', head: true });
    return (count ?? 0) * perRequestUsd;
  }
  let spentUsd = await reconciledSpendUsd();
  console.log(JSON.stringify({ event: 'budget_seed', reconciledSpentUsd: spentUsd, cap: budgetUsd }));

  const batches: ApifyCollectionResult[] = [];
  for (let b = 0; b < maxBatches; b += 1) {
    if (spentUsd + perRequestUsd > budgetUsd) { console.log(JSON.stringify({ event: 'budget_reached', spentUsd })); break; }
    const result = await collectTescoApify(mode, limit, {
      sb, fetchApify, auditClient: client, budgetUsd, perRequestUsd, spentUsd,
      log: (e) => console.log(JSON.stringify(e)),
    });
    spentUsd = result.spentUsd;
    batches.push(result);
    console.log(JSON.stringify({ event: 'batch_done', batch: b, runId: result.runId,
      requested: result.requested, accepted: result.accepted, held: result.held,
      unavailable: result.unavailable, stopped: result.stopped, spentUsd }));
    if (result.stopped === 'no_eligible_products') break;
    if (result.stopped === 'budget_exhausted') break;
    // A transport stop paused the gate; do not start another batch this run.
    if (result.stopped && !['complete'].includes(result.stopped)) break;
  }

  const totals = batches.reduce((a, r) => ({
    requested: a.requested + r.requested, accepted: a.accepted + r.accepted,
    held: a.held + r.held, unavailable: a.unavailable + r.unavailable,
  }), { requested: 0, accepted: 0, held: 0, unavailable: 0 });
  console.log(JSON.stringify({ event: 'campaign_summary', mode, batches: batches.length, ...totals, spentUsd }));
}

main().catch((e) => { console.error(JSON.stringify({ event: 'fatal', message: e instanceof Error ? e.message : 'error' })); process.exitCode = 1; });
