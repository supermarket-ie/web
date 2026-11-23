// Barcode-led catalogue expansion runner (policy barcode-onboard-v1, migration 20261124090000). Dry run unless APPLY=1.
// Input: Tesco catalogue candidates (JSON [{sku, gtin, forms, name, brand}]) and the READ-ONLY governed barcode-capture
// logs (scripts/barcode-search-capture.ts BCAP lines, key "T<sku>", raw bodies included). For each SKU: classify the
// Dunnes and SuperValu responses (classifyBarcodeResult), keep STRONG hits, plan (planOnboarding) against the
// current catalogue, then onboard_barcode_tesco_offer. No price is written; prices follow through the existing
// guarded attach, evidence, approval and collection paths.
// Usage: SB_URL=.. SB_KEY=.. tsx scripts/barcode-tesco-onboarding.ts <candidates.json> <capture-log>... [APPLY=1]
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { classifyBarcodeResult, normaliseGtin, type SearchHit } from '../src/lib/barcode-matching';
import { ONBOARD_POLICY_VERSION, planOnboarding, type Owner, type StrongHit } from '../src/lib/barcode-tesco-onboarding';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const APPLY = process.env.APPLY === '1';
const H = { apikey: process.env.SB_KEY!, Authorization: `Bearer ${process.env.SB_KEY}`, 'Content-Type': 'application/json' };
const get = async (p: string): Promise<Row[]> => { const out: Row[] = []; for (let f = 0; ; f += 1000) {
  const r = await fetch(`${process.env.SB_URL}/rest/v1/${p}`, { headers: { ...H, Range: `${f}-${f + 999}` } }); const d = await r.json();
  if (!Array.isArray(d)) throw new Error(JSON.stringify(d).slice(0, 200)); out.push(...d); if (d.length < 1000) return out; } };
const chunk = <T,>(xs: T[], n = 80) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));

