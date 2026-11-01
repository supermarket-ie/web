import type { ExecuteSql } from './tesco-supervised-collection';

// Read-only *triage*, NOT review approval. A language-model operator can inspect
// the ranked evidence and explain nonliteral naming equivalence; this scorer
// cannot create approval rows or relax the exact live identity guard.
export type HeldReviewRow = {
  id: string; store_sku: string; canonical_name: string; canonical_brand: string | null;
  store_product_name: string; store_brand: string | null; gtin: string | null;
  proven: boolean; historical_observations: number;
  peers: { store: string; name: string; brand: string | null; gtin: string | null }[];
  source: { page_id: string; body_sha256: string; name: string; brand: string | null;
    gtin: string | null; quantity: { grams?: number; millilitres?: number; pieces?: number } | null;
    identity_results: unknown[] } | null;
};
export type ReviewHypothesis = HeldReviewRow & {
  score: number; hypothesis: 'likely_exact' | 'conflict' | 'needs_evidence';
  evidenceFor: string[]; concerns: string[]; approval: 'independent_review_required';
};
function norm(text: string | null | undefined) {
  return (text ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const STOP_WORDS = new Set(['tesco', 'dunnes', 'stores', 'supervalu', 'pack', 'and', 'with', 'the', 'for', 'a', 'of']);
function tokens(text: string) {
  return new Set(norm(text).split(' ').filter(t => t.length >= 3 && !STOP_WORDS.has(t)));
}
function similarity(a: string, b: string) {
  const x = tokens(a), y = tokens(b);
  return [...x].filter(t => y.has(t)).length / Math.max(1, new Set([...x, ...y]).size);
}
function amount(text: string) {
  const input = norm(text);
  const m = input.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|litres?|l|rolls?|sheets?|pieces?|pk)\b/);
  if (m) {
    const value = Number(m[1]), unit = m[2];
    if (unit === 'kg') return `g:${value * 1000}`;
    if (unit === 'l' || unit.startsWith('litre')) return `ml:${value * 1000}`;
    if (unit.startsWith('roll')) return `roll:${value}`;
    if (unit.startsWith('sheet')) return `sheet:${value}`;
    if (unit === 'pk' || unit.startsWith('piece')) return `piece:${value}`;
    return `${unit}:${value}`;
  }
  const roll = input.match(/\b(\d+)\s+(?:standard\s+)?rolls?\b/);
  return roll ? `roll:${Number(roll[1])}` : null;
}
function quantity(q: HeldReviewRow['source']) {
  if (!q || !q.quantity) return null;
  const entries = Object.entries(q.quantity).filter(([, value]) => Number(value) > 0);
  return entries.length === 1 ? `${entries[0][0] === 'grams' ? 'g' : entries[0][0] === 'millilitres' ? 'ml' : 'piece'}:${entries[0][1]}` : null;
}
export function rankHeldReviewEvidence(rows: HeldReviewRow[]): ReviewHypothesis[] {
  return rows.map(row => {
    const concerns: string[] = [], evidenceFor: string[] = [];
    const source = row.source, peerNames = row.peers.map(p => p.name);
    if (row.proven) evidenceFor.push('historical_success_receipt');
    else concerns.push('no_historical_success_receipt');
    if (row.historical_observations > 0) evidenceFor.push('historical_price_observations');
    if (!source || !/^[a-f0-9]{64}$/.test(source.body_sha256)) concerns.push('no_retained_hashed_tesco_product_page');
    else evidenceFor.push('retained_hashed_tesco_page');
    if (row.peers.length !== 2 || new Set(row.peers.map(p => p.store)).size !== 2)
      concerns.push('fresh_peer_coverage_incomplete');
    else evidenceFor.push('both_fresh_retailer_peers');
    const canonicalAmount = amount(row.canonical_name);
    const sourceAmount = source ? amount(source.name) : null;
    const structured = quantity(source);
    if (canonicalAmount && sourceAmount && canonicalAmount !== sourceAmount)
      concerns.push('canonical_tesco_pack_or_measure_conflict');
    if (canonicalAmount && structured && canonicalAmount !== structured)
      concerns.push('canonical_tesco_structured_quantity_conflict');
    if (!structured) concerns.push('no_single_structured_quantity');
    if (source && source.gtin && row.gtin && source.gtin !== row.gtin) concerns.push('barcode_conflict');
    const cp = peerNames.length === 2 ? Math.min(...peerNames.map(p => similarity(row.canonical_name, p))) : 0;
    const sp = source && peerNames.length === 2 ? Math.min(...peerNames.map(p => similarity(source.name, p))) : 0;
    const sc = source ? similarity(row.canonical_name, source.name) : 0;
    if (cp >= 0.58) evidenceFor.push('canonical_corroborated_by_both_peers');
    if (sp >= 0.55) evidenceFor.push('tesco_title_corroborated_by_both_peers');
    if (source && norm(source.brand) && norm(row.store_brand) && norm(source.brand) !== norm(row.store_brand))
      concerns.push('source_store_brand_discrepancy');
    if (source && row.canonical_brand && norm(source.brand) !== norm(row.canonical_brand))
      concerns.push('source_canonical_brand_discrepancy');
    // Warnings for variant and pack strings outrank lexical similarity; e.g.
    // "Andrex Complete Clean 4 Roll" must not match "24 Standard Rolls".
    for (const token of ['citrus', 'juice drink', 'pink lady', 'honey crunch', 'springwater',
      'brine', 'zero', 'diet', 'gluten free', 'vanilla', 'chocolate']) {
      if (source && norm(source.name).includes(token) !== norm(row.canonical_name).includes(token))
        concerns.push(`formulation_or_variant_discrepancy:${token}`);
    }
    const amountInPeers = peerNames.map(amount).filter(Boolean);
    if (sourceAmount && amountInPeers.length && amountInPeers.some(a => a !== sourceAmount))
      concerns.push('tesco_vs_peer_pack_or_measure_discrepancy');
    // No high-confidence label is an approval. Disagreements remain review work.
    const serious = concerns.some(c => /conflict|discrepancy/.test(c));
    const score = Math.max(0, Math.round(45 * sc + 35 * sp + 20 * cp) +
      (row.proven ? 12 : 0) + (structured ? 6 : 0) - (serious ? 55 : 0) - (!source ? 30 : 0));
    const hypothesis: ReviewHypothesis['hypothesis'] = serious ? 'conflict' : source && row.proven && structured && sc >= 0.6 && sp >= 0.5
      ? 'likely_exact' : 'needs_evidence';
    return { ...row, score, hypothesis, evidenceFor, concerns, approval: 'independent_review_required' as const };
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export async function selectHeldReviewEvidence(execute: ExecuteSql): Promise<ReviewHypothesis[]> {
  const rows = await execute(`with mapped as (
    select s.id,s.product_id,s.store_sku,s.store_url,s.store_product_name,s.brand store_brand,s.gtin,
      p.canonical_name,p.brand canonical_brand,
      exists(select 1 from scrape_product_receipts r where r.store_product_id=s.id and r.outcome='success') proven,
      (select count(*) from price_observations h where h.store_product_id=s.id) historical_observations
    from store_products s join products p on p.id=s.product_id
    where s.store='tesco' and s.url_status='resolved'
      and s.store_url='https://www.tesco.ie/shop/en-IE/products/'||s.store_sku
      and (select count(*) from store_products t where t.store='tesco' and t.store_sku=s.store_sku)=1
      and not exists(select 1 from latest_prices l where l.store_product_id=s.id)
      and (select count(distinct l.store) from latest_prices l where l.canonical_product_id=s.product_id
        and l.store in ('dunnes','supervalu'))=2
      and exists(select 1 from tesco_direct_collection_pages d where d.requested_url=s.store_url and
        (d.outcome='pending' or d.created_at>now()-interval '24 hours'
          or d.outcome<>'ok' or exists(select 1 from jsonb_array_elements(d.identity_results) i
            where i->>'storeProductId'=s.id::text and jsonb_array_length(i->'reasons')>0)))
  )
  select m.id,m.store_sku,m.canonical_name,m.canonical_brand,m.store_product_name,m.store_brand,m.gtin,
    m.proven,m.historical_observations,
    coalesce((select jsonb_agg(jsonb_build_object('store',p.store,'name',p.store_product_name,
      'brand',p.brand,'gtin',p.gtin) order by p.store)
      from store_products p join latest_prices l on l.store_product_id=p.id
      where p.product_id=m.product_id and p.store in ('dunnes','supervalu')),'[]'::jsonb) peers,
    (select jsonb_build_object('page_id',d.id,'body_sha256',d.body_sha256,
      'name',d.parsed->'products'->0->>'name','brand',d.parsed->'products'->0->>'brand',
      'gtin',d.parsed->'products'->0->>'gtin','quantity',d.parsed->'products'->0->'quantity',
      'identity_results',d.identity_results)
      from tesco_direct_collection_pages d where d.requested_url=m.store_url and d.outcome='ok'
        and d.parsed->'products'->0->>'sku'=m.store_sku order by d.created_at desc limit 1) source
  from mapped m order by m.id`);
  return rankHeldReviewEvidence(rows as unknown as HeldReviewRow[]);
}
