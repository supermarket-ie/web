// READ-ONLY enrichment proposal for the blocked replacement-SKU repairs.
// Usage: tsx scripts/tesco-enrichment-proposal.ts <repair-batch.json> <catalogueRawDir> <out.json>
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { proposeEnrichment, setBrandLexicon, type Offer } from '../src/lib/tesco-enrichment-proposal';

const sb = createClient(process.env.SB_URL!, process.env.SB_KEY!, { auth: { persistSession: false } });
async function main() {
  const [batchPath, rawDir, out] = process.argv.slice(2);
  const raw = new Map<string, Record<string, unknown> & { _run: string; _at: string; _sha: string }>();
  for (const f of readdirSync(rawDir).filter(x => x.endsWith('.jsonl')))
    for (const l of readFileSync(`${rawDir}/${f}`, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l); if (r.providerRunId) raw.set(String(r.item.product_id), { ...r.item, _run: r.providerRunId, _at: r.capturedAt, _sha: r.rawSha256 });
    }
  const batch = JSON.parse(readFileSync(batchPath, 'utf8')).rows as Array<Record<string, string | null>>;
  // Brand lexicon: every structured brand known to the catalogue and retailers.
  const lex = new Set<string>();
  for (const t of ['store_products', 'products']) for (let x = 0; ; x += 1000) {
    const { data } = await sb.from(t).select('brand').not('brand', 'is', null).range(x, x + 999);
    for (const r of data ?? []) if (r.brand) lex.add(String(r.brand));
    if ((data ?? []).length < 1000) break;
  }
  for (const it of raw.values()) if (it.brand_name) lex.add(String(it.brand_name));
  setBrandLexicon(lex);
  const rows = [];
  for (const b of batch) {
    const pid = String(b.canonical_product_id);
    const { data: p } = await sb.from('products').select('id,canonical_name,brand,ean').eq('id', pid).single();
    const { data: offers } = await sb.from('store_products').select('id,store,store_sku,store_url,store_product_name,brand,gtin,latest_prices(observed_at)').eq('product_id', pid);
    const it = raw.get(String(b.proposed_sku));
    const list: Offer[] = [];
    if (it) list.push({ store: 'tesco', role: 'proposed', sku: String(b.proposed_sku), name: String(it.name), brand: (it.brand_name as string) ?? null,
      gtin: (it.gtin as string) ?? null, url: String(b.proposed_url) });
    for (const o of offers ?? []) {
      const lp = Array.isArray(o.latest_prices) ? o.latest_prices[0] : o.latest_prices;
      list.push({ store: o.store, role: o.store === 'tesco' ? 'current' : ['dunnes', 'supervalu'].includes(o.store) ? 'peer' : 'other', sku: o.store_sku, name: String(o.store_product_name ?? ''),
        brand: o.brand ?? null, gtin: o.gtin ?? null, url: o.store_url, observedAt: (lp as { observed_at?: string } | null)?.observed_at ?? null });
    }
    const prop = proposeEnrichment({ id: pid, name: String(p?.canonical_name ?? ''), brand: p?.brand ?? null, ean: p?.ean ?? null }, list);
    rows.push({ mapping_id: b.mapping_id, current_sku: b.current_sku, proposed_sku: b.proposed_sku, proposed_url: b.proposed_url,
      repair_blockers: b.blockers, ...prop,
      tesco_catalogue_evidence: it ? { provider_run_id: it._run, captured_at: it._at, raw_sha256: it._sha, gtin: it.gtin,
        pack_size: `${it.pack_size ?? ''}${it.pack_size_unit ?? ''}`, net_contents: it.net_contents, category: [it.super_department, it.department, it.aisle, it.shelf].join(' > ') } : null,
      canonical_ean_tesco_sourced: !!p?.ean && String(p.ean).replace(/^0+/, '') === String(it?.gtin ?? '').replace(/^0+/, ''),
      proposed_change: prop.status === 'substantiated' ? { table: 'products', id: pid,
        set: { canonical_name: prop.proposed!.name, brand: prop.proposed!.brand }, from: { canonical_name: p?.canonical_name, brand: p?.brand } } : null,
      remaining_repair_blockers_after_enrichment: prop.status === 'substantiated'
        ? (b.blockers as unknown as string[]).filter(x => !/^(pack_not_confirmed|brand_not_confirmed)/.test(x)) : null });
  }
  const tally: Record<string, number> = {};
  for (const r of rows) tally[r.status] = (tally[r.status] ?? 0) + 1;
  const unblocked = rows.filter(r => r.status === 'substantiated' && (r.remaining_repair_blockers_after_enrichment ?? []).length === 0).length;
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), readOnly: true, rule: 'Tesco catalogue item + >=1 independent Dunnes/SuperValu offer must agree; canonical must not contradict', tally, repairsFullyUnblockedByEnrichment: unblocked, rows }, null, 1));
  console.log(JSON.stringify({ rows: rows.length, tally, repairsFullyUnblockedByEnrichment: unblocked }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
