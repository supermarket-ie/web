// Records AI-accepted REVIEW-tier barcode associations (policy barcode-review-ai-v1, migration 20261126090000).
// Dry run unless APPLY=1. Runs locally against PostgREST (SB_URL / SB_KEY), like scripts/barcode-tesco-onboarding.ts.
//
// Inputs: the review run logs (scripts/dunnes-barcode-renewal.ts, `review_accepted` events carry the independent AI verdict
// and the strict-confirmation reasons), the review target files (product_id, tesco_offer_id, tesco_evidence_id, sku) and the
// READ-ONLY barcode capture logs (BCAP lines). For each accepted target it
//   1. re-classifies the captured GTIN search for the Tesco SKU and requires a REVIEW-tier resolution of exactly the accepted SKU;
//   2. appends that review-tier observation (append-only, never a strong association) if it is not already recorded;
//   3. finds the retailer offer the review run attached (same record, this SKU) and its retained SKU-bound capture;
//   4. calls accept_barcode_review_association, which re-checks everything in the database and stores the AI verdict.
// Nothing here can create a strong association, a price, a mapping or an approval.
// Usage: SB_URL=.. SB_KEY=.. [APPLY=1] tsx scripts/barcode-review-accept.ts <store> <targets.json,...> <review-log,...> <capture-log,...>
import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { classifyBarcodeResult, normaliseGtin, type SearchHit } from '../src/lib/barcode-matching';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const APPLY = process.env.APPLY === '1';
const H = { apikey: process.env.SB_KEY!, Authorization: `Bearer ${process.env.SB_KEY}`, 'Content-Type': 'application/json' };
const get = async (p: string): Promise<Row[]> => { const r = await fetch(`${process.env.SB_URL}/rest/v1/${p}`, { headers: H }); const d = await r.json();
  if (!Array.isArray(d)) throw new Error(JSON.stringify(d).slice(0, 300)); return d; };
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
const list = (s: string) => s.split(',').filter(Boolean);

