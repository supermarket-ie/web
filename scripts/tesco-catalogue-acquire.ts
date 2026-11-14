// Tesco Ireland catalogue acquisition (parsebird/tesco-scraper category listings).
// Writes NO prices and NO mappings. Every provider run is RESERVED first in the
// durable budget ledger under its own campaign (default tesco-catalogue-20261115,
// cap $50), the provider run is capped at the reserved amount, and the
// reservation is settled ONLY to Apify's FINAL charge (confirmedTerminalChargeUsd:
// terminal status, finishedAt >= 10s old, usageTotalUsd present). Raw items are
// appended to a private JSONL store (outside the repo) and, when the catalogue
// migration is applied, loaded with scripts/tesco-catalogue-load.ts.
//
// Usage: tsx scripts/tesco-catalogue-acquire.ts <outDir> <categoryUrl> <maxItems>
// Env: SB_URL, SB_KEY (service_role), APIFY_TOKEN; CATALOGUE_CAMPAIGN, CATALOGUE_CAP_USD.
import { createClient } from '@supabase/supabase-js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { confirmedTerminalChargeUsd } from '../src/lib/tesco-apify-fetch';

const PER_PRODUCT_USD = 0.002;   // published ceiling ($1.99/1,000) + start fee headroom below
const START_FEE_USD = 0.01;

async function main() {
  const [outDir, categoryUrl, maxItemsArg] = process.argv.slice(2);
  const maxItems = Number(maxItemsArg);
  if (!outDir || !/^https:\/\/www\.tesco\.ie\/groceries\/en-IE\/shop\/[a-z0-9-/]+$/.test(categoryUrl ?? '')
    || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 12000) throw new Error('usage: <outDir> <tesco.ie category URL> <maxItems 1..12000>');
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN required');
  const sb = createClient(process.env.SB_URL!, process.env.SB_KEY!, { auth: { persistSession: false } });
  const campaign = process.env.CATALOGUE_CAMPAIGN ?? 'tesco-catalogue-20261115';
  const cap = Number(process.env.CATALOGUE_CAP_USD ?? 50);
  const amount = Number((maxItems * PER_PRODUCT_USD + START_FEE_USD).toFixed(4));

  const res = await sb.rpc('apify_reserve_budget', { p_campaign: campaign, p_run_id: null, p_amount: amount, p_cap: cap });
  if (res.error) throw new Error(`reserve: ${res.error.message}`);
  const reservationId = res.data.reservationId as string;
  console.log(JSON.stringify({ event: 'catalogue_reserved', campaign, amount, remainingUsd: res.data.remainingUsd, categoryUrl, maxItems }));

  const api = (path: string, init?: RequestInit) => fetch(`https://api.apify.com/v2${path}`,
    { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  let runId: string | null = null;
  try {
    const start = await api(`/acts/parsebird~tesco-scraper/runs?maxItems=${maxItems}&maxTotalChargeUsd=${amount}`,
      { method: 'POST', body: JSON.stringify({ startUrls: [categoryUrl], maxItems }) });
    if (!start.ok) throw new Error(`start ${start.status}`);
    let run = (await start.json()).data;
    runId = run.id;
    await api(`/actor-runs/${runId}`); // touch
    await sb.rpc('apify_link_reservation_run', { p_reservation_id: reservationId, p_provider_run_id: runId });
    while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) {
      await new Promise(r => setTimeout(r, 15_000));
      run = (await (await api(`/actor-runs/${runId}`)).json()).data;
    }
    // Download all items (paged) and append to the private store with provenance.
    mkdirSync(outDir, { recursive: true });
    const file = `${outDir}/catalogue-${new Date().toISOString().slice(0, 10)}-${runId}.jsonl`;
    let n = 0;
    for (let offset = 0; ; offset += 1000) {
      const items = await (await api(`/datasets/${run.defaultDatasetId}/items?clean=1&offset=${offset}&limit=1000`)).json() as Record<string, unknown>[];
      for (const it of items) {
        const raw = JSON.stringify(it);
        appendFileSync(file, JSON.stringify({ providerRunId: runId, datasetId: run.defaultDatasetId, categoryUrl,
          capturedAt: run.finishedAt, rawSha256: createHash('sha256').update(raw).digest('hex'), item: it }) + '\n', { mode: 0o600 });
        n++;
      }
      if (items.length < 1000) break;
    }
    console.log(JSON.stringify({ event: 'catalogue_run_done', runId, status: run.status, items: n, file }));
  } finally {
    // Settle ONLY to the provider's FINAL charge. If not final yet, poll; if it
    // never becomes final, leave it RESERVED (it keeps counting against the cap)
    // for the collector's between-batch reconciliation.
    let confirmed: number | null = null;
    for (let i = 0; runId && i < 40 && confirmed == null; i++) {
      await new Promise(r => setTimeout(r, 15_000));
      const run = (await (await api(`/actor-runs/${runId}`)).json()).data;
      confirmed = confirmedTerminalChargeUsd(run);
    }
    if (confirmed != null) {
      const s = await sb.rpc('apify_reconcile_reservation', { p_reservation_id: reservationId, p_confirmed_usd: confirmed });
      console.log(JSON.stringify({ event: 'catalogue_settled', runId, confirmedUsd: confirmed, ok: !s.error }));
    } else if (!runId) {
      await sb.rpc('apify_settle_budget', { p_reservation_id: reservationId, p_actual_usd: 0, p_provider_run_id: null });
      console.log(JSON.stringify({ event: 'catalogue_released', reason: 'no provider run started' }));
    } else {
      console.log(JSON.stringify({ event: 'catalogue_reservation_retained', runId, reason: 'final charge not yet available' }));
    }
  }
}
main().catch(e => { console.error(JSON.stringify({ event: 'fatal', message: e instanceof Error ? e.message : String(e) })); process.exitCode = 1; });
