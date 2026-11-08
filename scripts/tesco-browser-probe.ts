/**
 * Bounded, READ-ONLY browser-based Tesco access proof, to run as a one-off ECS
 * task from the intended unattended AWS runtime — ONLY after the egress gate
 * cooldown has cleared.
 *
 * It preserves the collector's controls:
 *   - claims the egress lease (claim_tesco_egress) before any request; refuses
 *     to run if the gate is unavailable (cooldown / lease / disabled);
 *   - one product at a time, 10s pacing, at most PROBE_MAX (<=10) products;
 *   - stop conditions: access_block (401/403/challenge) or rate_limited (429)
 *     stop immediately and record the block (mark_tesco_egress_blocked);
 *   - a clean genuine retrieval records a gate success (mark_tesco_egress_success);
 *   - renders via Playwright/Chromium, parses with the EXISTING parser, and runs
 *     the EXISTING identity checks — but writes NO price_observations / no
 *     finalisation / no mapping change. It only reports evidence.
 *
 * Env (task-scoped): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * PROBE_URLS (JSON array of tesco.ie product URLs), PROBE_MAX (default 10).
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fetchTescoCollectedPageViaBrowser } from '@/lib/tesco-browser-fetch';
import { parseTescoCollectedPage } from '@/lib/tesco-direct-collection-core';

const GATE = 'vercel-dub1-canary-20260920';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MAX = Math.max(1, Math.min(Number(process.env.PROBE_MAX || 10), 10));

function log(tag: string, obj: unknown) { console.log(`${tag} ${JSON.stringify(obj)}`); }

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase credentials are not configured');
  const urls: string[] = JSON.parse(process.env.PROBE_URLS || '[]').slice(0, MAX);
  if (urls.length === 0) throw new Error('No PROBE_URLS supplied');

  const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  // Claim the gate lease. If the cooldown has not cleared, this returns no row
  // and we STOP — we never bypass the cooldown.
  const { data: claim, error: claimErr } = await db.rpc('claim_tesco_egress', { p_lease_seconds: 600 });
  if (claimErr) throw new Error(`claim_tesco_egress failed: ${claimErr.message}`);
  const leased = Array.isArray(claim) ? claim[0] : claim;
  if (!leased?.egress_key) {
    log('PROBE_STOP', { reason: 'gate_unavailable', detail: 'cooldown/lease not clear; not probing' });
    log('PROBE_SUMMARY', { requested: 0, genuine: 0, stopped: 'gate_unavailable' });
    return;
  }
  log('PROBE_GATE', { leased: leased.egress_key });

  const results: unknown[] = [];
  let stopped: string | null = null;
  let genuine = 0;
  try {
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      const page = await fetchTescoCollectedPageViaBrowser(url);
      const capturedAt = new Date().toISOString();
      const bodyHash = page.html ? crypto.createHash('sha256').update(page.html).digest('hex') : null;

      if (page.outcome === 'access_block' || page.outcome === 'rate_limited') {
        // Record the block through the supported control process and STOP.
        await db.rpc('mark_tesco_egress_blocked', { p_egress_key: GATE, p_cooldown_hours: 48 });
        results.push({ url, outcome: page.outcome, httpStatus: page.status, finalUrl: page.finalUrl,
          capturedAt, elapsedMs: page.elapsedMs, bodyBytes: page.html.length, bodySha256: bodyHash,
          retryAfter: page.retryAfter });
        log('PROBE_RESULT', results[results.length - 1]);
        stopped = page.outcome;
        log('PROBE_STOP', { reason: page.outcome });
        break;
      }

      // Parse + identity (read-only). Report the fields that prove acceptance.
      let parsed: ReturnType<typeof parseTescoCollectedPage> | null = null;
      try { parsed = page.outcome === 'ok' ? parseTescoCollectedPage(page.html, page.finalUrl) : null; } catch { parsed = null; }
      const product = parsed?.products?.[0] ?? null;
      const expectedSku = url.match(/\/products\/(\d+)/)?.[1] ?? null;
      const record = {
        url, outcome: page.outcome, httpStatus: page.status, finalUrl: page.finalUrl,
        capturedAt, elapsedMs: page.elapsedMs, bodyBytes: page.html.length, bodySha256: bodyHash,
        region: page.finalUrl.includes('/en-IE/') ? 'IE' : 'unknown',
        parsed: product ? {
          sku: product.sku, skuMatches: product.sku === expectedSku,
          name: product.name, brand: product.brand, gtin: product.gtin,
          regularPriceEUR: product.price, currency: product.currency,
          quantity: product.quantity, available: product.available,
          // Clubcard/promotional prices are NOT taken as the regular price — the
          // parser only returns ProductType.price.actual (the regular shelf
          // price); any promo handling stays separate downstream.
        } : null,
        genuineProduct: Boolean(product && product.sku === expectedSku),
      };
      results.push(record);
      log('PROBE_RESULT', record);
      if (record.genuineProduct) genuine += 1;
      if (i < urls.length - 1) await new Promise((r) => setTimeout(r, 10_000)); // 10s pacing
    }

    // A clean run with at least one genuine product records a gate success.
    if (!stopped && genuine > 0) {
      await db.rpc('mark_tesco_egress_success', { p_egress_key: GATE });
      log('PROBE_GATE', { recorded: 'success' });
    }
  } finally {
    // Always release the lease (release leaves cooldown/counters as set above).
    await db.rpc('release_tesco_egress', { p_egress_key: GATE }).catch(() => {});
  }

  log('PROBE_SUMMARY', {
    requested: results.length, genuine, stopped,
    withPrice: results.filter((r) => (r as { parsed?: { regularPriceEUR: number | null } }).parsed?.regularPriceEUR != null).length,
  });
}

main().catch((e) => { console.error('PROBE_FATAL', e instanceof Error ? e.message : String(e)); process.exit(1); });
