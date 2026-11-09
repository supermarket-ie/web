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
import { createApifyRunClient, createApifyFetchPage, reconcileCampaignSpendUsd, type ApifyProviderIdentity } from '../src/lib/tesco-apify-fetch';

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

  // The per-run provider ceiling is the PER-REQUEST RESERVATION amount, passed
  // through on each call (fetchApify(url, maxChargeUsd)). We also set a client
  // default equal to perRequestUsd as a backstop; the effective cap is the
  // smaller of the two, so a run can never exceed what was reserved.
  const client = createApifyRunClient({ maxItems: Math.max(1, limit), maxTotalChargeUsd: perRequestUsd });
  // Campaign start marker for reconciliation (ISO). Defaults to the campaign's
  // creation date so all its runs are counted.
  const campaignSinceISO = process.env.APIFY_CAMPAIGN_SINCE ?? '2026-11-08T00:00:00Z';

  // One Apify run per URL so one request == one run (budget/ledger line up). The
  // reservation's ceiling (maxChargeUsd) is passed through to the actor run.
  const fetchApify = (u: string, maxChargeUsd: number) => new Promise<{ response: Awaited<ReturnType<ReturnType<typeof createApifyFetchPage>>>; provider: ApifyProviderIdentity | null }>((resolve, reject) => {
    let captured: ApifyProviderIdentity | null = null;
    const fetchPage = createApifyFetchPage({
      client,
      onProviderIdentity: (i) => { captured = i; },
      requireVerifiedFreshness: requireFreshness,
    });
    fetchPage(u, maxChargeUsd).then((response) => resolve({ response, provider: captured })).catch(reject);
  });

  // The $cap is ENFORCED DURABLY by the DB reservation ledger inside
  // collectTescoApify (apify_reserve_budget): every provider launch reserves
  // first, the reservation is retained while running/uncertain, and is
  // reconciled to the ACTUAL charge on settle — so the cap holds across
  // restarts. Here we additionally log an INDEPENDENT provider-side cross-check
  // of total actual spend across all run statuses, for observability.
  const campaign = process.env.APIFY_CAMPAIGN ?? 'tesco-apify-20261108';
  async function logProviderSpend(label) {
    try {
      const r = await reconcileCampaignSpendUsd({ sinceISO: campaignSinceISO });
      console.log(JSON.stringify({ event: 'provider_spend_crosscheck', label, totalUsd: r.totalUsd, runs: r.runs, byStatus: r.byStatus, cap: budgetUsd }));
    } catch (e) { console.log(JSON.stringify({ event: 'provider_spend_crosscheck_failed', message: e instanceof Error ? e.message : 'err' })); }
  }

  // Terminal reconciliation (between batches, NOT per fetch): for each
  // OUTSTANDING reservation linked to a provider run, read that run's CONFIRMED
  // terminal usage and settle the reservation to it. A run that is not yet
  // terminal, or still reports no usage, is left reserved (keeps counting).
  async function reconcileOutstandingReservations(label) {
    const { data: rows, error } = await sb.from('tesco_apify_budget_reservations')
      .select('id,provider_run_id').eq('campaign', campaign).eq('state', 'reserved')
      .not('provider_run_id', 'is', null);
    if (error) { console.log(JSON.stringify({ event: 'reconcile_read_failed', label, message: error.message })); return; }
    const apifyToken = env('APIFY_TOKEN');
    let settled = 0;
    for (const r of rows ?? []) {
      try {
        const res = await fetch(`https://api.apify.com/v2/actor-runs/${r.provider_run_id}`, { headers: { Authorization: `Bearer ${apifyToken}` } });
        if (!res.ok) continue;
        const run = (await res.json())?.data;
        const terminal = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(String(run?.status));
        if (!terminal || run?.usageTotalUsd == null) continue; // not yet confirmed → keep reserved
        const ok = await sb.rpc('apify_reconcile_reservation', { p_reservation_id: r.id, p_confirmed_usd: Number(run.usageTotalUsd) });
        if (!ok.error) settled += 1;
      } catch { /* leave reserved; try again next batch */ }
    }
    console.log(JSON.stringify({ event: 'reservations_reconciled', label, settled, outstanding: (rows ?? []).length }));
  }

  await logProviderSpend('start');
  await reconcileOutstandingReservations('start');

  const batches: ApifyCollectionResult[] = [];
  for (let b = 0; b < maxBatches; b += 1) {
    if (b > 0) { await logProviderSpend(`before_batch_${b}`); await reconcileOutstandingReservations(`before_batch_${b}`); }
    const result = await collectTescoApify(mode, limit, {
      sb, fetchApify, campaign, budgetUsd, perRequestUsd,
      log: (e) => console.log(JSON.stringify(e)),
    });
    batches.push(result);
    console.log(JSON.stringify({ event: 'batch_done', batch: b, runId: result.runId,
      requested: result.requested, accepted: result.accepted, held: result.held,
      unavailable: result.unavailable, stopped: result.stopped, spentUsd: result.spentUsd }));
    if (result.stopped === 'no_eligible_products') break;
    if (result.stopped === 'budget_exhausted') break;
    // A transport stop paused the gate; do not start another batch this run.
    if (result.stopped && !['complete'].includes(result.stopped)) break;
  }

  const totals = batches.reduce((a, r) => ({
    requested: a.requested + r.requested, accepted: a.accepted + r.accepted,
    held: a.held + r.held, unavailable: a.unavailable + r.unavailable,
  }), { requested: 0, accepted: 0, held: 0, unavailable: 0 });
  await logProviderSpend('end');
  await reconcileOutstandingReservations('end');
  console.log(JSON.stringify({ event: 'campaign_summary', mode, batches: batches.length, ...totals }));
}

main().catch((e) => { console.error(JSON.stringify({ event: 'fatal', message: e instanceof Error ? e.message : 'error' })); process.exitCode = 1; });
