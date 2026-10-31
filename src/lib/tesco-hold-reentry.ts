import type { TescoCollectedProduct } from './tesco-direct-collection-core';
import type { Candidate, ExecuteSql } from './tesco-supervised-collection';

// Separate from ordinary expansion: the only override is the old *hold*.
// Nothing here can grant approval, change a mapping or write a trusted price.
export type ReentryEvidence = {
  mapping: { id: string; product_id: string; canonical_name: string; canonical_brand: string | null;
    store_product_name: string; store_brand: string | null; is_own_brand: boolean;
    store_sku: string; store_url: string; url_status: string; gtin: string | null };
  sameSkuCount: number;
  page: { id: string; requested_url: string; final_url: string; outcome: string;
    http_status: number; body_sha256: string; mode: string;
    parsed: { products: TescoCollectedProduct[]; listing: unknown } };
  sourceRun: { status: string; finished_at: string | null };
  peers: { id: string; store: string; store_product_name: string; brand: string | null;
    gtin: string | null; store_sku: string; observed_at: string; price: number }[];
  proven: boolean; freshTesco: boolean; pending: boolean; recentAttempt: boolean;
};
export type Reentry = { reviewId: string; sourcePageId: string; evidence: ReentryEvidence };
export type ReviewRecord = {
  id: string; store_product_id: string; source_page_id: string; evidence_snapshot: ReentryEvidence;
  independent_reason: string; assessed_by: string; approved_by: string;
  approved_at: string; expires_at: string;
  revoked: boolean; used: boolean;
};
const ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function reviewedUuid(id: string): string {
  if (!ID.test(id)) throw new Error('Invalid reviewed candidate ID');
  return `'${id}'`;
}

// This is the *reviewer's* immutable, database-derived evidence bundle.
// The entire value is compared again under the runner lease both before
// reservation and inside the guarded finalisation transaction.
export function reentryEvidenceSql(storeProductId: string, sourcePageId: string) {
  return reentryEvidenceSqlWithRefs(reviewedUuid(storeProductId), reviewedUuid(sourcePageId));
}
function reentryEvidenceSqlWithRefs(storeIdSql: string, sourcePageSql: string, ownRun?: string) {
  const excludeOwn = ownRun ? `and x.run_id<>${reviewedUuid(ownRun)}` : '';
  return `(select jsonb_build_object(
    'mapping',to_jsonb(m),
    'sameSkuCount',(select count(*) from store_products x where x.store='tesco' and x.store_sku=m.store_sku),
    'page',jsonb_build_object('id',d.id,'requested_url',d.requested_url,'final_url',d.final_url,
      'outcome',d.outcome,'http_status',d.http_status,'body_sha256',d.body_sha256,'mode',d.mode,'parsed',d.parsed),
    'sourceRun',jsonb_build_object('status',r.status,'finished_at',r.finished_at),
    'peers',coalesce((select jsonb_agg(to_jsonb(q) order by q.store,q.id) from (
      select s.id,s.store,s.store_product_name,s.brand,s.gtin,s.store_sku,l.observed_at,l.price
      from store_products s join latest_prices l on l.store_product_id=s.id
      where s.product_id=m.product_id and s.store in ('dunnes','supervalu')) q),'[]'::jsonb),
    'proven',exists(select 1 from scrape_product_receipts z where z.store_product_id=m.id and z.outcome='success'),
    'freshTesco',exists(select 1 from latest_prices l where l.store_product_id=m.id),
    'pending',exists(select 1 from tesco_direct_collection_pages x where x.requested_url=m.store_url and x.outcome='pending'
      ${excludeOwn}),
    'recentAttempt',exists(select 1 from tesco_direct_collection_pages x where x.requested_url=m.store_url
      and x.created_at>now()-interval '24 hours' ${excludeOwn}))
    from (select s.id,s.product_id,p.canonical_name,p.brand canonical_brand,
      s.store_product_name,s.brand store_brand,s.is_own_brand,s.store_sku,s.store_url,s.url_status,s.gtin
      from store_products s join products p on p.id=s.product_id
      where s.id=${storeIdSql} and s.store='tesco') m
    join tesco_direct_collection_pages d on d.id=${sourcePageSql}
    join scrape_runs r on r.id=d.run_id)`;
}

