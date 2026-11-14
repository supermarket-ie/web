// READ-ONLY bulk review of retained Tesco evidence (no fetch, no writes).
// Population: one-to-one Tesco mappings at their canonical URL with NO fresh
// Tesco price and a retained ok page for that URL containing the mapped SKU.
// Output: JSON report (path = argv[2], default /tmp/tesco-retained-review.json).
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { reviewRetained, type RetainedReview } from '../src/lib/tesco-retained-review';
import type { ApifyPeer } from '../src/lib/tesco-apify-collection';

const sb = createClient(process.env.SB_URL!, process.env.SB_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
// PostgREST rows from dynamic selects (read-only reporting script).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;
async function all(t: string, s: string, f: (q: Query) => Query, o: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let x = 0; ; x += 1000) {
    const { data, error } = await f(sb.from(t).select(s)).order(o).range(x, x + 999);
    if (error) throw new Error(`${t}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}
async function main() {
  const now = Date.now();
  const sps = await all('store_products', 'id,product_id,store_sku,store_url,url_status,gtin,store_product_name,brand,is_own_brand,products(canonical_name,brand,ean)',
    q => q.eq('store', 'tesco').eq('url_status', 'resolved').not('store_sku', 'is', null), 'id');
  const fresh = new Set((await all('latest_prices', 'store_product_id', q => q.eq('store', 'tesco'), 'store_product_id')).map(r => String(r.store_product_id)));
  const proven = new Set((await all('scrape_product_receipts', 'store_product_id', q => q.eq('outcome', 'success'), 'store_product_id')).map(r => String(r.store_product_id)));
  const skuCount = new Map<string, number>();
  for (const s of sps) skuCount.set(String(s.store_sku), (skuCount.get(String(s.store_sku)) ?? 0) + 1);
  const pop = sps.filter(s => !fresh.has(String(s.id)) && skuCount.get(String(s.store_sku)) === 1
    && s.store_url === `https://www.tesco.ie/shop/en-IE/products/${s.store_sku}`);
  // Newest ok page per URL (retained evidence of any provenance).
  const urls = new Set(pop.map(s => String(s.store_url)));
  const pageByUrl = new Map<string, Row>();
  for (const p of await all('tesco_direct_collection_pages', 'id,requested_url,body_sha256,parsed,created_at', q => q.eq('outcome', 'ok'), 'created_at')) {
    if (urls.has(p.requested_url)) pageByUrl.set(p.requested_url, p); // ascending -> newest wins
  }
  // Fresh peers (<= 7 days, priced), one per store, freshest first.
  const pids = [...new Set(pop.map(s => String(s.product_id)))];
  const peersBy = new Map<string, ApifyPeer[]>();
  for (let i = 0; i < pids.length; i += 50) {
    const { data, error } = await sb.from('store_products')
      .select('id,product_id,store,store_sku,store_product_name,brand,gtin,latest_prices(observed_at,price)')
      .in('product_id', pids.slice(i, i + 50)).in('store', ['dunnes', 'supervalu']);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const lp = Array.isArray(r.latest_prices) ? r.latest_prices[0] : r.latest_prices;
      if (!lp || !(Number(lp.price) > 0) || Date.parse(lp.observed_at) <= now - 7 * 86400_000) continue;
      const list = peersBy.get(String(r.product_id)) ?? [];
      list.push({ id: String(r.id), store: String(r.store), store_product_name: String(r.store_product_name ?? ''), brand: r.brand ?? null,
        gtin: r.gtin ?? null, store_sku: String(r.store_sku ?? ''), observed_at: String(lp.observed_at), price: Number(lp.price) });
      peersBy.set(String(r.product_id), list);
    }
  }
  const out: RetainedReview[] = [];
  for (const s of pop) {
    const page = pageByUrl.get(String(s.store_url));
    if (!page) continue;
    const c = Array.isArray(s.products) ? s.products[0] : s.products;
    const byStore = new Map<string, ApifyPeer>();
    for (const p of (peersBy.get(String(s.product_id)) ?? []).sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))) {
      if (!byStore.has(p.store)) byStore.set(p.store, p);
    }
    out.push(reviewRetained({
      snapshot: { store_product_id: s.id, product_id: s.product_id, store_sku: s.store_sku, store_url: s.store_url, url_status: s.url_status,
        store_brand: s.brand, store_product_name: s.store_product_name, is_own_brand: s.is_own_brand === true, gtin: s.gtin,
        canonical_name: c?.canonical_name ?? '', canonical_brand: c?.brand ?? null, canonical_ean: c?.ean ?? null,
        same_sku_canonical_names: [c?.canonical_name ?? ''] },
      page, peers: [...byStore.values()], proven: proven.has(String(s.id)), now,
    }));
  }
  const tally: Record<string, number> = {};
  for (const r of out) { const k = `${r.proven ? 'proven' : 'no_receipt'}:${r.klass}`; tally[k] = (tally[k] ?? 0) + 1; }
  writeFileSync(process.argv[2] ?? '/tmp/tesco-retained-review.json', JSON.stringify({ generatedAt: new Date(now).toISOString(),
    population: pop.length, reviewed: out.length, tally, rows: out }, null, 1));
  console.log(JSON.stringify({ population: pop.length, reviewed: out.length, tally }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
