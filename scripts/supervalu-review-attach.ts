// SuperValu REVIEW-tier attach (policy barcode-review-ai-v1, migration 20261128090000). One-off ECS task; dry run unless APPLY=1.
// Per target {tesco_offer_id, product_id, evidence_id, sku}:
//   1. reference = the Tesco offer's own retained provider item (name, brand, GTIN); the record must have no SuperValu offer and
//      the SKU must be unowned;
//   2. a FRESH governed SuperValu search for the GTIN (every query form): classifyBarcodeResult must give REVIEW tier for
//      exactly this SKU (strong targets belong to barcode-catalogue-repairs; anything else holds);
//   3. a governed capture of the SuperValu product page for that SKU; title and brand come from SuperValu's own page;
//   4. deterministic: assessBarcodeHit must report NO conflict and only wording-only review notes; the review precheck
//      (src/lib/barcode-review-identity.ts) blocks any missing or retailer-only number / flavour / formulation / variant /
//      age-stage / size word that SuperValu's own page does not state;
//   5. an independent AI (assessReviewIdentity) must return verified_exact with every material fact true;
//   6. APPLY: append the review-tier observation, then attach_review_supervalu_offer re-checks everything in the database and
//      writes the offer, capture, repair row and AI acceptance in one transaction. No price is written here.
// Env: T = base64(brotli(JSON targets)), APPLY, ALLOW_AI_REVIEW=1 (required).
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { assessBarcodeHit, classifyBarcodeResult, normaliseGtin, type SearchHit } from '../src/lib/barcode-matching';
import { supervaluProductUrl } from '../src/lib/barcode-catalogue-repair';
import { assessReviewIdentity, decideReview, REVIEW_POLICY_VERSION, reviewPrecheck, type ReviewAssessment } from '../src/lib/barcode-review-identity';
import { isOwnLabel } from '../src/lib/comparison-policy';
import { captureOfferEvidence } from '../src/lib/pair-evidence';
import { withRetailerRequestSlot } from '@/lib/retailer-request-governor';
import { supabaseAdmin as sb } from '@/lib/supabase';

type Target = { tesco_offer_id: string; product_id: string; evidence_id: string; sku: string };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const APPLY = process.env.APPLY === '1';
const WORDING_ONLY = /^(extra_words|substitution):/;
const EXCLUDED = /alcohol|beer|wine|spirit|cider|lager|whiskey|vodka|gin\b|tobacco|cigar|vape|clothing|apparel/i;
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
const SEARCH = (q: string) => `https://storefrontgateway.supervalu.ie/api/stores/5550/search?q=${encodeURIComponent(q)}&take=5&page=1&skip=0`;
const HEADERS = () => ({ Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  'x-site-host': 'https://shop.supervalu.ie', 'x-site-location': 'HeadersBuilderInterceptor', 'x-correlation-id': crypto.randomUUID(),
  'x-shopping-mode': '22222222-2222-2222-2222-222222222222' });

