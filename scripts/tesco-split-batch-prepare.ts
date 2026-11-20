// READ-ONLY: build ONE guarded canonical split batch for split_ready enrichment
// rows. Emits a manifest (JSON) and a single SQL transaction for the postgres
// supervised bridge. The SQL first ASSERTS every reviewed row is unchanged, then
// renames the core canonical to its substantiated identity, creates one new
// canonical per conflicting product and MOVES those offers (store_products.
// product_id) so their price history moves with them, and moves under-specified
// offers to a residual generic canonical. Nothing is deleted. DRY RUN ends in
// ROLLBACK; the apply variant ends in COMMIT.
// Usage: tsx scripts/tesco-split-batch-prepare.ts <enrichment.json> <outPrefix> [excludeCanonicalName...]
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const sb = createClient(process.env.SB_URL!, process.env.SB_KEY!, { auth: { persistSession: false } });
const lit = (v: unknown) => v == null ? 'null' : `'${String(v).replaceAll("'", "''")}'`;
const UUID = /^[0-9a-f-]{36}$/;

type Verdict = { store: string; role: string; sku: string | null; name: string; brand: string | null; verdict: string; conflicts: string[] };
async function main() {
  const [enrichPath, outPrefix, ...exclude] = process.argv.slice(2);
  const rows = (JSON.parse(readFileSync(enrichPath, 'utf8')).rows as Array<Record<string, unknown>>)
    .filter(r => r.status === 'split_ready' && !exclude.includes(String((r.current as { name: string }).name)));
  const manifest: unknown[] = []; const asserts: string[] = []; const changes: string[] = []; const checks: string[] = [];
  for (const r of rows) {
    const pid = String(r.canonicalId); if (!UUID.test(pid)) throw new Error('bad id');
    const { data: p } = await sb.from('products').select('id,canonical_name,brand,ean,category').eq('id', pid).single();
    const { data: offers } = await sb.from('store_products').select('id,product_id,store,store_sku,store_product_name,brand,url_status').eq('product_id', pid);
    const proposed = r.proposed as { name: string; brand: string };
    const verdicts = r.offerVerdicts as Verdict[];
    const byKey = (v: { store: string; sku: string | null; name: string }) => (offers ?? []).filter(o => o.store === v.store && (o.store_sku ?? null) === v.sku && o.store_product_name === v.name);
    // Blockers: anything bound to an offer that would move (approvals, links).
    const moving = verdicts.filter(v => v.verdict !== 'agrees');
    const movingIds = moving.flatMap(v => byKey(v).map(o => o.id));
    const { data: appr } = movingIds.length ? await sb.from('tesco_first_price_approvals').select('id').in('store_product_id', movingIds).is('consumed_at', null).is('revoked_at', null) : { data: [] };
    const blockers: string[] = [];
    if ((appr ?? []).length) blockers.push(`live_first_price_approval_on_moving_offer(${(appr ?? []).length})`);
    for (const v of verdicts) if (byKey(v).length !== 1) blockers.push(`offer_not_uniquely_identified(${v.store}:${v.sku})`);
    // Groups: conflicting offers grouped by (brand, pack) as in the proposal.
    const split = (r.splitInto as Array<{ brand: string | null; pack: string | null; variant: string; complete: boolean; sources: string[] }>).slice(1);
    const plan = { canonical_id: pid, from: { canonical_name: p?.canonical_name, brand: p?.brand }, to: { canonical_name: proposed.name, brand: proposed.brand },
      keep_offers: verdicts.filter(v => v.verdict === 'agrees').map(v => ({ ...v, id: byKey(v)[0]?.id })),
      new_products: [] as Array<{ id: string; canonical_name: string; brand: string | null; complete: boolean; offers: Array<{ id: string; store: string; sku: string | null; name: string }> }>,
      residual: null as null | { id: string; canonical_name: string; offers: Array<{ id: string; store: string; sku: string | null; name: string }> },
      staged_tesco_offer: null as null | Record<string, string>,
      blockers };
    for (const g of split) {
      const members = verdicts.filter(v => v.verdict === 'conflicts' && g.sources.some(s => s.startsWith(`${v.store}:${v.role}:`) && s.endsWith(`:${v.sku ?? v.name}`)));
      const first = members[0]; if (!first) continue;
      plan.new_products.push({ id: randomUUID(), canonical_name: first.name.replace(/\s*\(\s*(\d[^)]*)\)\s*$/, ' $1').trim(), brand: first.brand, complete: g.complete,
        offers: members.map(v => ({ id: byKey(v)[0]?.id, store: v.store, sku: v.sku, name: v.name })) });
    }
    const silent = verdicts.filter(v => v.verdict === 'silent');
    // Tesco side of the repair: the proposed SKU becomes a NEW Tesco offer on the
    // core record, STAGED (url_status failed) - never collected or shown until a
    // verified activation. The wrong current Tesco offer keeps its own history.
    const proposedSku = String(r.proposed_sku ?? '');
    const { data: owners } = await sb.from('store_products').select('id').eq('store', 'tesco').eq('store_sku', proposedSku);
    if (!/^\d{6,12}$/.test(proposedSku)) blockers.push('proposed_sku_invalid');
    if ((owners ?? []).length) blockers.push('proposed_sku_already_owned');
    const staged = { id: randomUUID(), store_sku: proposedSku, store_url: `https://www.tesco.ie/shop/en-IE/products/${proposedSku}`,
      store_product_name: String((r.supportingSources as Array<{ store: string; name: string }>).find(x => x.store === 'tesco')?.name ?? '') };
    if (silent.length) plan.residual = { id: randomUUID(), canonical_name: String(p?.canonical_name), offers: silent.map(v => ({ id: byKey(v)[0]?.id, store: v.store, sku: v.sku, name: v.name })) };
    plan.staged_tesco_offer = staged;
    manifest.push(plan);
    if (blockers.length) continue;
    asserts.push(`  if exists (select 1 from public.store_products where store='tesco' and store_sku=${lit(proposedSku)}) then raise exception 'split_target_sku_owned: ${proposedSku}'; end if;`);
    // ---- SQL ----
    asserts.push(`  perform 1 from public.products where id=${lit(pid)} and canonical_name=${lit(p?.canonical_name)} and brand is not distinct from ${lit(p?.brand)} and ean is not distinct from ${lit(p?.ean)} for update;
  if not found then raise exception 'split_snapshot_changed: product ${pid}'; end if;`);
    for (const o of offers ?? []) asserts.push(`  perform 1 from public.store_products where id=${lit(o.id)} and product_id=${lit(pid)} and store=${lit(o.store)} and store_sku is not distinct from ${lit(o.store_sku)} and store_product_name=${lit(o.store_product_name)} for update;
  if not found then raise exception 'split_snapshot_changed: offer ${o.id}'; end if;`);
    asserts.push(`  if (select count(*) from public.store_products where product_id=${lit(pid)}) <> ${(offers ?? []).length} then raise exception 'split_offer_set_changed: ${pid}'; end if;`);
    changes.push(`  -- ${p?.canonical_name} -> ${proposed.name}`);
    changes.push(`  update public.products set canonical_name=${lit(proposed.name)}, brand=${lit(proposed.brand)} where id=${lit(pid)};`);
    for (const np of plan.new_products) {
      changes.push(`  insert into public.products(id, canonical_name, brand, category) values (${lit(np.id)}, ${lit(np.canonical_name)}, ${lit(np.brand)}, ${lit(p?.category)});`);
      for (const o of np.offers) changes.push(`  update public.store_products set product_id=${lit(np.id)} where id=${lit(o.id)} and product_id=${lit(pid)};`);
      checks.push(`select ${lit(np.canonical_name)} new_product, count(*) moved_offers from public.store_products where product_id=${lit(np.id)}`);
    }
    if (plan.residual) {
      changes.push(`  insert into public.products(id, canonical_name, brand, category) values (${lit(plan.residual.id)}, ${lit(plan.residual.canonical_name)}, null, ${lit(p?.category)});`);
      for (const o of plan.residual.offers) changes.push(`  update public.store_products set product_id=${lit(plan.residual.id)} where id=${lit(o.id)} and product_id=${lit(pid)};`);
    }
    changes.push(`  insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, url_status) values (${lit(staged.id)}, ${lit(pid)}, 'tesco', ${lit(staged.store_sku)}, ${lit(staged.store_url)}, ${lit(staged.store_product_name)}, 'failed');`);
    checks.push(`select ${lit(proposed.name)} core, count(*) remaining_offers from public.store_products where product_id=${lit(pid)}`);
  }
  const body = (end: string) => `-- Guarded canonical split batch (generated ${new Date().toISOString()}).
-- Run ONLY through the postgres supervised bridge. Asserts every reviewed row
-- first; any drift aborts the whole transaction. Offers MOVE with their
-- price_observations (keyed by store_product_id), so price history is preserved;
-- nothing is deleted.
begin;
do $split$ begin
  if current_user <> 'postgres' then raise exception 'supervised_bridge_required'; end if;
${asserts.join('\n')}
${changes.join('\n')}
end $split$;
${checks.join(';\n')};
${end};
`;
  writeFileSync(`${outPrefix}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), cases: manifest }, null, 1));
  writeFileSync(`${outPrefix}-dry-run.sql`, body('rollback'));
  writeFileSync(`${outPrefix}-apply.sql`, body('commit'));
  console.log(JSON.stringify({ cases: manifest.length, ready: (manifest as Array<{ blockers: string[] }>).filter(m => !m.blockers.length).length,
    blocked: (manifest as Array<{ blockers: string[]; from: { canonical_name: string } }>).filter(m => m.blockers.length).map(m => `${m.from.canonical_name}: ${m.blockers.join(',')}`) }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