async function main() {
  const [store, targetFiles, reviewLogs, capLogs] = process.argv.slice(2);
  if (store !== 'dunnes' && store !== 'supervalu') throw new Error('store must be dunnes or supervalu');
  const targets = new Map<string, Row>();
  for (const f of list(targetFiles)) for (const t of JSON.parse(readFileSync(f, 'utf8')) as Row[]) targets.set(`${t.product_id}|${t.sku}`, t);
  const accepted = new Map<string, Row>();
  for (const f of list(reviewLogs)) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('{"event":"review_accepted"')) { const j = JSON.parse(l); accepted.set(`${j.product_id}|${j.sku}`, j); }
  const caps = new Map<string, Row>();
  for (const f of list(capLogs)) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('BCAP {')) { try { const j = JSON.parse(l.slice(5)); caps.set(j.key, j); } catch { /* partial line */ } }
  const tally: Record<string, number> = {}; const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  let done = 0;
  for (const [key, ev] of accepted) {
    const t = targets.get(key); if (!t) { bump('no_target'); continue; }
    const [tesco] = await get(`store_products?select=id,product_id,store_sku&id=eq.${t.tesco_offer_id}`);
    const [prov] = await get(`tesco_apify_provider_evidence?select=id,name:raw_item->>name,brand:raw_item->>brand_name,gtin:raw_item->>gtin&id=eq.${t.tesco_evidence_id}`);
    if (!tesco || !prov) { bump('no_tesco_reference'); continue; }
    const g = normaliseGtin(String(prov.gtin ?? '')); if (!g.ok) { bump('bad_gtin'); continue; }
    const cap = caps.get(`T${tesco.store_sku}`)?.[store]; if (!cap || cap.error) { bump('no_capture'); continue; }
    const items: SearchHit[] = cap.items.map((i: Row) => ({ sku: i.sku, name: i.name, brand: i.brand, unitOfSize: i.unitOfSize }));
    const cls = classifyBarcodeResult({ name: prov.name, brand: prov.brand }, items, g.retail) as Row;
    if (cls.tier !== 'review' || String(cls.sku) !== String(t.sku)) { bump(`not_review_of_this_sku:${cls.tier ?? cls.outcome}`); continue; }
    const [offer] = await get(`store_products?select=id,product_id,store_sku&store=eq.${store}&store_sku=eq.${t.sku}&product_id=eq.${t.product_id}`);
    if (!offer) { bump('offer_not_attached'); continue; }
    // SKU-bound captures only (product page / Dunnes product API); a later search-listing capture of the daily refresh is never evidence.
    const [resp] = await get(`retailer_identity_responses?select=id,retrieved_at&store_product_id=eq.${offer.id}&source_kind=in.(captured_product,captured_product_api)&order=retrieved_at.desc&limit=1`);
    if (!resp) { bump('no_sku_bound_capture'); continue; }
    const ai = ev.ai; const structuralOk = (ev.confirmation as string[]).every(r => r.startsWith('title_words_missing:'));
    if (!ai || ai.decision !== 'verified_exact' || !structuralOk) { bump('review_record_not_acceptable'); continue; }
    const form = cap.forms.find((x: Row) => x.items.some((i: Row) => String(i.sku) === String(t.sku))) ?? cap.forms[0];
    log({ event: 'planned', store, tesco: tesco.store_sku, sku: t.sku, name: prov.name, review: cls.review });
    if (!APPLY) { bump('planned'); continue; }
    // 2. The review-tier observation (append-only; duplicates ignored by the unique constraint).
    const obs = { gtin: g.retail, gtin_kind: g.kind, gtin_origin_store: 'tesco', gtin_origin_sku: String(tesco.store_sku), gtin_origin_store_product_id: tesco.id,
      gtin_origin_evidence: { table: 'tesco_apify_provider_evidence', field: 'raw_item.gtin', tesco_name: prov.name, tesco_brand: prov.brand },
      store, evidence_kind: 'sku_found_by_gtin_search', query: form.form, endpoint: form.endpoint, http_status: 200, result_total: form.total, result_items: form.items,
      query_forms: [], response_sha256: form.sha256, response_body: brotliDecompressSync(Buffer.from(form.body_br, 'base64')).toString('utf8'),
      resolved_sku: String(t.sku), outcome: 'identity_consistent', tier: 'review', identity_reasons: [], review_reasons: cls.review, title_agreement: cls.agreement,
      rule_version: 'barcode-v5', observed_at: form.at };
    const ins = await fetch(`${process.env.SB_URL}/rest/v1/retailer_barcode_observations?on_conflict=gtin,store,response_sha256,observed_at`, { method: 'POST',
      headers: { ...H, Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(obs) });
    if (!ins.ok) { bump('observation_refused'); log({ event: 'observation_refused', sku: t.sku, message: (await ins.text()).slice(0, 200) }); continue; }
    // 4. The acceptance (database re-derives everything).
    const r = await fetch(`${process.env.SB_URL}/rest/v1/rpc/accept_barcode_review_association`, { method: 'POST', headers: H, body: JSON.stringify({
      p_origin_offer: tesco.id, p_gtin: g.retail, p_store: store, p_offer: offer.id, p_response: resp.id, p_model: ai,
      p_checks: { structural: 'pass', wording_only: 'pass', barcode_fresh_search: 'pass', confirmation: ev.confirmation, review_notes: cls.review, policy: 'barcode-review-ai-v1' },
      p_reason: `Policy barcode-review-ai-v1: ${store} GTIN search resolved exactly SKU ${t.sku} at review tier for Tesco "${prov.name}"; SKU-bound structural checks passed; independent AI verified_exact.` }) });
    if (!r.ok) { bump('db_refused'); log({ event: 'refused', sku: t.sku, message: (await r.text()).slice(0, 200) }); continue; }
    done++; bump('accepted');
  }
  log({ event: 'summary', apply: APPLY, store, reviewAccepted: accepted.size, recorded: done, tally });
}
main().catch(e => { console.error(e); process.exit(1); });