async function main() {
  const [candFile, ...logs] = process.argv.slice(2);
  const cands = new Map<string, Row>((JSON.parse(readFileSync(candFile, 'utf8')) as Row[]).map(c => [`T${c.sku}`, c]));
  const caps = new Map<string, Row>();
  for (const f of logs) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('BCAP {')) { try { const j = JSON.parse(l.slice(5)); caps.set(j.key, j); } catch { /* partial line */ } }
  const tally: Record<string, number> = {}; const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  type Plan = { c: Row; hits: Array<StrongHit & { form: Row; cls: ReturnType<typeof classifyBarcodeResult> }> };
  const plans: Plan[] = [];
  for (const [key, cap] of caps) {
    const c = cands.get(key); if (!c) continue;
    const n = normaliseGtin(c.gtin); if (!n.ok) { bump('bad_gtin'); continue; }
    const hits: Plan['hits'] = [];
    for (const store of ['dunnes', 'supervalu'] as const) {
      const s = cap[store]; if (!s || s.error) { bump(`${store}:capture_error`); continue; }
      const items: SearchHit[] = s.items.map((i: Row) => ({ sku: i.sku, name: i.name, brand: i.brand, unitOfSize: i.unitOfSize }));
      const cls = classifyBarcodeResult({ name: c.name, brand: c.brand }, items, n.retail);
      bump(`${store}:${cls.tier ?? cls.outcome}`);
      if (cls.tier !== 'strong' || !cls.sku) continue;
      const form = s.forms.find((x: Row) => x.items.some((i: Row) => i.sku === cls.sku)) ?? s.forms[0];
      hits.push({ store, sku: cls.sku, title: items.find(i => i.sku === cls.sku)!.name, form, cls });
    }
    if (hits.length) plans.push({ c, hits });
  }
  // Current catalogue state for every resolved SKU and every candidate Tesco SKU.
  const owners = new Map<string, Row[]>();
  for (const store of ['dunnes', 'supervalu']) {
    const skus = [...new Set(plans.flatMap(p => p.hits.filter(h => h.store === store).map(h => h.sku)))];
    for (const c of chunk(skus)) for (const r of await get(`store_products?select=id,product_id,store_sku&store=eq.${store}&store_sku=in.(${c.join(',')})`))
      owners.set(`${store}:${r.store_sku}`, [...(owners.get(`${store}:${r.store_sku}`) ?? []), r]);
  }
  const tescoHave = new Set<string>();
  for (const c of chunk(plans.map(p => String(p.c.sku)))) for (const r of await get(`store_products?select=store_sku&store=eq.tesco&store_sku=in.(${c.join(',')})`)) tescoHave.add(String(r.store_sku));
  const targets = [...new Set([...owners.values()].flat().map(r => r.product_id).filter(Boolean))];
  const recOffers: Row[] = [], names = new Map<string, string>();
  for (const c of chunk(targets, 60)) {
    recOffers.push(...await get(`store_products?select=product_id,store,store_sku,store_product_name,brand&product_id=in.(${c.join(',')})`));
    for (const p of await get(`products?select=id,canonical_name&id=in.(${c.join(',')})`)) names.set(p.id, String(p.canonical_name ?? ''));
  }
  let done = 0;
  for (const p of plans) {
    if (tescoHave.has(String(p.c.sku))) { bump('plan:tesco_sku_now_present'); continue; }
    const own: Partial<Record<'dunnes' | 'supervalu', Owner[]>> = {};
    for (const h of p.hits) {
      const rows = owners.get(`${h.store}:${h.sku}`) ?? [];
      own[h.store] = rows.map(r => ({ productId: r.product_id, offerCount: rows.length }));
    }
    const target = [...new Set(Object.values(own).flat().map(o => o!.productId))][0];
    const plan = planOnboarding({ tesco: { sku: p.c.sku, name: p.c.name, brand: p.c.brand }, hits: p.hits, owners: own,
      record: target ? { canonicalName: names.get(target) ?? '', offers: recOffers.filter(o => o.product_id === target)
        .map(o => ({ store: o.store, sku: o.store_sku ? String(o.store_sku) : null, name: String(o.store_product_name ?? ''), brand: o.brand ?? null })) } : null });
    bump(`plan:${plan.action}${plan.reasons.length ? ':' + plan.reasons[0].split(':')[0] : ''}`);
    if (plan.action === 'held') continue;
    log({ event: 'planned', action: plan.action, tesco: p.c.sku, name: p.c.name, hits: p.hits.map(h => `${h.store}:${h.sku}`), target: plan.target });
    if (!APPLY) continue;
    const observations = p.hits.map(h => {
      const n = normaliseGtin(p.c.gtin) as { ok: true; retail: string; kind: string };
      return { gtin: n.retail, gtin_kind: n.kind, gtin_origin_sku: String(p.c.sku),
        gtin_origin_evidence: { table: 'tesco_catalogue_jsonl', field: 'item.gtin', tesco_name: p.c.name, tesco_brand: p.c.brand, canonical_product_id: plan.target },
        store: h.store, query: h.form.form, endpoint: h.form.endpoint, result_total: h.form.total, result_items: h.form.items,
        query_forms: [], response_sha256: h.form.sha256, response_body: brotliDecompressSync(Buffer.from(h.form.body_br, 'base64')).toString('utf8'),
        resolved_sku: h.sku, outcome: 'identity_consistent', tier: 'strong', title_agreement: h.cls.agreement, rule_version: 'barcode-v5', observed_at: h.form.at };
    });
    const r = await fetch(`${process.env.SB_URL}/rest/v1/rpc/onboard_barcode_tesco_offer`, { method: 'POST', headers: H, body: JSON.stringify({
      p_policy_version: ONBOARD_POLICY_VERSION, p_tesco_sku: String(p.c.sku), p_tesco_name: p.c.name, p_tesco_brand: p.c.brand, p_gtin: p.c.gtin,
      p_target_product: plan.target, p_observations: observations, p_checks: { hits: p.hits.map(h => `${h.store}:strong`), plan: plan.action },
      p_reason: `Policy ${ONBOARD_POLICY_VERSION}: ${p.hits.map(h => h.store).join('+')} search resolved GTIN ${p.c.gtin} to one strong SKU for Tesco "${p.c.name}".` }) });
    if (!r.ok) { bump('db_refused'); log({ event: 'refused', tesco: p.c.sku, status: r.status, message: (await r.text()).slice(0, 200) }); continue; }
    done++; bump(`onboarded:${plan.action}`);
  }
  log({ event: 'summary', apply: APPLY, policy: ONBOARD_POLICY_VERSION, captured: caps.size, planned: plans.length, onboarded: done, tally });
}
main().catch(e => { console.error(e); process.exit(1); });
