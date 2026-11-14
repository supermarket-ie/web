// READ-ONLY: match unpriced comparable canonical products against acquired
// catalogue JSONL files. Usage: tsx scripts/tesco-catalogue-match.ts <rawDir> [out.json]
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { indexCatalogue, matchCanonical, type CatalogueItem, type MatchResult, type Peer, type TescoMapping } from '../src/lib/tesco-catalogue-match';

const sb = createClient(process.env.SB_URL!, process.env.SB_KEY!, { auth: { persistSession: false } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
async function all(t: string, s: string, f: (q: Row) => Row): Promise<Row[]> {
  const out: Row[] = [];
  for (let x = 0; ; x += 1000) {
    const { data, error } = await f(sb.from(t).select(s)).range(x, x + 999);
    if (error) throw new Error(`${t}: ${error.message}`);
    out.push(...(data ?? [])); if ((data ?? []).length < 1000) return out;
  }
}
async function main() {
  const [dir, outPath = '/tmp/tesco-catalogue-match.json'] = process.argv.slice(2);
  const items = new Map<string, CatalogueItem & { superDepartment: string | null }>();
  for (const f of readdirSync(dir).filter(x => x.endsWith('.jsonl'))) {
    for (const line of readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter(Boolean)) {
      const it = JSON.parse(line).item;
      items.set(String(it.product_id), { sku: String(it.product_id), gtin: it.gtin ?? null, name: String(it.name ?? ''), brand: it.brand_name ?? null,
        url: `https://www.tesco.ie/shop/en-IE/products/${it.product_id}`, department: it.department ?? null, superDepartment: it.super_department ?? null,
        price: typeof it.price === 'number' ? it.price : null });
    }
  }
  const depts = new Set([...items.values()].map(i => i.superDepartment));
  const idx = indexCatalogue([...items.values()]);
  const prods = await all('products', 'id,canonical_name,brand,ean', q => q.order('id'));
  const sps = await all('store_products', 'id,product_id,store,store_sku,store_product_name,brand,gtin', q => q.in('store', ['tesco', 'dunnes', 'supervalu']).order('id'));
  const freshAll = await all('latest_prices', 'store_product_id,store', q => q.in('store', ['tesco', 'dunnes', 'supervalu']).order('store_product_id'));
  const fresh = new Set(freshAll.map(r => String(r.store_product_id)));
  const byP = new Map<string, Row[]>(); for (const s of sps) byP.set(String(s.product_id), [...(byP.get(String(s.product_id)) ?? []), s]);
  const skuOwner = new Map<string, string>();
  for (const s of sps) if (s.store === 'tesco' && s.store_sku) skuOwner.set(String(s.store_sku), String(s.product_id));
  // Retained-review department per mapping (latest provider raw_item), for scoping.
  const ev = await all('tesco_apify_provider_evidence', 'store_product_id,raw_item,captured_at', q => q.order('captured_at'));
  const deptBySp = new Map<string, string>(); for (const e of ev) if (e.store_product_id && e.raw_item?.super_department) deptBySp.set(String(e.store_product_id), e.raw_item.super_department);
  const results: Array<MatchResult & { dept: string | null; scoped: boolean; price: number | null }> = [];
  let comparable = 0, inScope = 0;
  for (const p of prods) {
    const list = byP.get(String(p.id)) ?? [];
    const tesco = list.filter(s => s.store === 'tesco');
    if (tesco.some(s => fresh.has(String(s.id)))) continue;                 // already priced
    const peerRows = list.filter(s => s.store !== 'tesco' && fresh.has(String(s.id)));
    if (!peerRows.length) continue;                                           // not comparable today
    comparable++;
    const dept = tesco.map(s => deptBySp.get(String(s.id))).find(Boolean) ?? null;
    const peers: Peer[] = []; const seen = new Set<string>();
    for (const s of peerRows) if (!seen.has(s.store)) { seen.add(s.store); peers.push({ store: s.store, name: String(s.store_product_name ?? ''), brand: s.brand ?? null, gtin: s.gtin ?? null }); }
    const r = matchCanonical({ id: String(p.id), name: String(p.canonical_name ?? ''), brand: p.brand ?? null, ean: p.ean ?? null }, peers,
      tesco.map(s => ({ id: String(s.id), sku: s.store_sku ? String(s.store_sku) : null })) as TescoMapping[], idx, skuOwner);
    const scoped = dept != null && depts.has(dept);
    if (scoped) inScope++;
    results.push({ ...r, dept, scoped, price: r.sku ? items.get(r.sku)?.price ?? null : null });
  }
  const tally = (rows: typeof results) => rows.reduce<Record<string, number>>((a, r) => { const k = `${r.kind}:${r.relation}`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const summary = { catalogueItems: items.size, departments: [...depts], comparableUnpriced: comparable, knownDeptInTranche: inScope,
    all: tally(results), inTrancheDept: tally(results.filter(r => r.scoped)) };
  writeFileSync(outPath, JSON.stringify({ summary, results }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
