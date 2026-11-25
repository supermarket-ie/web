// Canonical catalogue-name quality report (src/lib/catalogue-name-quality.ts). Read-only unless APPLY=1.
// Report: every product with a name issue (brand-prefix typo with suggestion, possible duplicate, formatting), as JSON lines
// plus a summary. APPLY=1 applies ONLY the versioned CANONICAL_NAME_CORRECTIONS whose current name still equals `from`
// (so the old URL redirect is already in the deployed code); retailer source names, offers, prices and approvals are untouched.
// Usage: SB_URL=.. SB_KEY=.. [APPLY=1] tsx scripts/catalogue-name-quality.ts
import { CANONICAL_NAME_CORRECTIONS, nameKey, nameQualityIssues } from '../src/lib/catalogue-name-quality';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const H = { apikey: process.env.SB_KEY!, Authorization: `Bearer ${process.env.SB_KEY}`, 'Content-Type': 'application/json' };
const get = async (p: string): Promise<Row[]> => { const out: Row[] = []; for (let f = 0; ; f += 1000) {
  const r = await fetch(`${process.env.SB_URL}/rest/v1/${p}`, { headers: { ...H, Range: `${f}-${f + 999}` } }); const d = await r.json();
  if (!Array.isArray(d)) throw new Error(JSON.stringify(d).slice(0, 200)); out.push(...d); if (d.length < 1000) return out; } };
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));

async function main() {
  const products = await get('products?select=id,canonical_name,brand&order=id');
  const offers = await get('store_products?select=product_id,brand&product_id=not.is.null&order=id');
  const brands = new Map<string, (string | null)[]>();
  for (const o of offers) brands.set(o.product_id, [...(brands.get(o.product_id) ?? []), o.brand ?? null]);
  const byKey = new Map<string, Row[]>();
  for (const p of products) { const k = nameKey(String(p.canonical_name), p.brand); byKey.set(k, [...(byKey.get(k) ?? []), p]); }
  const tally: Record<string, number> = {};
  for (const p of products) {
    const issues = nameQualityIssues({ name: String(p.canonical_name), brand: p.brand, confirmingBrands: brands.get(p.id) ?? [] });
    const dup = (byKey.get(nameKey(String(p.canonical_name), p.brand)) ?? []).filter(x => x.id !== p.id);
    for (const d of dup) issues.push({ kind: 'possible_duplicate', otherId: d.id, otherName: d.canonical_name });
    for (const i of issues) tally[i.kind] = (tally[i.kind] ?? 0) + 1;
    if (issues.some(i => i.kind === 'brand_prefix_typo' || i.kind === 'possible_duplicate')) log({ event: 'issue', id: p.id, name: p.canonical_name, issues });
  }
  let applied = 0;
  if (process.env.APPLY === '1') for (const c of CANONICAL_NAME_CORRECTIONS) {
    const cur = products.find(p => p.id === c.productId);
    if (!cur || cur.canonical_name !== c.from) { log({ event: 'correction_skipped', id: c.productId, current: cur?.canonical_name ?? null }); continue; }
    const r = await fetch(`${process.env.SB_URL}/rest/v1/products?id=eq.${c.productId}&canonical_name=eq.${encodeURIComponent(c.from)}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify({ canonical_name: c.to }) });
    const d = await r.json();
    if (!r.ok || !Array.isArray(d) || d.length !== 1) { log({ event: 'correction_failed', id: c.productId, status: r.status, body: JSON.stringify(d).slice(0, 200) }); continue; }
    applied++; log({ event: 'corrected', id: c.productId, from: c.from, to: c.to });
  }
  log({ event: 'summary', products: products.length, tally, applied });
}
main().catch(e => { console.error(e); process.exit(1); });