function normalized(input: string | null | undefined) {
  return (input ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function sameBrand(a: string, b: string) {
  // Retailer structured brands vary in separator spacing (7UP / 7 UP).
  return normalized(a).replaceAll(' ', '') === normalized(b).replaceAll(' ', '');
}
function qualifiers(name: string) {
  // Safety-first invariant attributes. The deterministic validator previously
  // missed "orange juice" vs "orange juice drink" and unadvertised citrus.
  const groups = [
    /\bjuice drink\b/, /\bcitrus\b/, /\blemon\b/, /\blime\b/, /\bvanilla\b/,
    /\bchocolate\b/, /\bstrawberry\b/, /\bzero\b/, /\bdiet\b/,
    /\bsugar free\b/, /\bgluten free\b/, /\borganic\b/,
    /\b(?:extra|mature) (?:strong|cheddar)\b/, /\b(?:milk|cream) chocolate\b/,
  ];
  return groups.map(regex => regex.test(normalized(name)));
}
function canonicalVariantConflict(canonical: string, tesco: string) {
  const a = qualifiers(canonical), b = qualifiers(tesco);
  return a.some((flag, index) => flag !== b[index]);
}
function declaredPack(name: string) {
  const n = normalized(name);
  const multi = n.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\b/);
  const measure = multi ?? n.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\b/);
  let amount: string | null = null;
  if (measure) {
    const value = Number(multi ? measure[2] : measure[1]);
    const unit = multi ? measure[3] : measure[2];
    amount = unit === 'kg' ? `g:${value * 1000}` : unit === 'l' || unit.startsWith('litre')
      ? `ml:${value * 1000}` : `${unit}:${value}`;
  }
  const count = multi ? Number(multi[1])
    : n.match(/\b(\d+)\s+(?:standard\s+)?(?:rolls?|sheets?|pieces?|packs?|pk|pairs?)\b/);
  // If a product has a stated unit size and no explicit multipack, treat it
  // conservatively as a single unit. "110g" must not silently match "3x110g".
  const units = typeof count === 'number' ? count : count ? Number(count[1]) : amount ? 1 : null;
  return { amount, units };
}
function structuredMeasure(quantity: TescoCollectedProduct['quantity']) {
  if (!quantity) return null;
  const entries = Object.entries(quantity).filter(([, value]) => Number(value) > 0);
  if (entries.length !== 1) return null;
  const [unit, value] = entries[0];
  return `${unit === 'grams' ? 'g' : unit === 'millilitres' ? 'ml' : 'piece'}:${value}`;
}
function independentPackConflict(e: ReentryEvidence, source: TescoCollectedProduct) {
  const canonical = declaredPack(e.mapping.canonical_name), tesco = declaredPack(source.name);
  const structured = structuredMeasure(source.quantity);
  if (canonical.amount && tesco.amount && canonical.amount !== tesco.amount) return true;
  if (canonical.amount && structured && canonical.amount !== structured
    && tesco.units === 1) return true;
  if (canonical.units != null && tesco.units != null && canonical.units !== tesco.units) return true;
  // Fresh third-party equivalents do not independently prove *brand*, but
  // known explicit units/pack sizes must not contradict the Tesco identity.
  for (const peer of e.peers) {
    const other = declaredPack(peer.store_product_name);
    if (tesco.amount && other.amount && tesco.amount !== other.amount) return true;
    if (tesco.units != null && other.units != null && tesco.units !== other.units) return true;
  }
  return false;
}
export function independentExactIdentity(e: ReentryEvidence, live?: TescoCollectedProduct): boolean {
  const m = e.mapping, source = e.page?.parsed?.products?.[0];
  if (!m || !source || e.page.parsed.products.length !== 1 || e.page.parsed.listing != null
    || Number(e.sameSkuCount) !== 1 || !e.proven || e.freshTesco || e.pending || e.recentAttempt
    || m.url_status !== 'resolved' || !/^\d{6,12}$/.test(m.store_sku)
    || m.store_url !== `https://www.tesco.ie/shop/en-IE/products/${m.store_sku}`
    || e.page.outcome !== 'ok' || Number(e.page.http_status) !== 200 || e.page.mode !== 'products'
    || !/^[a-f0-9]{64}$/.test(e.page.body_sha256)
    || e.page.requested_url !== m.store_url || e.page.final_url !== m.store_url
    || !['success', 'degraded'].includes(e.sourceRun?.status) || !e.sourceRun?.finished_at
    || !Array.isArray(e.peers) || e.peers.length !== 2
    || new Set(e.peers.map(p => p.store)).size !== 2
    || !e.peers.some(p => p.store === 'dunnes') || !e.peers.some(p => p.store === 'supervalu')
    || e.peers.some(p => !p.observed_at || !p.store_product_name || !(Number(p.price) > 0))
    || source.sku !== m.store_sku || source.url !== m.store_url
    || !source.name || !source.brand || !source.quantity
    || (m.gtin != null && m.gtin !== source.gtin)
    || (m.store_brand != null && !sameBrand(m.store_brand, source.brand))
    || (m.canonical_brand != null && !sameBrand(m.canonical_brand, source.brand))
    || independentPackConflict(e, source)
    || canonicalVariantConflict(m.canonical_name, source.name)) return false;
  // The source's exact brand, pack, barcode and variant become immutable
  // constraints on the NEW live page. A changed SKU/name/pack/brand/GTIN
  // cannot inherit the approval. New price is never taken from the source.
  if (!live) return true;
  return live.sku === source.sku && live.url === source.url
    && !!live.available && live.currency === 'EUR' && live.price !== null && live.price > 0
    && normalized(live.name) === normalized(source.name)
    && normalized(live.brand) === normalized(source.brand)
    && JSON.stringify(live.quantity) === JSON.stringify(source.quantity)
    && (source.gtin == null || live.gtin === source.gtin)
    && !canonicalVariantConflict(m.canonical_name, live.name);
}

