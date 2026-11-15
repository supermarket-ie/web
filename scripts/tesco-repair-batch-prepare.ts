// READ-ONLY preparation of a guarded repair batch from catalogue replacement-SKU
// barcode matches. Mirrors the supervised repair guard's preconditions
// (supportedRepairHint) that service_role can check; the stage/activate SQL
// itself runs only through the postgres bridge (scripts/tesco-repair-mapping.ts).
// Usage: tsx scripts/tesco-repair-batch-prepare.ts <match.json> <catalogueRawDir> <out.json>
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { canonicalVariantConflict, declaredPack, sameBrand } from '../src/lib/tesco-hold-reentry';

const sb = createClient(process.env.SB_URL!, process.env.SB_KEY!, { auth: { persistSession: false } });
const url = (s: string) => `https://www.tesco.ie/shop/en-IE/products/${s}`;
const code = (g: unknown) => (typeof g === 'string' && /^\d{8,14}$/.test(g) ? g.replace(/^0+/, '') : null);

async function main() {
  const [matchPath, rawDir, out] = process.argv.slice(2);
  const raw = new Map<string, { item: Record<string, unknown>; providerRunId: string; capturedAt: string; rawSha256: string }>();
  for (const f of readdirSync(rawDir).filter(x => x.endsWith('.jsonl')))
    for (const l of readFileSync(`${rawDir}/${f}`, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.providerRunId) raw.set(String(r.item.product_id), r); }
  const results = (JSON.parse(readFileSync(matchPath, 'utf8')).results as Array<{ productId: string; kind: string; relation: string; sku: string }>)
    .filter(r => r.kind === 'barcode_exact' && r.relation === 'replacement');
  const since24 = new Date(Date.now() - 86400_000).toISOString();
  const rows = [];
  for (const r of results) {
    const { data: prod } = await sb.from('products').select('id,canonical_name,brand,ean').eq('id', r.productId).single();
    const { data: maps } = await sb.from('store_products').select('id,store_sku,store_url,url_status,is_own_brand,brand,store_product_name').eq('product_id', r.productId).eq('store', 'tesco');
    const { data: peers } = await sb.from('store_products').select('store,gtin,store_product_name,brand').eq('product_id', r.productId).in('store', ['dunnes', 'supervalu']);
    const it = raw.get(r.sku)?.item ?? {};
    const blockers: string[] = [];
    if ((maps ?? []).length !== 1) blockers.push(`tesco_mappings=${(maps ?? []).length}`);
    const m = maps?.[0];
    const mid = m?.id ?? null;
    const [{ data: owners }, { data: oldOwners }, { data: rc }, { data: lp }, { data: pages }] = await Promise.all([
      sb.from('store_products').select('id').eq('store', 'tesco').eq('store_sku', r.sku),
      m?.store_sku ? sb.from('store_products').select('id').eq('store', 'tesco').eq('store_sku', m.store_sku) : Promise.resolve({ data: [] }),
      mid ? sb.from('scrape_product_receipts').select('run_id').eq('store_product_id', mid).eq('outcome', 'success').limit(1) : Promise.resolve({ data: [] }),
      mid ? sb.from('latest_prices').select('store_product_id').eq('store_product_id', mid) : Promise.resolve({ data: [] }),
      sb.from('tesco_direct_collection_pages').select('id,requested_url,outcome,created_at').in('requested_url', [url(r.sku), ...(m?.store_url ? [m.store_url] : [])]),
    ]);
    const source = code(prod?.ean) === code(it.gtin) ? 'canonical_ean'
      : (peers ?? []).some(p => code(p.gtin) && code(p.gtin) === code(it.gtin)) ? 'peer_gtin' : 'none';
    if (source === 'none') blockers.push('barcode_not_independent');
    if ((owners ?? []).filter(o => o.id !== mid).length) blockers.push('target_sku_owned');
    if ((oldOwners ?? []).length > 1) blockers.push('current_sku_shared');
    if (!(rc ?? []).length) blockers.push('not_proven (repair guard requires a prior receipt)');
    if (m?.is_own_brand) blockers.push('own_label (repair guard refuses)');
    if ((lp ?? []).length) blockers.push('fresh_price_on_current_sku');
    if (m && !['resolved', 'failed'].includes(String(m.url_status))) blockers.push(`url_status=${m.url_status}`);
    if ((pages ?? []).some(p => p.outcome === 'pending')) blockers.push('pending_attempt');
    if ((pages ?? []).some(p => p.created_at > since24)) blockers.push('attempt_within_24h');
    const brand = (it.brand_name as string) ?? '';
    if (!prod?.brand || !brand || /\b(tesco|dunnes|supervalu)\b/i.test(prod.brand) || !sameBrand(prod.brand, brand)) blockers.push('brand_not_confirmed');
    const cp = declaredPack(String(prod?.canonical_name ?? '')).total, tp = declaredPack(String(it.name ?? '')).total;
    if (cp == null || tp == null || cp !== tp) blockers.push('pack_not_confirmed');
    if (canonicalVariantConflict(String(prod?.canonical_name ?? ''), String(it.name ?? ''))) blockers.push('variant_conflict');
    rows.push({
      mapping_id: mid, canonical_product_id: r.productId, canonical_name: prod?.canonical_name, canonical_brand: prod?.brand,
      current_sku: m?.store_sku ?? null, current_url: m?.store_url ?? null, current_offer: m?.store_product_name ?? null,
      proposed_sku: r.sku, proposed_url: url(r.sku), proposed_name: it.name, proposed_brand: brand, proposed_gtin: it.gtin,
      proposed_pack: `${it.pack_size ?? ''}${it.pack_size_unit ?? ''}`, barcode_source: source,
      catalogue_evidence: raw.get(r.sku) ? { provider_run_id: raw.get(r.sku)!.providerRunId, captured_at: raw.get(r.sku)!.capturedAt, raw_sha256: raw.get(r.sku)!.rawSha256 } : null,
      blockers, next: blockers.length ? 'held' : 'acquire_repair_target_page_then_bridge_stage_dry_run',
    });
  }
  const tally: Record<string, number> = {};
  for (const x of rows) for (const b of (x.blockers.length ? x.blockers : ['eligible'])) tally[b.split(' ')[0]] = (tally[b.split(' ')[0]] ?? 0) + 1;
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), candidates: rows.length,
    eligible: rows.filter(x => !x.blockers.length).length, tally, rows }, null, 1));
  console.log(JSON.stringify({ candidates: rows.length, eligible: rows.filter(x => !x.blockers.length).length, tally }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
