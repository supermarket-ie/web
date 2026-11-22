// Automated barcode catalogue repairs (policy barcode-repair-v1, migration 20261123090000). Dry run unless APPLY=1.
// For every Tesco offer that is the GTIN origin of ACTIVE barcode associations:
//   1. regroup: split a mixed record (src/lib/barcode-catalogue-repair.ts planRegroup -> apply_barcode_regroup)
//   2. SuperValu attach: one governed direct capture of the SuperValu product page SuperValu's own search resolved,
//      then planSupervaluAttach -> attach_barcode_supervalu_offer (offer + retained capture in one transaction)
// Every decision is logged; the database re-checks the evidence and refuses anything weaker. Prices are then
// collected by the existing daily SuperValu refresh; the machine pair-approval run handles matching.
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APPLY, LIMIT (repairs of each kind per run).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { planRegroup, planSupervaluAttach, REPAIR_POLICY_VERSION, supervaluProductUrl, type RecordOffer } from '../src/lib/barcode-catalogue-repair';
import { captureOfferEvidence } from '../src/lib/pair-evidence';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const APPLY = process.env.APPLY === '1';
const LIMIT = Math.max(1, Math.min(500, Number(process.env.LIMIT ?? 200)));
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
const chunk = <T,>(xs: T[], n = 80) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
async function pages(build: (f: number) => PromiseLike<{ data: Row[] | null; error: unknown }>) {
  const out: Row[] = [];
  for (let f = 0; ; f += 1000) { const { data, error } = await build(f); if (error) throw error; out.push(...(data ?? [])); if (!data || data.length < 1000) return out; }
}
async function byIds(ids: string[], q: (c: string[]) => { range: (a: number, b: number) => PromiseLike<{ data: Row[] | null; error: unknown }> }) {
  const out: Row[] = [];
  for (const c of chunk([...new Set(ids)])) out.push(...await pages(f => q(c).range(f, f + 999)));
  return out;
}