async function search(form: string) {
  const endpoint = SEARCH(form), at = new Date().toISOString();
  const body = await withRetailerRequestSlot('supervalu', async () => {
    const r = await fetch(endpoint, { headers: HEADERS(), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    if (r.status !== 200) throw new Error(`SuperValu HTTP ${r.status}`);
    return t;
  });
  const j = JSON.parse(body);
  const items = (Array.isArray(j?.items) ? j.items : []).slice(0, 5).map((s: Row) => ({ sku: String(s?.sku ?? ''), name: typeof s?.name === 'string' ? s.name : '',
    brand: typeof s?.brand === 'string' ? s.brand : null, unitOfSize: s?.unitOfSize ?? null }));
  return { form, endpoint, at, body, total: Number.isFinite(Number(j?.total)) ? Number(j.total) : items.length, items };
}

/** Tesco-side words missing from the SuperValu title, from assessBarcodeHit wording notes ("extra_words:a+b|c"). */
const missingWords = (notes: string[]) => notes.flatMap(n => {
  const m = /^(?:extra_words|substitution):([^|]*)\|/.exec(n);
  return m && m[1] ? [`title_words_missing:${m[1]}`] : [];
});

async function main() {
  if (process.env.ALLOW_AI_REVIEW !== '1') throw new Error('review_not_authorised: set ALLOW_AI_REVIEW=1');
  const list = JSON.parse(brotliDecompressSync(Buffer.from(process.env.T ?? '', 'base64')).toString('utf8')) as Target[];
  const tally: Record<string, number> = {}; const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  let attached = 0;
  for (const t of list.slice(0, 60)) {
    try {
      const { data: tesco } = await sb.from('store_products').select('id,product_id,store,store_sku').eq('id', t.tesco_offer_id).maybeSingle();
      const { data: ev } = await sb.from('tesco_apify_provider_evidence').select('id,sku,store_product_id,name:raw_item->>name,brand:raw_item->>brand_name,gtin:raw_item->>gtin,net:raw_item->>net_contents')
        .eq('id', t.evidence_id).maybeSingle();
      if (!tesco || tesco.store !== 'tesco' || tesco.product_id !== t.product_id || !ev || ev.store_product_id !== tesco.id || String(ev.sku) !== String(tesco.store_sku) || !ev.name || !ev.brand) {
        bump('tesco_reference_invalid'); continue;
      }
      if (EXCLUDED.test(String(ev.name))) { bump('excluded_category'); continue; }
      const { data: svOnRecord } = await sb.from('store_products').select('id').eq('product_id', t.product_id).eq('store', 'supervalu');
      if ((svOnRecord ?? []).length) { bump('record_has_supervalu_offer'); continue; }
      const { data: owned } = await sb.from('store_products').select('id').eq('store', 'supervalu').eq('store_sku', t.sku);
      if ((owned ?? []).length) { bump('sku_owned'); continue; }
      const g = normaliseGtin(String(ev.gtin ?? '')); if (!g.ok) { bump('bad_gtin'); continue; }
      // 2. fresh barcode search
      const forms = [];
      for (const f of g.queryForms) forms.push(await search(f));
      const items: SearchHit[] = [...new Map(forms.flatMap(f => f.items).filter((i: Row) => i.sku).map((i: Row) => [i.sku, i])).values()] as SearchHit[];
      const cls = classifyBarcodeResult({ name: String(ev.name), brand: String(ev.brand) }, items, g.retail) as Row;
      if (cls.tier !== 'review' || String(cls.sku) !== t.sku) { bump(`barcode_not_review_of_sku:${cls.tier ?? cls.outcome}`); log({ event: 'held', sku: t.sku, reason: 'barcode', cls: { tier: cls.tier, sku: cls.sku } }); continue; }
      // 3. SKU-bound product page
      const title = items.find(i => i.sku === t.sku)!.name;
      const url = supervaluProductUrl(title, t.sku);
      const resp = await captureOfferEvidence({ id: 'new', store: 'supervalu', store_sku: t.sku, store_url: url }, title);
      if (!resp || resp.sku !== t.sku) { bump('no_direct_capture'); continue; }
      const svName = String(resp.identity.title ?? ''), svBrand = (resp.identity.brand as string | null) ?? null;
      // 4. deterministic
      const a = assessBarcodeHit({ name: String(ev.name), brand: String(ev.brand) }, { sku: t.sku, name: svName, brand: svBrand });
      const structural: string[] = [...a.conflicts.map(c => `identity:${c}`), ...a.review.filter(r => !WORDING_ONLY.test(r)).map(r => `identity_review:${r}`)];
      if (!svBrand || isOwnLabel(svName) || isOwnLabel(svBrand)) structural.push('brand_missing_or_own_label');
      const text = `${String(resp.identity.description ?? '')} ${String(resp.identity.ingredients ?? '')}`;
      const pre = reviewPrecheck({ confirmationReasons: [...structural, ...missingWords(a.review)], barcodeSearch: { gtin: g.retail, skus: items.map(i => i.sku) },
        sku: t.sku, retailerText: text, tescoName: String(ev.name), retailerName: svName });
      // 5. AI
      let ai: ReviewAssessment | null = null;
      if (pre.eligible) {
        try {
          ai = await assessReviewIdentity({ tesco: { name: String(ev.name), brand: String(ev.brand), gtin: g.retail, quantity: ev.net ?? null },
            retailer: { store: 'supervalu', sku: t.sku, name: svName, brand: svBrand, size: null, description: String(resp.identity.description ?? ''), ingredients: String(resp.identity.ingredients ?? '') } });
        } catch (e) { log({ event: 'review_ai_error', sku: t.sku, message: e instanceof Error ? e.message.slice(0, 160) : String(e) }); }
      }
      const d = decideReview(pre, ai);
      log({ event: d.accept ? 'review_accepted' : 'review_held', policy: REVIEW_POLICY_VERSION, sku: t.sku, ref: ev.name, title: svName, notes: a.review, reasons: d.reasons,
        ai: ai ? { decision: ai.decision, facts: ai.facts, rationale: ai.rationale } : null, apply: APPLY });
      if (!d.accept) { bump(`held:${(d.reasons[0] ?? '').split(':')[0]}`); continue; }
      if (!APPLY) { bump('would_attach'); continue; }
      // 6. observation (append-only) + attach (database re-checks)
      const f = forms.find(x => x.items.some((i: Row) => i.sku === t.sku)) ?? forms[0];
      const { error: oe } = await sb.from('retailer_barcode_observations').insert({ gtin: g.retail, gtin_kind: g.kind, gtin_origin_store: 'tesco', gtin_origin_sku: String(tesco.store_sku),
        gtin_origin_store_product_id: tesco.id, gtin_origin_evidence: { table: 'tesco_apify_provider_evidence', field: 'raw_item.gtin', tesco_name: ev.name, tesco_brand: ev.brand },
        store: 'supervalu', evidence_kind: 'sku_found_by_gtin_search', query: f.form, endpoint: f.endpoint, http_status: 200, result_total: f.total, result_items: f.items,
        query_forms: forms.map(x => x.form), response_sha256: createHash('sha256').update(f.body).digest('hex'), response_body: f.body, resolved_sku: t.sku,
        outcome: 'identity_consistent', tier: 'review', identity_reasons: [], review_reasons: cls.review, title_agreement: cls.agreement, rule_version: 'barcode-v5', observed_at: f.at });
      if (oe) { bump('observation_refused'); log({ event: 'observation_refused', sku: t.sku, message: oe.message }); continue; }
      const { data, error } = await sb.rpc('attach_review_supervalu_offer', { p_tesco_offer: tesco.id, p_gtin: g.retail, p_sku: t.sku, p_url: url, p_name: svName, p_brand: svBrand,
        p_response: resp, p_model: ai, p_checks: { structural: 'pass', wording_only: 'pass', barcode_fresh_search: 'pass', notes: a.review, policy: REVIEW_POLICY_VERSION },
        p_reason: `Policy ${REVIEW_POLICY_VERSION}: SuperValu GTIN search resolved exactly SKU ${t.sku} at review tier for Tesco "${ev.name}"; SuperValu page "${svName}"; structural checks passed; independent AI verified_exact.`.slice(0, 500) });
      if (error) { bump('db_refused'); log({ event: 'attach_refused', sku: t.sku, message: error.message }); continue; }
      attached++; bump('attached'); log({ event: 'attached', sku: t.sku, offer: data, tesco: tesco.id });
    } catch (e) {
      bump('error'); log({ event: 'error', sku: t.sku, message: e instanceof Error ? e.message.slice(0, 160) : String(e) });
      if (/circuit|blocked|slot|HTTP 403|HTTP 429/i.test(String(e))) break;
    }
  }
  log({ event: 'summary', apply: APPLY, policy: REVIEW_POLICY_VERSION, targets: list.length, attached, tally });
}
main().catch(e => { console.error(e); process.exit(1); });
