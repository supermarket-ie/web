// PURE generator: guarded Dunnes/SuperValu canonical RE-POINT batch (adapts the Tesco split-batch
// pattern; see scripts/tesco-split-batch-prepare.ts). It performs NO database access and NO writes.
// The SQL it emits is for the postgres supervised bridge only:
//   - asserts every reviewed row is unchanged, SKU ownership is unique, and (if named) the target
//     placeholder is an empty sku-less row, BEFORE changing anything;
//   - MOVES the offer (store_products.product_id) so its price history, receipts and failures stay
//     attached (they are keyed by store_product_id); only an EMPTY placeholder may be removed;
//   - re-asserts post-state (price history unchanged, one same-store SKU per canonical);
//   - DRY RUN ends in ROLLBACK, apply ends in COMMIT.
// An op without `identityVerifiedBy` produces SQL that RAISES immediately (held).
export type RepairPlan = { id: string; generatedAt: string; ops: Array<{
  offerId: string; store: 'dunnes' | 'supervalu'; sku: string; title: string; fromProductId: string; toProductId: string; toProductBrand: string | null;
  retirePlaceholderId?: string; placeholderTitle?: string; identityVerifiedBy?: string; note?: string }> };
const UUID = /^[0-9a-f-]{36}$/;
const lit = (v: unknown) => v == null ? 'null' : `'${String(v).replaceAll("'", "''")}'`;

export function repairSql(plan: RepairPlan, commit: boolean): string {
  for (const o of plan.ops) {
    for (const id of [o.offerId, o.fromProductId, o.toProductId, o.retirePlaceholderId].filter(Boolean) as string[]) if (!UUID.test(id)) throw new Error(`bad id ${id}`);
    if (!/^\d{5,14}$/.test(o.sku)) throw new Error(`bad sku ${o.sku}`);
  }
  const held = plan.ops.filter(o => !o.identityVerifiedBy);
  const head = [`-- Guarded Dunnes/SuperValu re-point batch ${plan.id} (generated ${plan.generatedAt}).`,
    '-- Run ONLY through the postgres supervised bridge. NOT APPLIED. Dry run ends in ROLLBACK.',
    '-- Offers MOVE with their history (keyed by store_product_id). Only an EMPTY sku-less placeholder may be removed.', 'begin;'];
  if (held.length) {
    return [...head, `do $held$ begin raise exception 'HELD: identity_not_established for ${held.map(o => `${o.store}:${o.sku}`).join(', ')}'; end $held$;`,
      `-- Proposed changes (NOT executable until identityVerifiedBy is recorded on each op):`,
      ...plan.ops.map(o => `--   move ${o.store}:${o.sku} (${o.offerId}) ${o.fromProductId} -> ${o.toProductId}${o.retirePlaceholderId ? `; retire empty placeholder ${o.retirePlaceholderId}` : ''}`),
      'rollback;', ''].join('\n');
  }
  const body: string[] = [];
  for (const o of plan.ops) {
    body.push(`  perform 1 from public.store_products where id=${lit(o.offerId)} and product_id=${lit(o.fromProductId)} and store=${lit(o.store)} and store_sku is not distinct from ${lit(o.sku)} and store_product_name=${lit(o.title)} for update;`,
      `  if not found then raise exception 'repair_snapshot_changed: offer ${o.offerId}'; end if;`,
      `  if (select count(*) from public.store_products where store=${lit(o.store)} and store_sku=${lit(o.sku)}) <> 1 then raise exception 'duplicate_sku_ownership: ${o.store}:${o.sku}'; end if;`,
      `  perform 1 from public.products where id=${lit(o.toProductId)} and brand is not distinct from ${lit(o.toProductBrand)} for update;`,
      `  if not found then raise exception 'repair_target_changed: ${o.toProductId}'; end if;`);
    if (o.retirePlaceholderId) body.push(
      `  perform 1 from public.store_products where id=${lit(o.retirePlaceholderId)} and product_id=${lit(o.toProductId)} and store=${lit(o.store)} and store_sku is null and store_url is null for update;`,
      `  if not found then raise exception 'placeholder_changed: ${o.retirePlaceholderId}'; end if;`,
      `  if exists (select 1 from public.price_observations where store_product_id=${lit(o.retirePlaceholderId)}) or exists (select 1 from public.scrape_product_receipts where store_product_id=${lit(o.retirePlaceholderId)})`,
      `     or exists (select 1 from public.scrape_failures where store_product_id=${lit(o.retirePlaceholderId)}) then raise exception 'placeholder_has_dependents: ${o.retirePlaceholderId}'; end if;`);
    else body.push(`  if exists (select 1 from public.store_products where product_id=${lit(o.toProductId)} and store=${lit(o.store)} and id<>${lit(o.offerId)}) then raise exception 'target_store_slot_occupied: ${o.toProductId}'; end if;`);
    body.push(`  select count(*) into n_obs from public.price_observations where store_product_id=${lit(o.offerId)};`);
    if (o.retirePlaceholderId) body.push(`  delete from public.store_products where id=${lit(o.retirePlaceholderId)};`);
    body.push(`  update public.store_products set product_id=${lit(o.toProductId)} where id=${lit(o.offerId)} and product_id=${lit(o.fromProductId)};`,
      `  if (select count(*) from public.price_observations where store_product_id=${lit(o.offerId)}) <> n_obs then raise exception 'price_history_changed: ${o.offerId}'; end if;`,
      `  if (select count(*) from public.store_products where product_id=${lit(o.toProductId)} and store=${lit(o.store)} and store_sku is not null) <> 1 then raise exception 'multiple_same_store_skus: ${o.toProductId}'; end if;`);
  }
  return [...head, 'do $repair$', 'declare n_obs bigint;', 'begin',
    "  if current_user <> 'postgres' then raise exception 'supervised_bridge_required'; end if;", ...body, 'end $repair$;',
    ...plan.ops.map(o => `select ${lit(`${o.store}:${o.sku}`)} moved_offer, product_id, (select count(*) from public.price_observations where store_product_id=s.id) price_history_rows from public.store_products s where id=${lit(o.offerId)};`),
    commit ? 'commit;' : 'rollback;', ''].join('\n');
}