async function main() {
  const sb: SupabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const tally: Record<string, number> = {};
  const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  const assoc = await pages(f => sb.from('current_barcode_associations').select('gtin,store,resolved_sku,status,gtin_origin_store_product_id')
    .eq('status', 'active').order('gtin').order('store').range(f, f + 999));
  const obs = await byIds(assoc.map(a => a.gtin), c => sb.from('retailer_barcode_observations')
    .select('gtin,store,gtin_origin_store_product_id,resolved_sku,result_items,tesco_name:gtin_origin_evidence->>tesco_name,tesco_brand:gtin_origin_evidence->>tesco_brand')
    .in('gtin', c).eq('tier', 'strong').order('observed_at', { ascending: false }));
  const groups = new Map<string, Row[]>();
  for (const a of assoc) groups.set(`${a.gtin_origin_store_product_id}|${a.gtin}`, [...(groups.get(`${a.gtin_origin_store_product_id}|${a.gtin}`) ?? []), a]);
  const tesco = new Map((await byIds(assoc.map(a => a.gtin_origin_store_product_id), c => sb.from('store_products').select('id,product_id,store,store_sku').in('id', c))).map(o => [o.id, o]));
  const loadRecords = async () => {
    const prods = [...new Set([...tesco.values()].map(t => t.product_id).filter(Boolean))];
    return byIds(prods, c => sb.from('store_products').select('id,product_id,store,store_sku,store_product_name,brand').in('product_id', c).in('store', ['tesco', 'dunnes', 'supervalu']));
  };
  const skuShared = async (offers: Row[]) => {
    const shared = new Set<string>();
    for (const s of ['tesco', 'dunnes', 'supervalu']) {
      const skus = offers.filter(o => o.store === s && o.store_sku).map(o => String(o.store_sku));
      const rows = await byIds(skus, c => sb.from('store_products').select('id,store_sku').eq('store', s).in('store_sku', c));
      const n = new Map<string, number>(); for (const r of rows) n.set(String(r.store_sku), (n.get(String(r.store_sku)) ?? 0) + 1);
      for (const o of offers) if (o.store === s && (n.get(String(o.store_sku)) ?? 0) > 1) shared.add(o.id);
    }
    return shared;
  };
  const tescoRef = (tid: string, gtin: string) => { const o = obs.find(x => x.gtin_origin_store_product_id === tid && x.gtin === gtin && x.tesco_name);
    return o ? { title: String(o.tesco_name), brand: (o.tesco_brand as string | null) ?? null } : null; };
  const toOffer = (o: Row): RecordOffer => ({ id: o.id, store: o.store, sku: o.store_sku ? String(o.store_sku) : null, name: String(o.store_product_name ?? ''), brand: o.brand ?? null });

  // 1. Regroup.
  let records = await loadRecords();
  let shared = await skuShared(records);
  let regrouped = 0;
  for (const [key, g] of groups) {
    const t = tesco.get(key.split('|')[0]);
    const ref = t && tescoRef(t.id, g[0].gtin);
    if (!t?.product_id || !ref) { bump('regroup:no_reference'); continue; }
    const resolved: Partial<Record<'dunnes' | 'supervalu', string>> = {};
    for (const a of g) resolved[a.store as 'dunnes' | 'supervalu'] = String(a.resolved_sku);
    const plan = planRegroup({ gtin: g[0].gtin, tesco: { id: t.id, ...ref }, record: records.filter(o => o.product_id === t.product_id).map(toOffer), resolved, shared });
    bump(`regroup:${plan.action}${plan.reasons.length ? ':' + plan.reasons[0].split(':')[0] : ''}`);
    if (plan.action !== 'regroup') continue;
    log({ event: 'regroup_planned', tesco: t.id, gtin: g[0].gtin, title: ref.title, members: plan.members, checks: plan.checks, apply: APPLY });
    if (!APPLY || regrouped >= LIMIT) continue;
    const { data, error } = await sb.rpc('apply_barcode_regroup', { p_policy_version: REPAIR_POLICY_VERSION, p_tesco_offer: t.id, p_gtin: g[0].gtin,
      p_offers: plan.members, p_canonical_name: ref.title, p_checks: plan.checks,
      p_reason: `Policy ${REPAIR_POLICY_VERSION}: GTIN ${g[0].gtin} resolved other SKUs for the remaining offers, which contradict "${ref.title}".` });
    if (error) { bump('regroup:db_refused'); log({ event: 'regroup_refused', tesco: t.id, message: error.message }); continue; }
    regrouped++; log({ event: 'regrouped', tesco: t.id, repair: data });
  }
  // Reload: regrouped Tesco offers now sit on their new records.
  if (regrouped) {
    for (const o of await byIds([...tesco.keys()], c => sb.from('store_products').select('id,product_id,store,store_sku').in('id', c))) tesco.set(o.id, o);
    records = await loadRecords(); shared = await skuShared(records);
  }

  // 2. SuperValu attach.
  let attached = 0, captures = 0;
  for (const [key, g] of groups) {
    const a = g.find(x => x.store === 'supervalu');
    const t = tesco.get(key.split('|')[0]);
    const ref = t && tescoRef(t.id, g[0].gtin);
    if (!a || !t?.product_id || !ref) continue;
    const record = records.filter(o => o.product_id === t.product_id).map(toOffer);
    if (record.some(o => o.store === 'supervalu' && o.sku)) continue;   // has an offer: regroup/repair territory, not attach
    const sku = String(a.resolved_sku);
    const owned = (await sb.from('store_products').select('id').eq('store', 'supervalu').eq('store_sku', sku)).data?.length ?? 0;
    const title = (obs.find(x => x.gtin === g[0].gtin && x.store === 'supervalu' && String(x.resolved_sku) === sku)?.result_items ?? [])
      .find((i: Row) => String(i.sku) === sku)?.name as string | undefined;
    if (owned || !title) { bump(owned ? 'attach:sku_owned' : 'attach:no_title'); continue; }
    const pre = planSupervaluAttach({ gtin: g[0].gtin, tesco: { id: t.id, ...ref }, record, sku, skuOwned: false, capture: { title, brand: null, sku } });
    if (pre.reasons.some(r => !r.startsWith('identity_review') && r !== 'no_direct_capture' && !r.startsWith('identity:brand'))) { bump(`attach:held:${pre.reasons[0]}`); continue; }
    if (!APPLY || attached >= LIMIT) { bump('attach:candidate'); continue; }
    const url = supervaluProductUrl(title, sku);
    let resp = null;
    try { captures++; resp = await captureOfferEvidence({ id: 'new', store: 'supervalu', store_sku: sku, store_url: url }, title); }
    catch (e) { log({ event: 'capture_error', sku, message: e instanceof Error ? e.message.slice(0, 160) : String(e) }); if (/circuit|blocked|slot|HTTP 403|HTTP 429/i.test(String(e))) break; continue; }
    const plan = planSupervaluAttach({ gtin: g[0].gtin, tesco: { id: t.id, ...ref }, record, sku, skuOwned: false,
      capture: resp ? { title: String(resp.identity.title ?? ''), brand: (resp.identity.brand as string | null) ?? null, sku: resp.sku } : null });
    if (!plan.attach) { bump(`attach:held:${plan.reasons[0]}`); log({ event: 'attach_held', sku, url, reasons: plan.reasons }); continue; }
    const { data, error } = await sb.rpc('attach_barcode_supervalu_offer', { p_policy_version: REPAIR_POLICY_VERSION, p_tesco_offer: t.id, p_gtin: g[0].gtin,
      p_sku: sku, p_url: url, p_name: String(resp!.identity.title), p_brand: (resp!.identity.brand as string | null) ?? null, p_response: resp, p_checks: { identity: 'strong', record: 'consistent' },
      p_reason: `Policy ${REPAIR_POLICY_VERSION}: SuperValu's own search resolved SKU ${sku} for GTIN ${g[0].gtin}; direct page "${resp!.identity.title}" matches "${ref.title}".` });
    if (error) { bump('attach:db_refused'); log({ event: 'attach_refused', sku, message: error.message }); continue; }
    attached++; log({ event: 'attached', sku, offer: data, tesco: t.id });
  }
  log({ event: 'summary', apply: APPLY, policy: REPAIR_POLICY_VERSION, groups: groups.size, regrouped, attached, captures, tally });
}
main().catch(e => { console.error(e); process.exit(1); });
