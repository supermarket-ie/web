// Continuous machine pair approvals (policy barcode-exact-v1). Dry run unless APPLY=1.
// For every ACTIVE barcode association it builds the candidate pairs (Tesco–SuperValu, Tesco–Dunnes, and
// Dunnes–SuperValu when both resolve the same Tesco GTIN), loads the freshest direct capture of each offer, and
// evaluates src/lib/machine-pair-approval.ts. APPLY=1: an approval goes through record_machine_pair_approval (which
// re-checks everything in the database and inserts through the unchanged ledger triggers); a hold or rejection is
// appended to machine_pair_decisions only when it differs from that pair's latest decision. No price, mapping or
// association is changed.
// CAPTURE=1 first takes ONE governed direct capture (SuperValu product page, Dunnes SKU-bound product API) for each
// associated non-Tesco offer with no capture in the last CAPTURE_MAX_AGE_DAYS (default 6), up to CAPTURE_LIMIT,
// so new candidates gain evidence and approved pairs keep fresh monitoring evidence (src/lib/pair-evidence.ts).
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APPLY, LIMIT (approvals per run), CAPTURE, CAPTURE_LIMIT.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { captureOfferEvidence, closeEvidenceRuns, retainEvidence, type EvidenceOffer } from '../src/lib/pair-evidence';
import { evaluateMachinePair, MACHINE_FRESHNESS_DAYS, MACHINE_POLICY_VERSION, type MachineSide } from '../src/lib/machine-pair-approval';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const APPLY = process.env.APPLY === '1';
const LIMIT = Math.max(1, Math.min(2000, Number(process.env.LIMIT ?? 500)));
const CAPTURE = process.env.CAPTURE === '1';
const CAPTURE_LIMIT = Math.max(0, Math.min(1000, Number(process.env.CAPTURE_LIMIT ?? 300)));
const CAPTURE_MAX_AGE_DAYS = Math.max(1, Math.min(12, Number(process.env.CAPTURE_MAX_AGE_DAYS ?? 6)));
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
const chunk = <T,>(xs: T[], n = 80) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const pairKey = (a: string, b: string) => [a, b].sort().join('|');

