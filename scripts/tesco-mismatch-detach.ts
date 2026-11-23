// Legacy Tesco mismatch repair runner (policy tesco-detach-v1, migration 20261124130000). Dry run unless APPLY=1.
// Input: the read-only retained review report (scripts/tesco-retained-review.ts). For every genuine_mismatch with a
// material contradiction, loads the offer's latest retained Tesco provider item and calls detach_tesco_offer.
// Usage: SB_URL=.. SB_KEY=.. tsx scripts/tesco-mismatch-detach.ts <retained-review.json> [APPLY=1]
import { readFileSync } from 'node:fs';
import { DETACH_POLICY_VERSION, planDetach } from '../src/lib/tesco-mismatch-detach';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const APPLY = process.env.APPLY === '1';
const H = { apikey: process.env.SB_KEY!, Authorization: `Bearer ${process.env.SB_KEY}`, 'Content-Type': 'application/json' };
const get = async (p: string): Promise<Row[]> => { const r = await fetch(`${process.env.SB_URL}/rest/v1/${p}`, { headers: H }); const d = await r.json();
  if (!Array.isArray(d)) throw new Error(JSON.stringify(d).slice(0, 200)); return d; };
const log = (o: Record<string, unknown>) => console.log(JSON.stringify(o));

async function main() {
  const rows: Row[] = JSON.parse(readFileSync(process.argv[2], 'utf8')).rows.filter((r: Row) => r.klass === 'genuine_mismatch');
  const tally: Record<string, number> = {}; const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
  let done = 0;
  for (const r of rows) {
    const [ev] = await get(`tesco_apify_provider_evidence?select=id,sku,captured_at,name:raw_item->>name,brand_name:raw_item->>brand_name,gtin:raw_item->>gtin,department:raw_item->>department,aisle:raw_item->>aisle&store_product_id=eq.${r.mappingId}&sku=eq.${r.sku}&order=captured_at.desc&limit=1`);
    const plan = planDetach({ klass: r.klass, reasons: r.reasons ?? [], raw: ev ?? null });
    if (ev && Date.parse(ev.captured_at) < Date.now() - 30 * 864e5) plan.reasons.push('evidence_too_old');
    if (plan.reasons.length) { bump(`held:${plan.reasons[0].split(':')[0]}`); continue; }
    bump('planned');
    log({ event: 'planned', offer: r.mappingId, sku: r.sku, name: ev.name, category: plan.category, reasons: r.reasons });
    if (!APPLY) continue;
    const res = await fetch(`${process.env.SB_URL}/rest/v1/rpc/detach_tesco_offer`, { method: 'POST', headers: H, body: JSON.stringify({
      p_policy_version: DETACH_POLICY_VERSION, p_tesco_offer: r.mappingId, p_evidence_id: ev.id, p_category: plan.category,
      p_checks: { retained_review: r.klass, reasons: r.reasons },
      p_reason: `Policy ${DETACH_POLICY_VERSION}: Tesco's own retained page "${ev.name}" materially contradicts its record (${(r.reasons ?? []).join(', ')}).` }) });
    if (!res.ok) { bump('db_refused'); log({ event: 'refused', offer: r.mappingId, message: (await res.text()).slice(0, 200) }); continue; }
    done++;
  }
  log({ event: 'summary', apply: APPLY, policy: DETACH_POLICY_VERSION, mismatches: rows.length, detached: done, tally });
}
main().catch(e => { console.error(e); process.exit(1); });
