// Apify retrieval transport for Tesco Ireland collection.
//
// This is the SMALLEST adapter around the existing evidence/identity/guarded-
// finalisation path. It is a drop-in `fetchPage(url) => TescoPageResponse`
// transport for `collectTescoSupervised` (and the direct collector), swapping
// ONLY the network fetch. Everything downstream is unchanged:
//
//   • the SAME parser (`parseTescoCollectedPage`) reads the result, because the
//     adapter renders the Apify item into the exact `application/discover+json`
//     apolloCache envelope a real Tesco product page carries. There is ONE
//     parser and ONE identity path; Apify-sourced products are normalised and
//     validated identically to direct-fetch products;
//   • the SAME identity gates, holds, receipts, one-use approvals, lease,
//     pacing, circuit breakers and guarded finalisation run verbatim.
//
// The adapter performs NO price mapping, NO identity decision and NO write. It
// only turns "fetch this Tesco product URL" into "ask Apify for this one SKU
// and express the answer as a Tesco page". Provider provenance (actor, build,
// run id, dataset id, body hash, capture time, charge) is surfaced via an
// optional sink so the caller can persist it alongside the evidence.
//
// Clubcard/promotional prices are deliberately DROPPED from the rendered page:
// `parseTescoCollectedPage` reads only the regular shelf `price.actual`, so the
// collector can never finalise a Clubcard/promo price as the trusted price.
// The raw Apify item (including promotions) is preserved verbatim in the
// provider evidence sink for audit, separate from the price path.

import { createHash } from 'node:crypto';
import {
  classifyTescoHtmlOutcome,
  isTescoCollectionUrl,
  type TescoFetchOutcome,
  type TescoPageResponse,
} from './tesco-direct-collection-core';

export type ApifyItem = Record<string, unknown>;

export type ApifyProviderIdentity = {
  provider: 'apify';
  actorId: string;
  actorBuildId: string | null;
  actorBuildNumber: string | null;
  runId: string;
  datasetId: string;
  requestedUrl: string;
  sku: string;
  // The canonical body sha256 of the rendered evidence page (the same value the
  // collector will store as body_sha256). Lets the caller bind provenance to it.
  bodySha256: string;
  // Provider-reported capture time for THIS item.
  scrapedAt: string | null;
  // The raw item as returned, preserved verbatim for the audit (promotions
  // included), and its hash. This is the TRUE provider-origin evidence, kept
  // distinct from the synthetic adapter HTML (bodySha256).
  rawItem: ApifyItem;
  rawItemSha256: string;
  // ACTUAL provider charge for the run, or NULL when UNKNOWN (provider reported
  // no usage total). Never 0-for-missing. Used to settle the budget reservation
  // ONLY when a confirmed terminal charge is known.
  runUsageUsd: number | null;
  // Whether runUsageUsd is a CONFIRMED terminal figure (vs preliminary/unknown).
  runUsageIsTerminal: boolean;
  // Freshness evidence (see verifyApifyFreshness).
  freshness: ApifyFreshness;
};