async function all(sb: SupabaseClient, build: (from: number) => PromiseLike<{ data: Row[] | null; error: unknown }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
// Every chunk is paged, so a chunk with more than 1,000 rows (e.g. many pages per URL) is never truncated.
async function byIds(sb: SupabaseClient, ids: string[], q: (c: string[]) => { range: (a: number, b: number) => PromiseLike<{ data: Row[] | null; error: unknown }> }) {
  const out: Row[] = [];
  for (const c of chunk([...new Set(ids)])) for (let f = 0; ; f += 1000) {
    const { data, error } = await q(c).range(f, f + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = Date.now(), since = new Date(now - MACHINE_FRESHNESS_DAYS * 86400000).toISOString();
  const assoc = await all(sb, f => sb.from('current_barcode_associations').select('gtin,store,resolved_sku,status,gtin_origin_store_product_id')
    .in('store', ['dunnes', 'supervalu']).order('gtin').order('store').range(f, f + 999));
  const tescoOffers = await byIds(sb, assoc.map(a => a.gtin_origin_store_product_id), c => sb.from('store_products').select('id,product_id,store,store_sku').in('id', c));
  const tescoById = new Map(tescoOffers.map(o => [o.id, o]));
  const products = [...new Set(tescoOffers.map(o => o.product_id).filter(Boolean))];
  const offers = await byIds(sb, products, c => sb.from('store_products').select('id,product_id,store,store_sku,store_url').in('product_id', c).in('store', ['tesco', 'dunnes', 'supervalu']));
  const skuCount = new Map<string, number>();
  for (const s of ['tesco', 'dunnes', 'supervalu']) {
    const skus = offers.filter(o => o.store === s && o.store_sku).map(o => String(o.store_sku));
    for (const o of await byIds(sb, skus, c => sb.from('store_products').select('store_sku').eq('store', s).in('store_sku', c)))
      skuCount.set(`${s}:${o.store_sku}`, (skuCount.get(`${s}:${o.store_sku}`) ?? 0) + 1);
  }
  // Freshest direct capture per offer.
  const pages = await byIds(sb, offers.filter(o => o.store === 'tesco').map(o => `https://www.tesco.ie/shop/en-IE/products/${o.store_sku}`),
    c => sb.from('tesco_direct_collection_pages').select('id,requested_url,created_at,parsed').in('requested_url', c).eq('outcome', 'ok').eq('http_status', 200)
      .not('body_sha256', 'is', null).gte('created_at', since).order('created_at', { ascending: false }));
  const responses = await byIds(sb, offers.filter(o => o.store !== 'tesco').map(o => o.id),
    c => sb.from('retailer_identity_responses').select('id,store_product_id,sku,source_kind,retrieved_at,title:identity->>title,brand:identity->>brand,gtin:identity->>gtin')
      .in('store_product_id', c).in('source_kind', ['captured_product', 'captured_product_api']).gte('retrieved_at', since).order('retrieved_at', { ascending: false }));
  // Captures are retained only with APPLY; a dry run never spends retailer requests it would discard.
  if (CAPTURE && APPLY) await captureStage();
  else if (CAPTURE) log({ event: 'capture_skipped', reason: 'dry run' });
  // Pairs with any human decision: the machine never overrides or re-approves them.
  const human = new Set((await all(sb, f => sb.from('retailer_offer_pair_reviews').select('left_offer_id,right_offer_id').eq('decision_kind', 'human')
    .order('id').range(f, f + 999)).catch(e => { if (APPLY) throw e; return [] as Row[]; })).map(r => pairKey(r.left_offer_id, r.right_offer_id)));
  const active = new Set((await all(sb, f => sb.rpc('current_pair_review_status', { p_active_only: true }).range(f, f + 999))).map(r => pairKey(r.left_offer_id, r.right_offer_id)));
  // Before migration 20261122090000 the table is absent: a dry run still evaluates every candidate.
  const decided = await all(sb, f => sb.from('machine_pair_decisions').select('left_offer_id,right_offer_id,decision,reasons,decided_at').eq('policy_version', MACHINE_POLICY_VERSION)
    .order('decided_at', { ascending: false }).range(f, f + 999)).catch(e => { if (APPLY) throw e; return [] as Row[]; });
  const lastDecision = new Map<string, Row>();
  for (const d of decided) { const k = pairKey(d.left_offer_id, d.right_offer_id); if (!lastDecision.has(k)) lastDecision.set(k, d); }

  const side = (o: Row, association: Row | null): MachineSide => {
    let source: MachineSide['source'] = null;
    if (o.store === 'tesco') {
      const p = pages.find(x => x.requested_url === `https://www.tesco.ie/shop/en-IE/products/${o.store_sku}`);
      const prod = (p?.parsed?.products ?? []).find((x: Row) => String(x?.sku) === String(o.store_sku));
      if (p && prod) source = { id: p.id, kind: 'tesco_page', capturedAt: p.created_at, sku: String(prod.sku), title: String(prod.name ?? ''), brand: prod.brand ?? null, gtin: prod.gtin ?? null };
    } else {
      const r = responses.find(x => x.store_product_id === o.id);
      if (r) source = { id: r.id, kind: r.source_kind, capturedAt: r.retrieved_at, sku: String(r.sku), title: String(r.title ?? ''), brand: r.brand ?? null, gtin: r.gtin ?? null };
    }
    return { store: o.store, offerId: o.id, productId: o.product_id ?? null, sku: String(o.store_sku ?? ''), skuShared: (skuCount.get(`${o.store}:${o.store_sku}`) ?? 0) !== 1, source,
      association: association ? { gtin: association.gtin, status: association.status, resolvedSku: String(association.resolved_sku), originOfferId: association.gtin_origin_store_product_id,
        originProductId: tescoById.get(association.gtin_origin_store_product_id)?.product_id ?? null } : null };
  };
  // Candidate pairs.
  type Cand = { a: MachineSide; b: MachineSide; gtin: string; origin: MachineSide | null };
  const cands: Cand[] = []; const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  const byOrigin = new Map<string, Row[]>();
  for (const a of assoc) byOrigin.set(`${a.gtin_origin_store_product_id}|${a.gtin}`, [...(byOrigin.get(`${a.gtin_origin_store_product_id}|${a.gtin}`) ?? []), a]);
  for (const group of byOrigin.values()) {
    const t = tescoById.get(group[0].gtin_origin_store_product_id);
    if (!t?.product_id) { bump('origin_offer_missing'); continue; }
    const mapped = group.map(a => ({ a, o: offers.find(x => x.product_id === t.product_id && x.store === a.store && String(x.store_sku) === String(a.resolved_sku)) }));
    for (const m of mapped) if (!m.o) bump(`${m.a.store}:sku_not_on_record`);
    const sides = mapped.filter(m => m.o).map(m => side(m.o!, m.a));
    const ts = side(t, null);
    for (const s of sides) cands.push({ a: ts, b: s, gtin: group[0].gtin, origin: null });
    if (sides.length === 2) cands.push({ a: sides[0], b: sides[1], gtin: group[0].gtin, origin: ts });
  }
  let approved = 0, written = 0;
  for (const c of cands) {
    const k = pairKey(c.a.offerId, c.b.offerId), kind = [c.a.store, c.b.store].sort().join('-');
    if (active.has(k)) { bump(`${kind}:already_active`); continue; }
    // Evaluated at decision time: captures taken earlier in this run must not look future-dated.
    const d = evaluateMachinePair(c.a, c.b, c.gtin, Date.now(), null, c.origin, human.has(k));
    bump(`${kind}:${d.decision}`);
    for (const r of d.reasons) bump(`reason:${r.replace(/:[^:]*$/, m => (m.length > 30 ? ':…' : m))}`);
    log({ event: 'decision', pair: kind, a: c.a.offerId, b: c.b.offerId, gtin: c.gtin, decision: d.decision, reasons: d.reasons,
      titles: [c.a.source?.title ?? null, c.b.source?.title ?? null] });
    if (!APPLY) { if (d.decision === 'approved') approved++; continue; }
    if (d.decision === 'approved') {
      if (approved >= LIMIT) continue;
      const { data, error } = await sb.rpc('record_machine_pair_approval', { p_policy_version: MACHINE_POLICY_VERSION, p_offer_a: c.a.offerId, p_offer_b: c.b.offerId,
        p_source_a: c.a.source!.id, p_source_b: c.b.source!.id, p_gtin: c.gtin, p_checks: d.checks,
        p_rationale: `Machine policy ${MACHINE_POLICY_VERSION}: GTIN ${c.gtin} resolved to this exact SKU by the retailer's own search; same catalogue record; fresh direct captures; "${c.a.source!.title}" = "${c.b.source!.title}" on brand, pack, variant and formulation.`.slice(0, 900),
        p_model_assessment: { source: 'none', verdict: 'none' } });
      if (error) { bump(`${kind}:db_refused`); log({ event: 'db_refused', pair: kind, a: c.a.offerId, b: c.b.offerId, message: error.message }); await recordHold(c, ['db_refused:' + error.message.slice(0, 120)], 'held'); continue; }
      approved++; log({ event: 'approved', pair: kind, review_id: data });
    } else await recordHold(c, d.reasons, d.decision);
  }
  async function recordHold(c: Cand, reasons: string[], decision: string) {
    const [l, r] = c.a.offerId < c.b.offerId ? [c.a.offerId, c.b.offerId] : [c.b.offerId, c.a.offerId];
    const last = lastDecision.get(pairKey(l, r));
    if (last && last.decision === decision && JSON.stringify(last.reasons) === JSON.stringify(reasons)) return;
    const { error } = await sb.from('machine_pair_decisions').insert({ policy_version: MACHINE_POLICY_VERSION, left_offer_id: l, right_offer_id: r, gtin: c.gtin.replace(/^0+/, ''),
      decision, reasons, evidence: { sources: [c.a.source?.id ?? null, c.b.source?.id ?? null] } });
    if (error) log({ event: 'decision_not_recorded', message: error.message }); else written++;
  }
  async function captureStage() {
    // Associated, mapped non-Tesco offers whose newest direct capture is missing or older than CAPTURE_MAX_AGE_DAYS.
    const fresh = now - CAPTURE_MAX_AGE_DAYS * 86400000;
    const obs = await byIds(sb, assoc.map(a => a.gtin), c => sb.from('retailer_barcode_observations').select('gtin,store,resolved_sku,result_items,observed_at')
      .in('gtin', c).eq('tier', 'strong').order('observed_at', { ascending: false }));
    const targets: Array<{ o: Row; title: string }> = [];
    for (const a of assoc) {
      const t = tescoById.get(a.gtin_origin_store_product_id);
      const o = t && offers.find(x => x.product_id === t.product_id && x.store === a.store && String(x.store_sku) === String(a.resolved_sku));
      if (!o || targets.some(x => x.o.id === o.id)) continue;
      const newest = responses.find(r => r.store_product_id === o.id);
      if (newest && Date.parse(newest.retrieved_at) >= fresh) continue;
      const ob = obs.find(x => x.gtin === a.gtin && x.store === a.store && String(x.resolved_sku) === String(a.resolved_sku));
      const title = (ob?.result_items ?? []).find((i: Row) => String(i.sku) === String(a.resolved_sku))?.name;
      if (title) targets.push({ o, title });
    }
    const runs: Partial<Record<EvidenceOffer['store'], string>> = {};
    let captured = 0, refused = 0;
    for (const { o, title } of targets.slice(0, CAPTURE_LIMIT)) {
      try {
        const r = await captureOfferEvidence({ id: o.id, store: o.store, store_sku: String(o.store_sku), store_url: o.store_url }, title);
        if (!r) { refused++; continue; }
        if (!APPLY) { captured++; continue; }
        const id = await retainEvidence(sb, r, o.id, runs);
        responses.unshift({ id, store_product_id: o.id, sku: r.sku, source_kind: r.source_kind, retrieved_at: r.retrieved_at,
          title: String(r.identity.title ?? ''), brand: (r.identity.brand as string | null) ?? null, gtin: (r.identity.gtin as string | null) ?? null });
        captured++;
      } catch (e) {
        log({ event: 'capture_error', offer: o.id, store: o.store, message: e instanceof Error ? e.message.slice(0, 160) : String(e) });
        if (/circuit|blocked|slot|HTTP 403|HTTP 429/i.test(String(e))) break;
      }
    }
    await closeEvidenceRuns(sb, runs);
    log({ event: 'capture_summary', apply: APPLY, due: targets.length, attempted: Math.min(targets.length, CAPTURE_LIMIT), captured, notProven: refused });
  }
  log({ event: 'summary', apply: APPLY, policy: MACHINE_POLICY_VERSION, associations: assoc.length, candidates: cands.length, approved, decisionsWritten: written, tally });
}
main().catch(e => { console.error(e); process.exit(1); });
