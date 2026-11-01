import type { TescoCollectedProduct } from './tesco-direct-collection-core';
import type { Candidate, ExecuteSql } from './tesco-supervised-collection';

// Separate from ordinary expansion: the only override is the old *hold*.
// Nothing here can grant approval, change a mapping or write a trusted price.
export type ReentryEvidence = {
  mapping: { id: string; product_id: string; canonical_name: string; canonical_brand: string | null;
    canonical_ean: string | null;
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
  independent_reason: string; reviewer_id: string;
  approval_kind: 'human' | 'machine'; machine_assessment: MachineAssessment | null;
  approved_at: string; expires_at: string;
  revoked: boolean; used: boolean;
};
export type MachineAssessment = {
  decision: 'verified_exact'; model: string; source: string; reason: string;
  mapping_id: string; source_page_id: string; source_body_sha256: string;
  validation: { independently_exact: true; checks: string[] };
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
    from (select s.id,s.product_id,p.canonical_name,p.brand canonical_brand,(to_jsonb(p)->>'ean') canonical_ean,
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
function sameBarcode(a: string | null, b: string | null) {
  if (!a || !b || !/^\d{8,14}$/.test(a) || !/^\d{8,14}$/.test(b)) return false;
  return a.replace(/^0+/, '') === b.replace(/^0+/, '');
}
function titleSupport(a: string, b: string) {
  const excluded = new Set(['the','with','and','for','from','pack','tesco','dunnes','supervalu','stores',
    'product','products','g','kg','ml','l','litre','litres','bottle']);
  const tokens = (s: string) => new Set(normalized(s).split(' ')
    .filter(x => x.length >= 3 && !excluded.has(x) && !/^\d+$/.test(x)));
  const left = tokens(a), right = tokens(b);
  return [...left].filter(x => right.has(x)).length / Math.max(1, Math.min(left.size,right.size)) >= 0.65;
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
  // Preserve decimal measures: the general identity normalizer strips periods,
  // which used to misread "1.5L" as "5L" and reject a genuine 1500ml source.
  // A comma before exactly three digits is a thousands separator (1,500ml),
  // not a decimal. Irish/EU decimal commas such as 1,5L are also accepted.
  const n = name.normalize('NFKC').toLowerCase()
    .replace(/(\d),(\d{3})(?=\D|$)/g, '$1$2')
    .replace(/(\d),(\d{1,2})(?=\D|$)/g, '$1.$2')
    .replace(/[^a-z0-9.]+/g, ' ').trim();
  const multi = n.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\b/);
  const measure = multi ?? n.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\b/);
  let amount: string | null = null;
  if (measure) {
    const value = Number(multi ? measure[2] : measure[1]);
    const unit = multi ? measure[3] : measure[2];
    amount = unit === 'kg' ? `g:${value * 1000}` : unit === 'l' || unit.startsWith('litre')
      ? `ml:${value * 1000}` : `${unit}:${value}`;
  }
  // Retailer pages often describe a multipack as "7 sticks", "21 dental
  // sticks" or "3 bars", not "7 Pack". Never treat an undisclosed count as
  // evidence that an explicitly different count is safe.
  const count = multi ? Number(multi[1])
    : n.match(/\b(\d+)\s+(?:(?:standard|dental|jumbo|mini|large|small|sausage)\s+)?(?:rolls?|sheets?|pieces?|packs?|pk|pairs?|sticks?|bars?|pouches?|sachets?|chews?|pods?|cubes?|tablets?|bottles?|tubes?)\b/);
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
  return false;
}
function peerIdentityConflict(e: ReentryEvidence, source: TescoCollectedProduct, peer: ReentryEvidence['peers'][number]) {
  const tesco = declaredPack(source.name), other = declaredPack(peer.store_product_name);
  return canonicalVariantConflict(source.name, peer.store_product_name)
    || (tesco.amount != null && other.amount != null && tesco.amount !== other.amount)
    || (tesco.units != null && other.units != null && tesco.units !== other.units);
}
function sufficientIndependentSupport(e: ReentryEvidence, source: TescoCollectedProduct) {
  const m=e.mapping;
  if (!source.brand) return false;
  // Even if the Tesco EAN itself is exact, a contradictory existing retailer
  // peer would create an inaccurate multi-retailer comparison when finalised.
  // Until that canonical peer is audited/corrected, keep the mapping held.
  if (e.peers.some(peer=>peerIdentityConflict(e,source,peer))) return false;
  // Two fresh price records alone are not identity evidence: a same-size but
  // unrelated product at both other shops must never grant hold re-entry.
  // Require at least one corroborating peer name even for a barcode match;
  // human review separately checks the other peer's equivalence.
  if (e.peers.length && !e.peers.some(peer => titleSupport(source.name, peer.store_product_name)))
    return false;
  // A branded canonical product cannot silently compare a different branded
  // manufacturer's product just because the quantity and variant line up.
  // Generic/unbranded canonical products may have cross-retailer equivalents.
  const canonicalBrand = m.canonical_brand;
  if (canonicalBrand && e.peers.some(peer => peer.brand && !sameBrand(canonicalBrand, peer.brand)))
    return false;
  // A canonical EAN matching the page is independent exact-product evidence;
  // retailer coverage is a commercial property, not a prerequisite.
  if (sameBarcode(m.canonical_ean,source.gtin)) return true;
  if (e.peers.length===2)
    // Keep the previously approved dual-peer safety floor unchanged.
    return true;
  if (e.peers.length===1) {
    const peer=e.peers[0];
    // One peer can corroborate identity only with a positive brand, title and
    // pack match. AI reviewer rationale alone cannot replace these checks.
    return m.canonical_brand!=null && sameBrand(m.canonical_brand,source.brand)
      && (peer.brand==null ? normalized(peer.store_product_name).includes(normalized(m.canonical_brand))
        : sameBrand(peer.brand,source.brand))
      && titleSupport(source.name,peer.store_product_name)
      && !peerIdentityConflict(e,source,peer);
  }
  // Without a fresh peer or a canonical-to-Tesco barcode, only historical
  // receipts and mapped Tesco metadata remain; those are insufficient.
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
    || !Array.isArray(e.peers) || e.peers.length>2
    || new Set(e.peers.map(p => p.store)).size !== e.peers.length
    || e.peers.some(p=>!['dunnes','supervalu'].includes(p.store))
    || e.peers.some(p => !p.observed_at || !p.store_product_name || !(Number(p.price) > 0))
    || source.sku !== m.store_sku || source.url !== m.store_url
    || !source.name || !source.brand || !source.quantity
    || (m.gtin != null && m.gtin !== source.gtin)
    || (m.canonical_ean != null && !sameBarcode(m.canonical_ean,source.gtin))
    || (m.store_brand != null && !sameBrand(m.store_brand, source.brand))
    || (m.canonical_brand != null && !sameBrand(m.canonical_brand, source.brand))
    || independentPackConflict(e, source)
    || canonicalVariantConflict(m.canonical_name, source.name)
    || !sufficientIndependentSupport(e,source)) return false;
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

// The legacy lexical validator can reject an exact, independently evidenced
// held product solely because the canonical description is incomplete or uses
// a different measurement convention. These TWO negative predicates may be
// resolved only by an approved, evidence-bound hold re-entry, and only after
// the original source and NEW live product pass the stronger positive gate.
// In particular, no conflict, missing price, SKU ambiguity or ordinary
// expansion/renewal may use this exception.
const REVIEWED_CANONICAL_EVIDENCE_GAPS = new Set([
  'candidate does not establish full exact canonical identity',
  'measureExactnessFailed',
]);
export function reviewedCanonicalEvidenceGap(
  evidence: ReentryEvidence, live: TescoCollectedProduct, reasons: readonly string[],
): boolean {
  return reasons.length > 0 && reasons.every(reason => REVIEWED_CANONICAL_EVIDENCE_GAPS.has(reason))
    && independentExactIdentity(evidence, live);
}

// Review approval is a separately authenticated, accountable human act,
// never inferred by this runner or accepted from an arbitrary name string.
export function approvedReview(r: ReviewRecord, current: ReentryEvidence | null): boolean {
  const snap = r.evidence_snapshot;
  return !!current && !r.revoked && !r.used
    && ID.test(r.reviewer_id) && r.independent_reason.trim().length >= 30
    && (r.approval_kind === 'human' || (r.approval_kind === 'machine'
      && r.machine_assessment?.decision === 'verified_exact'
      && typeof r.machine_assessment.model === 'string' && r.machine_assessment.model.trim().length >= 3
      && typeof r.machine_assessment.reason === 'string' && r.machine_assessment.reason.trim().length >= 30
      && r.machine_assessment.mapping_id === r.store_product_id
      && r.machine_assessment.source_page_id === r.source_page_id
      && r.machine_assessment.source_body_sha256 === snap?.page?.body_sha256
      && r.machine_assessment.validation?.independently_exact === true))
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
      overlap: r.evidence.peers.length, peers: [{ id: m.id, product_id: m.product_id, canonical_name: m.canonical_name,
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
      and v.reviewer_id is not null and length(trim(v.independent_reason))>=30
      and (v.approval_kind='human' or (v.approval_kind='machine'
        and v.machine_assessment->>'decision'='verified_exact'
        and v.machine_assessment->>'mapping_id'=v.store_product_id::text
        and v.machine_assessment->>'source_page_id'=v.source_page_id::text
        and v.machine_assessment->>'source_body_sha256'=v.evidence_snapshot #>> '{page,body_sha256}'))
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