// Review approval is a separate two-person act, never inferred by this runner.
export function approvedReview(r: ReviewRecord, current: ReentryEvidence | null): boolean {
  const snap = r.evidence_snapshot;
  return !!current && !r.revoked && !r.used
    && r.assessed_by.trim().length >= 3 && r.approved_by.trim().length >= 3
    && r.assessed_by !== r.approved_by && r.independent_reason.trim().length >= 30
    && Date.parse(r.approved_at) <= Date.now() && Date.parse(r.expires_at) > Date.now()
    && r.store_product_id === snap?.mapping?.id && r.source_page_id === snap?.page?.id
    && JSON.stringify(snap) === JSON.stringify(current)
    && independentExactIdentity(current);
}

export async function selectReviewedCandidates(execute: ExecuteSql, reviewIds: string[]): Promise<Candidate[]> {
  if (!reviewIds.length || reviewIds.length > 100 || new Set(reviewIds).size !== reviewIds.length)
    throw new Error('Select 1–100 distinct reviewed candidate IDs');
  reviewIds.forEach(reviewedUuid);
  const selected: Candidate[] = [];
  for (const reviewId of reviewIds) {
    const [row] = await execute(`select v.*,exists(select 1 from tesco_hold_reentry_revocations x where x.review_id=v.id) revoked,
      exists(select 1 from tesco_hold_reentry_uses x where x.review_id=v.id) used,
      ${reentryEvidenceSqlWithRefs('v.store_product_id', 'v.source_page_id')} evidence
      from tesco_hold_reentry_reviews v where v.id=${reviewedUuid(reviewId)}`);
    const r = row as unknown as ReviewRecord & { evidence: ReentryEvidence | null } | undefined;
    if (!r || !r.evidence || !approvedReview(r, r.evidence)) continue;
    const m = r.evidence.mapping;
    selected.push({ ...m, observed_at: null, price: null, due: false, held: true, proven: true,
      overlap: 2, peers: [{ id: m.id, product_id: m.product_id, canonical_name: m.canonical_name,
        canonical_brand: m.canonical_brand, store_product_name: m.store_product_name, store_brand: m.store_brand,
        is_own_brand: m.is_own_brand, store_sku: m.store_sku, store_url: m.store_url, url_status: m.url_status }],
      reentry: { reviewId: r.id, sourcePageId: r.source_page_id, evidence: r.evidence } });
  }
  if (new Set(selected.map(c => c.store_url)).size !== selected.length)
    throw new Error('Overlapping reviewed approvals for the same Tesco URL');
  return selected;
}

// Runtime assertions use exactly the same query shape as selection, and include
// revocation and one-time use. No run can change the evidence after selection.
export function assertReentry(target: Candidate, runId: string, reserved: boolean) {
  if (!target.reentry) return '';
  const id = reviewedUuid(target.reentry.reviewId);
  const evidence = reentryEvidenceSqlWithRefs('v.store_product_id', 'v.source_page_id', reserved ? runId : undefined);
  const encoded = literalEvidence(target.reentry.evidence);
  return `perform 1 from tesco_hold_reentry_reviews where id=${id} for update;
    perform 1 from tesco_direct_collection_pages where id=${reviewedUuid(target.reentry.sourcePageId)} for share;
    perform 1 from store_products where id=${reviewedUuid(target.id)} for share;
    if not exists(select 1 from tesco_hold_reentry_reviews v where v.id=${id}
      and v.store_product_id=${reviewedUuid(target.id)}
      and v.source_page_id=${reviewedUuid(target.reentry.sourcePageId)}
      and v.approved_at<=now() and v.expires_at>now()
      and v.assessed_by<>v.approved_by and length(trim(v.independent_reason))>=30
      and v.evidence_snapshot=${encoded}::jsonb
      and ${evidence}=${encoded}::jsonb
      and not exists(select 1 from tesco_hold_reentry_revocations x where x.review_id=v.id)
      and ${reserved ? `exists(select 1 from tesco_hold_reentry_uses u where u.review_id=v.id and u.run_id=${reviewedUuid(runId)})`
        : 'not exists(select 1 from tesco_hold_reentry_uses u where u.review_id=v.id)'})
    then raise exception 'reentry_review_changed_or_used'; end if;`;
}
export function consumeReentry(target: Candidate, runId: string) {
  return target.reentry ? `insert into tesco_hold_reentry_uses(review_id,run_id)
    values(${reviewedUuid(target.reentry.reviewId)},${reviewedUuid(runId)});` : '';
}
function literalEvidence(value: unknown) {
  return `E'${JSON.stringify(value).replaceAll('\\', '\\\\').replaceAll("'", "''").replaceAll('$', '\\044')}'`;
}
