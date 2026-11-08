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
  // Freshness evidence (see verifyApifyFreshness).
  freshness: ApifyFreshness;
};

// Established actor retrieval/cache behaviour (empirically probed 2026-11-08,
// actor parsebird/tesco-scraper, three back-to-back runs of the same product):
//   • `scraped_at` is stamped with the actor's OWN retrieval time and advances
//     on every run (20:38:51 → 20:38:57 → 20:39:21 across three runs seconds
//     apart) — consistent with a per-run upstream fetch, not a fixed cache stamp;
//   • the `product-scraped` BILLING event is INCONSISTENT for identical work
//     (0 on one run, 1 on the next) — so a billed event is NOT a reliable proof
//     of a fresh upstream read and must not be used as a freshness signal;
//   • the actor exposes NO cache-hit / cache-age field. The only freshness
//     signal available is `scraped_at` plus the `source` URL.
// Therefore "uncached upstream retrieval" CANNOT be independently PROVEN from
// the provider's response. The honest policy: require `scraped_at` inside the
// run window (necessary), classify that as corroborated-but-unproven, and hold
// any result whose `scraped_at` is missing or outside the window.
export type ApifyFreshnessLevel = 'in_window_unproven_cache' | 'stale_or_out_of_window' | 'no_timestamp';
export type ApifyFreshness = {
  // scraped_at the provider reported for this item.
  scrapedAt: string | null;
  // Whether scraped_at falls inside this run's own window (necessary condition).
  withinRunWindow: boolean;
  // Billed product-scraped events for the run (RECORDED for audit only; NOT a
  // freshness signal — the actor bills this inconsistently for identical work).
  productScrapedEvents: number;
  level: ApifyFreshnessLevel;
  // Whether the minimum required freshness (scraped_at in-window) is met. We do
  // NOT claim proof of an uncached upstream read — only that the provider's own
  // retrieval timestamp is consistent with this run.
  requiredFreshnessMet: boolean;
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
  usageTotalUsd: number;
};

export interface ApifyRunClient {
  // Run the actor for a bounded set of product URLs and return the dataset
  // items plus the run's billing/provenance. One run per batch.
  runProductUrls(urls: string[]): Promise<ApifyRunResult>;
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
    async runProductUrls(urls: string[]): Promise<ApifyRunResult> {
      if (!urls.length || urls.length > options.maxItems) {
        throw new Error('Apify run requires 1..maxItems product URLs');
      }
      const input = {
        startUrls: urls,
        region: 'IE',
        maxItems: options.maxItems,
        includeProductDetails: true,
        includeReviews: false,
        deduplicateProducts: true,
        proxyConfiguration: { useApifyProxy: false },
      };
      const start = await (await authed(`/acts/${ACTOR}/runs?maxItems=${options.maxItems}`, {
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
        usageTotalUsd: Number(run.usageTotalUsd ?? 0),
      };
    },
  };
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

// ---- Freshness verification ---------------------------------------------------

// Freshness verdict based on the ESTABLISHED actor behaviour above. The minimum
// required freshness is: a `scraped_at` present and inside this run's window.
// We deliberately DO NOT assert proof of an uncached upstream read — the
// provider offers no signal that could establish it (billing is inconsistent;
// no cache field exists). Missing or out-of-window timestamps are held.
export function verifyApifyFreshness(args: {
  scrapedAt: string | null;
  runStartedAt: string;
  runFinishedAt: string | null;
  productScrapedEvents: number;
  itemsReturned: number;
}): ApifyFreshness {
  const start = Date.parse(args.runStartedAt);
  const end = args.runFinishedAt ? Date.parse(args.runFinishedAt) : Date.now();
  const scraped = args.scrapedAt ? Date.parse(args.scrapedAt) : NaN;
  // Allow a small clock-skew margin either side of the run window.
  const margin = 5 * 60_000;
  const hasTimestamp = Number.isFinite(scraped);
  const withinRunWindow = hasTimestamp && scraped >= start - margin && scraped <= end + margin;
  const level: ApifyFreshnessLevel = !hasTimestamp ? 'no_timestamp'
    : withinRunWindow ? 'in_window_unproven_cache' : 'stale_or_out_of_window';
  const requiredFreshnessMet = withinRunWindow;
  const reason = !hasTimestamp
    ? 'provider returned no scraped_at — required freshness cannot be established; hold'
    : withinRunWindow
      ? 'scraped_at falls within this run window (provider retrieval timestamp consistent with this run); upstream cache state not independently provable'
      : 'scraped_at falls outside this run window — required freshness not met; hold';
  return { scrapedAt: args.scrapedAt, withinRunWindow, productScrapedEvents: args.productScrapedEvents, level, requiredFreshnessMet, reason };
}

// ---- The fetchPage transport --------------------------------------------------

export type ApifyFetchDeps = {
  client: ApifyRunClient;
  // Optional provenance sink called once per fetched product with the provider
  // identity + freshness. The caller persists it alongside the page evidence.
  onProviderIdentity?: (identity: ApifyProviderIdentity) => void;
  // Require the minimum established freshness (scraped_at present and in the run
  // window) before returning an `ok` page. When it cannot be established the
  // page is returned as a transport error so the collector HOLDS rather than
  // finalising a result whose freshness is unknown. This does NOT claim proof
  // of an uncached upstream read (the provider cannot establish that).
  requireVerifiedFreshness?: boolean;
};

// A per-URL fetchPage that runs the actor for exactly one product URL and
// renders the single returned item as a Tesco page. One request == one run ==
// one billed product-scraped event, so the existing per-request ledger and the
// $-budget accounting line up one-to-one.
export function createApifyFetchPage(deps: ApifyFetchDeps): (url: string) => Promise<TescoPageResponse> {
  return async function fetchPageViaApify(url: string): Promise<TescoPageResponse> {
    if (!isTescoCollectionUrl(url)) throw new Error('Unsafe Tesco collection URL');
    const sku = skuFromUrl(url);
    if (!sku) throw new Error('Apify transport is product-URL only');
    const start = Date.now();

    let run: ApifyRunResult;
    try {
      run = await deps.client.runProductUrls([url]);
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
      runStartedAt: run.startedAt,
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
      freshness,
    });

    // If the minimum established freshness is required and not met, return a
    // transport error so the collector holds rather than finalising a result
    // whose freshness is unknown.
    if (deps.requireVerifiedFreshness && !freshness.requiredFreshnessMet) {
      return { outcome: 'network_error', status: null, finalUrl: url, html: '', retryAfter: null, elapsedMs: Date.now() - start };
    }

    const outcome = classifyTescoHtmlOutcome(200, html);
    return { outcome, status: 200, finalUrl: url, html, retryAfter: null, elapsedMs: Date.now() - start };
  };
}
