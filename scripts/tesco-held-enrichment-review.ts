// READ-ONLY: canonical-enrichment proposals for Tesco first-price candidates HELD only because the canonical
// record is too generic (same SKU, no replacement). Proposed identity = the held SKU's own latest Apify
// evidence page; corroboration = the Dunnes/SuperValu offers on the canonical (proposeEnrichment rules:
// substantiated only when Tesco evidence AND >= 1 Dunnes/SuperValu offer agree and nothing contradicts).
// Writes nothing to the database.
// Usage: tsx scripts/tesco-held-enrichment-review.ts <holds.json: [{sku, reasons[]}]> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { proposeEnrichment, type Offer } from '../src/lib/tesco-enrichment-proposal';

const GAP = new Set(['candidate does not establish full exact canonical identity', 'measureExactnessFailed', 'packExactnessFailed']);
const sb = createClient(process.env.SB_URL!, process.env.SB_KEY!, { auth: { persistSession: false } });

async function main() {
  const [holdsPath, out] = process.argv.slice(2);
  const holds = (JSON.parse(readFileSync(holdsPath, 'utf8')) as Array<{ sku: string; reasons: string[] }>)
    .filter(h => h.reasons.length && h.reasons.every(r => GAP.has(r)));
  const rows = [];
  for (const h of holds) {
    const { data: maps } = await sb.from('store_products').select('id,product_id,store_sku,store_url,store_product_name').eq('store', 'tesco').eq('store_sku', h.sku);
    if (!maps || maps.length !== 1) { rows.push({ sku: h.sku, status: 'skipped_shared_or_missing_sku' }); continue; }
    const m = maps[0];
    const { data: page } = await sb.from('tesco_direct_collection_pages').select('id,created_at,body_sha256,parsed')
      .eq('requested_url', `https://www.tesco.ie/shop/en-IE/products/${h.sku}`).eq('outcome', 'ok').eq('http_status', 200)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const item = ((page?.parsed as { products?: Array<Record<string, unknown>> } | null)?.products ?? []).find(p => String(p.sku) === h.sku);
    if (!item) { rows.push({ sku: h.sku, mapping_id: m.id, status: 'skipped_no_tesco_evidence' }); continue; }
    const { data: p } = await sb.from('products').select('id,canonical_name,brand,ean').eq('id', m.product_id).single();
    const { data: offers } = await sb.from('store_products').select('id,store,store_sku,store_url,store_product_name,brand,gtin,latest_prices(observed_at)').eq('product_id', m.product_id);
    const list: Offer[] = [{ store: 'tesco', role: 'proposed', sku: h.sku, name: String(item.name ?? ''), brand: (item.brand as string) ?? null,
      gtin: (item.gtin as string) ?? null, url: m.store_url }];
    for (const o of offers ?? []) {
      if (o.id === m.id) continue; // the held mapping itself is represented by its own evidence above
      const lp = Array.isArray(o.latest_prices) ? o.latest_prices[0] : o.latest_prices;
      list.push({ store: o.store, role: o.store === 'tesco' ? 'current' : 'peer', sku: o.store_sku, name: String(o.store_product_name ?? ''),
        brand: o.brand ?? null, gtin: o.gtin ?? null, url: o.store_url, observedAt: (lp as { observed_at?: string } | null)?.observed_at ?? null });
    }
    const prop = proposeEnrichment({ id: String(p?.id), name: String(p?.canonical_name ?? ''), brand: p?.brand ?? null, ean: p?.ean ?? null }, list);
    rows.push({ sku: h.sku, mapping_id: m.id, canonical_product_id: m.product_id, current_canonical: p?.canonical_name, tesco_title: item.name,
      tesco_evidence: { page_id: page!.id, captured_at: page!.created_at, sha256: page!.body_sha256 }, hold_reasons: h.reasons, ...prop });
  }
  writeFileSync(out, JSON.stringify(rows, null, 2));
  const by: Record<string, number> = {};
  for (const r of rows as Array<{ status: string }>) by[r.status] = (by[r.status] ?? 0) + 1;
  console.log(JSON.stringify({ candidates: holds.length, by }));
}
main().catch(e => { console.error(e); process.exit(1); });
