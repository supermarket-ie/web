// Record barcode-verified SAME-SKU links from the catalogue matcher output.
// Writes ONLY tesco_verified_links rows through apify_record_verified_link; no
// price, no mapping change. Dry run unless LINK_APPLY=1.
// Usage: tsx scripts/tesco-catalogue-link.ts <match.json> <catalogueRawDir>
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync } from 'node:fs';
import { identityFingerprint } from '../src/lib/tesco-identity-assessment';
import { canonicalVariantConflict, declaredPack } from '../src/lib/tesco-hold-reentry';

const sb = createClient(process.env.SB_URL!, process.env.SB_KEY!, { auth: { persistSession: false } });
type Raw = { providerRunId: string; capturedAt: string; rawSha256: string; item: Record<string, unknown> };

async function main() {
  const [matchPath, rawDir] = process.argv.slice(2);
  const apply = process.env.LINK_APPLY === '1';
  const raw = new Map<string, Raw>();
  for (const f of readdirSync(rawDir).filter(x => x.endsWith('.jsonl'))) {
    for (const l of readFileSync(`${rawDir}/${f}`, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l) as Raw; if (r.providerRunId) raw.set(String(r.item.product_id), r);
    }
  }
  const results = (JSON.parse(readFileSync(matchPath, 'utf8')).results as Array<{ productId: string; kind: string; relation: string; sku: string }>)
    .filter(r => r.kind === 'barcode_exact' && r.relation === 'confirms_mapping');
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  for (const r of results) {
    const { data: sp } = await sb.from('store_products')
      .select('id,store_sku,store_product_name,brand,products(canonical_name,brand,ean)').eq('product_id', r.productId).eq('store', 'tesco').eq('store_sku', r.sku);
    const s = sp?.[0]; const rr = raw.get(r.sku);
    if (!s || !rr) { bump('missing_mapping_or_raw'); continue; }
    const c = (Array.isArray(s.products) ? s.products[0] : s.products) as { canonical_name: string; brand: string | null; ean: string | null };
    const it = rr.item;
    const name = String(it.name ?? ''), brand = (it.brand_name as string) ?? null;
    // Contradictory product evidence stays HELD: brand disagreement with the
    // mapped Tesco offer or canonical brand, a variant conflict, or a stated
    // pack that disagrees.
    const norm = (x: string | null) => (x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const brandConflict = (c.brand && brand && norm(c.brand) !== norm(brand)) || (s.brand && brand && norm(s.brand) !== norm(brand));
    const cp = declaredPack(c.canonical_name).total, lp = declaredPack(name).total;
    if (brandConflict) { bump('held_brand_conflict'); continue; }
    if (canonicalVariantConflict(c.canonical_name, name)) { bump('held_variant_conflict'); continue; }
    if (cp != null && lp != null && cp !== lp) { bump('held_pack_conflict'); continue; }
    const { data: snap, error: se } = await sb.rpc('apify_mapping_snapshot', { p_store_product_id: s.id });
    if (se || !snap) { bump('snapshot_error'); continue; }
    const quantity = null; // catalogue listing has no structured quantity; fingerprint binds name/brand/gtin/sku
    const fp = identityFingerprint({ canonical: { name: c.canonical_name, brand: c.brand, ean: c.ean },
      tesco: { sku: r.sku, name, brand, gtin: (it.gtin as string) ?? null, quantity } });
    const catalogueItem = { sku: r.sku, gtin: it.gtin, name, brand, pack_size: it.pack_size, pack_size_unit: it.pack_size_unit,
      net_contents: it.net_contents, super_department: it.super_department, department: it.department, aisle: it.aisle, shelf: it.shelf, url: it.url };
    if (!apply) { bump('eligible_dry_run'); continue; }
    const { error } = await sb.rpc('apify_record_verified_link', {
      p_store_product_id: s.id, p_gtin: String(it.gtin), p_catalogue_item: catalogueItem, p_catalogue_raw_sha256: rr.rawSha256,
      p_catalogue_captured_at: rr.capturedAt, p_provider_run_id: rr.providerRunId, p_identity_fingerprint: fp,
      p_evidence: { matcher: 'barcode_exact', canonical: c, mapped_offer: { name: s.store_product_name, brand: s.brand } },
      p_expected_snapshot: snap,
    });
    if (error) bump(`refused:${error.message}`); else bump('recorded');
  }
  console.log(JSON.stringify({ apply, candidates: results.length, ...tally }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