// FRESHNESS — DOCUMENTED LIMITATION (corrected per review).
//
// What we checked for independent freshness evidence:
//   • The actor's public documentation (apify.com/parsebird/tesco-scraper): it
//     describes a live scrape by URL/search but documents NO cache semantics,
//     NO freshness/TTL guarantee and NO cache-age field.
//   • The run + dataset API: exposes `scraped_at` (a provider-ASSERTED
//     timestamp) and billing counts only. No cache-hit/age field.
//   • Our request logs: `scraped_at` advances on repeated runs, and billing is
//     inconsistent for identical work.
//
// Conclusion: we CANNOT independently establish that a returned price was
// freshly retrieved upstream. Specifically:
//   - `scraped_at > requestSubmittedAt` is only a provider-asserted timestamp;
//     the actor could stamp it at response-assembly time over a short internal
//     cache. It does NOT prove an upstream fetch.
//   - A second run of the SAME actor advancing `scraped_at` ALSO does not prove
//     it — the actor may simply re-stamp. So the earlier per-batch "advance"
//     audit was removed: it added provider cost/latency without establishing
//     anything. There is no documented bounded source-cache age to rely on.
//
// Policy given that limitation: treat `scraped_at present AND strictly after
// our submit, and not implausibly future` as the BEST AVAILABLE (but NOT
// independent) freshness signal — a necessary precondition. Missing/at-or-
// before-submit/implausible timestamps are HELD. The limitation is surfaced in
// the provider evidence (`freshnessLimitation`) and recorded on every accepted
// verification so no downstream consumer treats Apify prices as independently
// freshness-verified. This is reported, not hidden.
// EXPLICIT: the current policy PERMITS price writes WITHOUT independently
// established freshness. `scraped_at`-after-submit is provider-asserted only; we
// could not establish independent freshness (no documented cache semantics or
// cache-age), so this does NOT satisfy the earlier "hold unless freshness is
// independently established" requirement — it is a weaker, documented stance.
export const APIFY_FRESHNESS_LIMITATION =
  'WRITES PERMITTED WITHOUT INDEPENDENTLY ESTABLISHED FRESHNESS: scraped_at is provider-asserted only; no documented cache semantics or cache-age; upstream freshness is NOT independently verified and this does NOT meet the prior hold-unless-independently-fresh requirement';

export type ApifyFreshnessLevel =
  | 'after_submit_asserted'  // scraped_at present + strictly after submit (best available, provider-asserted)
  | 'not_after_submit'       // at/<= submit (possible replay) → hold
  | 'implausible_future'     // beyond skew margin ahead → hold
  | 'no_timestamp';          // provider gave no scraped_at → hold
export type ApifyFreshness = {
  // scraped_at the provider reported for this item.
  scrapedAt: string | null;
  // The instant WE submitted this request (the freshness reference point).
  requestSubmittedAt: string;
  // scraped_at strictly after requestSubmittedAt.
  afterSubmit: boolean;
  // Billed product-scraped events for the run (recorded for audit; NOT a signal).
  productScrapedEvents: number;
  level: ApifyFreshnessLevel;
  // Best-available precondition is met (NOT an independent freshness proof —
  // see APIFY_FRESHNESS_LIMITATION). Final acceptance also requires the
  // deterministic + AI identity gate.
  preconditionMet: boolean;
  // The standing limitation string, carried so consumers never over-trust it.
  limitation: string;
  reason: string;
};

// ---- Apify API client (token via env; never logged) --------------------------

export type ApifyRunResult = {
  actorId: string;
  runId: string;
  datasetId: string;
  buildId: string | null;
  buildNumber: string | null;
  startedAt: string;
  finishedAt: string | null;
  items: ApifyItem[];
  // Billed product-scraped events for this run (proves an upstream fetch).
  productScrapedEvents: number;
  actorStartEvents: number;
  // ACTUAL provider charge for the run. NULL when the provider did not report a
  // usage total — a MISSING cost is explicitly UNKNOWN, never coerced to 0.
  usageTotalUsd: number | null;
  // Whether usageTotalUsd is a CONFIRMED terminal-run figure. A completion-time
  // total can be PRELIMINARY (provider still aggregating), so it must not be
  // treated as the final settled charge even if present.
  usageIsTerminal: boolean;
};

export interface ApifyRunClient {
  // Run the actor for a bounded set of product URLs and return the dataset
  // items plus the run's billing/provenance. One run per batch. An optional
  // per-call maxTotalChargeUsd caps THIS run's provider charge (used to pass
  // the budget reservation's ceiling through to the outgoing request).
  runProductUrls(urls: string[], maxTotalChargeUsd?: number): Promise<ApifyRunResult>;
}

const ACTOR = 'parsebird~tesco-scraper';
const API = 'https://api.apify.com/v2';

function requireToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token || !/^apify_api_[A-Za-z0-9]+$/.test(token)) {
    throw new Error('APIFY_TOKEN is missing or malformed');
  }
  return token;
}

// Real HTTP client. Starts one actor run for the batch, waits for it to finish,
// reads the dataset, and reports the billed events for freshness corroboration.
export function createApifyRunClient(options: {
  token?: string;
  maxItems: number;
  fetchImpl?: typeof fetch;
  pollMs?: number;
  timeoutMs?: number;
  // PROVIDER-SIDE monetary cap per run (USD). Passed to Apify as
  // maxTotalChargeUsd so the provider itself aborts a run before it exceeds
  // this, independent of our client-side accounting.
  maxTotalChargeUsd?: number;
} ): ApifyRunClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollMs = options.pollMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;

  async function authed(path: string, init?: RequestInit) {
    const token = options.token ?? requireToken();
    const res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Apify API ${init?.method ?? 'GET'} ${path} -> ${res.status}`);
    return res;
  }

  return {
    async runProductUrls(urls: string[], maxTotalChargeUsd?: number): Promise<ApifyRunResult> {
      if (!urls.length || urls.length > options.maxItems) {
        throw new Error('Apify run requires 1..maxItems product URLs');
      }
      // Per-call ceiling (the reservation amount) takes precedence; otherwise
      // the client default. The EFFECTIVE cap is the smaller of the two so a
      // per-call ceiling can only tighten, never loosen, the client default.
      const effectiveCap = maxTotalChargeUsd != null
        ? (options.maxTotalChargeUsd != null ? Math.min(maxTotalChargeUsd, options.maxTotalChargeUsd) : maxTotalChargeUsd)
        : options.maxTotalChargeUsd;
      const input = {
        startUrls: urls,
        region: 'IE',
        maxItems: options.maxItems,
        includeProductDetails: true,
        includeReviews: false,
        deduplicateProducts: true,
        proxyConfiguration: { useApifyProxy: false },
      };
      // Provider-side monetary limit: Apify aborts the run if it would exceed
      // maxTotalChargeUsd, independent of our own budget accounting.
      const limitQs = effectiveCap != null
        ? `&maxTotalChargeUsd=${encodeURIComponent(String(effectiveCap))}` : '';
      const start = await (await authed(`/acts/${ACTOR}/runs?maxItems=${options.maxItems}${limitQs}`, {
        method: 'POST',
        body: JSON.stringify(input),
      })).json();
      const runId: string = start.data.id;
      const datasetId: string = start.data.defaultDatasetId;

      const deadline = Date.now() + timeoutMs;
      let run = start.data;
      while (['READY', 'RUNNING'].includes(run.status)) {
        if (Date.now() > deadline) throw new Error('Apify run exceeded timeout');
        await new Promise((r) => setTimeout(r, pollMs));
        run = (await (await authed(`/actor-runs/${runId}`)).json()).data;
      }
      if (run.status !== 'SUCCEEDED') throw new Error(`Apify run ${runId} ended ${run.status}`);

      const items: ApifyItem[] = await (await authed(`/datasets/${datasetId}/items?clean=true&format=json`)).json();
      const charged = (run.chargedEventCounts ?? {}) as Record<string, number>;
      return {
        actorId: run.actId,
        runId,
        datasetId,
        buildId: run.buildId ?? null,
        buildNumber: run.buildNumber ?? null,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        items,
        productScrapedEvents: Number(charged['product-scraped'] ?? 0),
        actorStartEvents: Number(charged['apify-actor-start'] ?? 0),
        // MISSING cost stays explicitly UNKNOWN (null), never 0. And even a
        // present completion-time total is treated as PRELIMINARY — the
        // confirmed terminal charge comes from reconcileCampaignSpendUsd between
        // batches, not from this per-fetch completion read.
        usageTotalUsd: run.usageTotalUsd == null ? null : Number(run.usageTotalUsd),
        usageIsTerminal: false,
      };
    },
  };
}

// Reconcile ACTUAL campaign spend from the provider: sum usageTotalUsd across
// ALL of this actor's runs in the current billing window, regardless of status
// (SUCCEEDED, FAILED, TIMED-OUT, ABORTED, and audit re-runs). Apify bills for
// aborted/failed runs' compute too, so durable accounting must include them.
// This is the source of truth for the campaign budget, not count × estimate.
export async function reconcileCampaignSpendUsd(options: {
  token?: string;
  fetchImpl?: typeof fetch;
  sinceISO?: string;    // only count runs started at/after this instant
}): Promise<{ totalUsd: number; runs: number; byStatus: Record<string, number> }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token ?? requireToken();
  const since = options.sinceISO ? Date.parse(options.sinceISO) : 0;
  let offset = 0; let totalUsd = 0; let runs = 0;
  const byStatus: Record<string, number> = {};
  // Paginate the actor's run list (desc by startedAt).
  for (;;) {
    const res = await fetchImpl(`${API}/acts/${ACTOR}/runs?desc=1&limit=100&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Apify runs list -> ${res.status}`);
    const page = (await res.json())?.data;
    const items: Array<Record<string, unknown>> = page?.items ?? [];
    if (!items.length) break;
    let reachedOlder = false;
    for (const r of items) {
      const started = Date.parse(String(r.startedAt ?? ''));
      if (since && Number.isFinite(started) && started < since) { reachedOlder = true; continue; }
      totalUsd += Number(r.usageTotalUsd ?? 0);
      runs += 1;
      const st = String(r.status ?? 'UNKNOWN');
      byStatus[st] = (byStatus[st] ?? 0) + 1;
    }
    if (reachedOlder || items.length < 100) break;
    offset += 100;
  }
  return { totalUsd, runs, byStatus };
}

// ---- Item -> Tesco apolloCache page rendering ---------------------------------

function skuFromUrl(url: string): string | null {
  return new URL(url).pathname.match(/\/products\/(\d+)$/)?.[1] ?? null;
}

// Map the Apify pack_size/unit into the Tesco cache `details.packSize[]` shape
// that `productFromCache` consumes. Only pass through a single, well-formed
// structured size; anything ambiguous is omitted so the existing quantity
// evidence rules (title-count etc.) apply exactly as for a direct fetch.
function packSizeEntries(item: ApifyItem): Array<{ value: number; units: string }> {
  const value = Number(item.pack_size);
  const units = typeof item.pack_size_unit === 'string' ? item.pack_size_unit.trim() : '';
  if (!Number.isFinite(value) || value <= 0 || !units) return [];
  return [{ value, units }];
}

// Build the exact `application/discover+json` HTML envelope a real Tesco IE
// product page carries, so `parseTescoCollectedPage` reads the Apify item with
// NO code change. Regular shelf price only (`price.actual`); Clubcard/promo are
// intentionally excluded from the price-bearing structure.
export function renderApifyProductPage(url: string, item: ApifyItem): string {
  const sku = skuFromUrl(url);
  if (!sku) throw new Error('Apify page render requires a product URL');
  if (String(item.product_id ?? '') !== sku) throw new Error('Apify item product_id does not match requested SKU');
  if (String(item.region ?? '') !== 'IE' || String(item.currency ?? '') !== 'EUR') {
    throw new Error('Apify item is not an Irish EUR product');
  }

  const price = Number(item.price);
  const ref = `Product:${sku}`;
  const productNode: Record<string, unknown> = {
    __typename: 'ProductType',
    id: sku,
    tpnc: sku,
    title: String(item.name ?? ''),
    brandName: item.brand_name == null ? '' : String(item.brand_name),
    gtin: item.gtin == null ? '' : String(item.gtin),
    // Regular shelf price only. Never the clubcard_price / promotion price.
    price: Number.isFinite(price) && price > 0 ? { actual: price } : {},
    details: { packSize: packSizeEntries(item) },
    isForSale: item.in_stock === true,
    status: String(item.status ?? ''),
  };

  const cache = {
    ROOT_QUERY: {
      [`product(${JSON.stringify({ tpnc: sku })})`]: { __ref: ref },
    },
    [ref]: productNode,
  };

  const payload = {
    'mfe-orchestrator': {
      props: {
        apolloCache: cache,
        config: { global: { locale: 'en-IE' } },
      },
    },
  };

  // The parser also requires visible euro evidence on the page.
  //
  // IMPORTANT: this is a SYNTHETIC internal parser-adapter document generated
  // from an Apify item. It is NOT an original Tesco HTTP response and must never
  // be presented as one. The true provider-origin evidence is the original Apify
  // payload (preserved verbatim with its own hash in tesco_apify_provider_evidence).
  return [
    '<!doctype html><html lang="en-IE"><head><meta charset="utf-8">',
    '<meta name="x-smie-evidence-origin" content="synthetic-apify-adapter; not-a-tesco-response">',
    '</head><body>',
    '<!-- SYNTHETIC parser adapter rendered from an Apify dataset item; NOT an original Tesco response. -->',
    `<p>Price: &euro;${Number.isFinite(price) ? price.toFixed(2) : ''}</p>`,
    `<script type="application/discover+json">${JSON.stringify(payload)}</script>`,
    '</body></html>',
  ].join('');
}

// ---- Freshness (best-available, with the documented limitation) ----------------

// Best-available precondition: scraped_at present, strictly after our submit,
// not implausibly future. This is NOT an independent freshness proof (see
// APIFY_FRESHNESS_LIMITATION). There is no per-batch audit — a second run
// advancing scraped_at proves nothing and only costs money/latency.
export function verifyApifyFreshness(args: {
  scrapedAt: string | null;
  requestSubmittedAt: string;
  runFinishedAt: string | null;
  productScrapedEvents: number;
  itemsReturned: number;
}): ApifyFreshness {
  const submit = Date.parse(args.requestSubmittedAt);
  const scraped = args.scrapedAt ? Date.parse(args.scrapedAt) : NaN;
  const hasTimestamp = Number.isFinite(scraped);
  const skew = 5 * 60_000;
  const now = Date.now();
  const afterSubmit = hasTimestamp && scraped > submit;
  const implausibleFuture = hasTimestamp && scraped > now + skew;
  let level: ApifyFreshnessLevel;
  if (!hasTimestamp) level = 'no_timestamp';
  else if (implausibleFuture) level = 'implausible_future';
  else if (afterSubmit) level = 'after_submit_asserted';
  else level = 'not_after_submit';
  const preconditionMet = level === 'after_submit_asserted';
  const reason = !hasTimestamp
    ? 'provider returned no scraped_at — held'
    : implausibleFuture
      ? 'scraped_at implausibly in the future vs local clock — held'
      : afterSubmit
        ? 'scraped_at present and after submit (best available; provider-asserted, NOT independently verified)'
        : 'scraped_at at/before our submit — possible cached/replayed item; held';
  return {
    scrapedAt: args.scrapedAt, requestSubmittedAt: args.requestSubmittedAt,
    afterSubmit, productScrapedEvents: args.productScrapedEvents, level, preconditionMet,
    limitation: APIFY_FRESHNESS_LIMITATION, reason,
  };
}

// ---- The fetchPage transport --------------------------------------------------

export type ApifyFetchDeps = {
  client: ApifyRunClient;
  // Optional provenance sink called once per fetched product with the provider
  // identity + freshness. The caller persists it alongside the page evidence.
  onProviderIdentity?: (identity: ApifyProviderIdentity) => void;
  // Require the active per-request freshness proof (scraped_at strictly after
  // our request submit) before returning an `ok` page. DEFAULT true (fail
  // closed): when freshness is not established the page is returned as a
  // transport error so the collector HOLDS rather than finalising. Set false
  // ONLY for diagnostics that must not write prices.
  requireVerifiedFreshness?: boolean;
};

// A per-URL fetchPage that runs the actor for exactly one product URL and
// renders the single returned item as a Tesco page. One request == one run ==
// one billed product-scraped event, so the existing per-request ledger and the
// $-budget accounting line up one-to-one.
export function createApifyFetchPage(deps: ApifyFetchDeps): (url: string, maxChargeUsd?: number) => Promise<TescoPageResponse> {
  return async function fetchPageViaApify(url: string, maxChargeUsd?: number): Promise<TescoPageResponse> {
    if (!isTescoCollectionUrl(url)) throw new Error('Unsafe Tesco collection URL');
    const sku = skuFromUrl(url);
    if (!sku) throw new Error('Apify transport is product-URL only');
    const start = Date.now();
    // The freshness reference point: the instant WE submit this request. A
    // genuine upstream fetch for this request stamps scraped_at AFTER this.
    const requestSubmittedAt = new Date().toISOString();

    let run: ApifyRunResult;
    try {
      run = await deps.client.runProductUrls([url], maxChargeUsd);
    } catch {
      // Provider/transport failure. Never a silent success; the collector treats
      // this as a network error (holds, no finalisation), same as a direct fetch.
      return { outcome: 'network_error', status: null, finalUrl: url, html: '', retryAfter: null, elapsedMs: Date.now() - start };
    }

    const item = run.items.find((i) => String(i.product_id ?? '') === sku);
    if (!item) {
      // Product not returned (e.g. delisted / not found upstream). Treat as a
      // missing resource via http_error 404 so tescoResourceUnavailable applies.
      return { outcome: 'http_error', status: 404, finalUrl: url, html: '', retryAfter: null, elapsedMs: Date.now() - start };
    }

    const freshness = verifyApifyFreshness({
      scrapedAt: typeof item.scraped_at === 'string' ? item.scraped_at : null,
      requestSubmittedAt,
      runFinishedAt: run.finishedAt,
      productScrapedEvents: run.productScrapedEvents,
      itemsReturned: run.items.length,
    });

    let html: string;
    try {
      html = renderApifyProductPage(url, item);
    } catch {
      return { outcome: 'parse_error' as TescoFetchOutcome, status: 200, finalUrl: url, html: '', retryAfter: null, elapsedMs: Date.now() - start };
    }

    const bodySha256 = createHash('sha256').update(html).digest('hex');
    // The provider-origin evidence hash is over a canonical serialisation of the
    // ORIGINAL Apify item, NOT over the synthetic adapter HTML.
    const rawItemSha256 = createHash('sha256').update(JSON.stringify(item)).digest('hex');
    deps.onProviderIdentity?.({
      provider: 'apify',
      actorId: run.actorId,
      actorBuildId: run.buildId,
      actorBuildNumber: run.buildNumber,
      runId: run.runId,
      datasetId: run.datasetId,
      requestedUrl: url,
      sku,
      bodySha256,
      scrapedAt: freshness.scrapedAt,
      rawItem: item,
      rawItemSha256,
      runUsageUsd: run.usageTotalUsd,
      runUsageIsTerminal: run.usageIsTerminal,
      freshness,
    });

    // Fail-closed freshness: unless explicitly relaxed, a result whose active
    // per-request freshness proof is not met is returned as a transport error so
    // the collector HOLDS rather than finalising a possibly-stale price.
    const requireFreshness = deps.requireVerifiedFreshness !== false;
    if (requireFreshness && !freshness.preconditionMet) {
      return { outcome: 'network_error', status: null, finalUrl: url, html: '', retryAfter: null, elapsedMs: Date.now() - start };
    }

    const outcome = classifyTescoHtmlOutcome(200, html);
    return { outcome, status: 200, finalUrl: url, html, retryAfter: null, elapsedMs: Date.now() - start };
  };
}
