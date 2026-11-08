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

// ESTABLISHED actor retrieval/cache behaviour (from the actor's public docs +
// our own request logs; probed 2026-11-08, actor parsebird/tesco-scraper):
//   • Docs describe a live scrape by product URL/search; there is NO documented
//     or API-exposed cache-hit / cache-age field.
//   • `scraped_at` is a provider-ASSERTED retrieval timestamp. In back-to-back
//     runs of one product it advanced each run (20:38:51 → :57 → 20:39:21),
//     consistent with (but NOT proof of) a per-run upstream fetch — the actor
//     could stamp scraped_at at response-assembly time regardless of a short
//     internal cache.
//   • `product-scraped` BILLING is INCONSISTENT for identical work (0 then 1),
//     so it is NOT a freshness signal.
//
// HONEST CONCLUSION (correcting the earlier over-claim): a single item's
// `scraped_at > requestSubmittedAt` is a provider-asserted timestamp. On its
// own it does NOT prove an upstream fetch. We therefore treat per-item
// scraped_at as a NECESSARY precondition only, and establish freshness with an
// independent, bounded corroboration PER BATCH (not per product): a freshness
// AUDIT that re-runs the actor once for a single already-seen URL and checks
// that `scraped_at` genuinely ADVANCES versus the first observation. A live
// scraper advances it; a static/replayed dataset would return an identical or
// older stamp. If the audit advances, the batch's provider behaviour is
// corroborated as live for this window and items whose scraped_at is after
// their own submit qualify. If the audit cannot be established (no advance,
// missing/implausible stamp, or audit error), the WHOLE batch's freshness is
// NOT established and every result in it is HELD. Cost: one extra request per
// batch, not per product.
export type ApifyFreshnessLevel =
  | 'after_submit_precondition_met'  // scraped_at present + strictly after submit (necessary, not yet sufficient)
  | 'not_after_submit'               // at/<= submit (possible replay) → hold
  | 'implausible_future'             // beyond skew margin ahead → hold
  | 'no_timestamp';                  // provider gave no scraped_at → hold
export type ApifyFreshness = {
  // scraped_at the provider reported for this item.
  scrapedAt: string | null;
  // The instant WE submitted this request (the freshness reference point).
  requestSubmittedAt: string;
  // scraped_at strictly after requestSubmittedAt (NECESSARY precondition).
  afterSubmit: boolean;
  // Billed product-scraped events for the run (audit only; NOT a signal).
  productScrapedEvents: number;
  level: ApifyFreshnessLevel;
  // Per-item PRECONDITION only. Final qualification also needs the per-batch
  // audit (batchFreshnessEstablished) — enforced by the collector.
  perItemPreconditionMet: boolean;
  reason: string;
};

// Result of the per-batch freshness audit (one re-run of an already-seen URL).
export type ApifyBatchFreshnessAudit = {
  auditedUrl: string | null;
  firstScrapedAt: string | null;
  secondScrapedAt: string | null;
  advanced: boolean;        // secondScrapedAt strictly after firstScrapedAt
  established: boolean;     // advanced AND both timestamps present/plausible
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

// Per-item freshness PRECONDITION (necessary, not sufficient). scraped_at must
// be present and strictly after our request submit, and not implausibly future.
// This is a provider-asserted timestamp — it does NOT by itself prove an
// upstream fetch; final qualification also requires the per-batch audit.
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
  else if (afterSubmit) level = 'after_submit_precondition_met';
  else level = 'not_after_submit';
  const perItemPreconditionMet = level === 'after_submit_precondition_met';
  const reason = !hasTimestamp
    ? 'provider returned no scraped_at — freshness precondition fails; hold'
    : implausibleFuture
      ? 'scraped_at implausibly in the future vs local clock — held'
      : afterSubmit
        ? 'scraped_at present and after submit (NECESSARY precondition; still needs the per-batch audit to establish live behaviour)'
        : 'scraped_at at/before our submit — possible cached/replayed item; held';
  return {
    scrapedAt: args.scrapedAt, requestSubmittedAt: args.requestSubmittedAt,
    afterSubmit, productScrapedEvents: args.productScrapedEvents, level, perItemPreconditionMet, reason,
  };
}

// Per-batch freshness audit: re-run the actor ONCE for an already-seen URL and
// confirm `scraped_at` strictly advances versus the first observation. This
// corroborates that the actor is performing live retrievals for this batch
// window (a static/replayed dataset would not advance). One extra request per
// batch. If it cannot be established, the collector holds the WHOLE batch.
export async function auditBatchFreshness(
  client: { runProductUrls(urls: string[]): Promise<{ items: Array<Record<string, unknown>> }> },
  auditedUrl: string | null,
  firstScrapedAt: string | null,
): Promise<ApifyBatchFreshnessAudit> {
  const skew = 5 * 60_000;
  if (!auditedUrl || !firstScrapedAt) {
    return { auditedUrl, firstScrapedAt, secondScrapedAt: null, advanced: false, established: false,
      reason: 'no audited URL/first timestamp available — batch freshness not established' };
  }
  let secondScrapedAt: string | null = null;
  try {
    const sku = skuFromUrl(auditedUrl);
    const run = await client.runProductUrls([auditedUrl]);
    const item = run.items.find((i) => String(i.product_id ?? '') === sku);
    secondScrapedAt = item && typeof item.scraped_at === 'string' ? item.scraped_at : null;
  } catch {
    return { auditedUrl, firstScrapedAt, secondScrapedAt: null, advanced: false, established: false,
      reason: 'audit re-run failed — batch freshness not established' };
  }
  const first = Date.parse(firstScrapedAt);
  const second = secondScrapedAt ? Date.parse(secondScrapedAt) : NaN;
  const bothValid = Number.isFinite(first) && Number.isFinite(second) && second <= Date.now() + skew;
  const advanced = bothValid && second > first;
  return {
    auditedUrl, firstScrapedAt, secondScrapedAt, advanced,
    established: advanced,
    reason: advanced
      ? 'audit re-run advanced scraped_at — actor retrieval is live for this batch window'
      : !secondScrapedAt ? 'audit re-run returned no scraped_at — not established'
        : 'audit re-run did not advance scraped_at — static/replayed; batch held',
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
export function createApifyFetchPage(deps: ApifyFetchDeps): (url: string) => Promise<TescoPageResponse> {
  return async function fetchPageViaApify(url: string): Promise<TescoPageResponse> {
    if (!isTescoCollectionUrl(url)) throw new Error('Unsafe Tesco collection URL');
    const sku = skuFromUrl(url);
    if (!sku) throw new Error('Apify transport is product-URL only');
    const start = Date.now();
    // The freshness reference point: the instant WE submit this request. A
    // genuine upstream fetch for this request stamps scraped_at AFTER this.
    const requestSubmittedAt = new Date().toISOString();

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
      freshness,
    });

    // Fail-closed freshness: unless explicitly relaxed, a result whose active
    // per-request freshness proof is not met is returned as a transport error so
    // the collector HOLDS rather than finalising a possibly-stale price.
    const requireFreshness = deps.requireVerifiedFreshness !== false;
    if (requireFreshness && !freshness.perItemPreconditionMet) {
      return { outcome: 'network_error', status: null, finalUrl: url, html: '', retryAfter: null, elapsedMs: Date.now() - start };
    }

    const outcome = classifyTescoHtmlOutcome(200, html);
    return { outcome, status: 200, finalUrl: url, html, retryAfter: null, elapsedMs: Date.now() - start };
  };
}
