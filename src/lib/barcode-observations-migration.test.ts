// PGlite validation of the PROPOSED migration 20261121090000 (append-only barcode observations, reviews, current view).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let db: PGlite;
const T = '7b000000-0000-0000-0000-000000000001';
const EP = { dunnes: 'https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/search', supervalu: 'https://storefrontgateway.supervalu.ie/api/stores/5550/search' };
const obs = (over: Record<string, string> = {}) => {
  const v = { gtin: '5010034592605', store: 'dunnes', sku: '100684387', outcome: 'identity_consistent', tier: 'strong', sha: 'a'.repeat(64),
    at: "now() - interval '1 hour'", ir: '[]', rr: '[]', ...over };
  const noSku = v.outcome === 'not_found' || v.outcome === 'ambiguous';
  return `insert into public.retailer_barcode_observations(gtin, gtin_kind, gtin_origin_store, gtin_origin_sku, gtin_origin_store_product_id, gtin_origin_evidence,
    store, evidence_kind, query, endpoint, http_status, result_total, result_items, response_sha256, resolved_sku, outcome, tier, title_agreement, rule_version, observed_at,
    identity_reasons, review_reasons)
    values ('${v.gtin}','gtin13','tesco','251698238','${T}','{"table":"tesco_apify_provider_evidence","field":"raw_item.gtin","tesco_name":"Dolmio 150g","tesco_brand":"Dolmio"}',
    '${v.store}','sku_found_by_gtin_search','${v.gtin}','${EP[v.store as 'dunnes' | 'supervalu']}?q=${v.gtin}',200,
    ${noSku ? 0 : 1},'[]','${v.sha}',${noSku ? 'null' : `'${v.sku}'`},'${v.outcome}',${v.tier === 'null' ? 'null' : `'${v.tier}'`},0.9,'barcode-v2',${v.at},'${v.ir}','${v.rr}') returning id`;
};
const status = async () => (await db.query<{ status: string }>(`select status from public.current_barcode_associations`)).rows[0]?.status;
beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.store_products (id uuid primary key);
    insert into public.store_products(id) values ('${T}');`);
  await db.exec(readFileSync('supabase/migrations/20261121090000_retailer_barcode_observations.sql', 'utf8'));
});
afterEach(async () => { await db.close(); });

describe('retailer_barcode_observations (proposed)', () => {
  it('records an observation and exposes it as the current active association', async () => {
    await db.exec(obs());
    const r = (await db.query<Record<string, unknown>>(`select * from public.current_barcode_associations`)).rows;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ gtin: '5010034592605', store: 'dunnes', resolved_sku: '100684387', status: 'active', evidence_kind: 'sku_found_by_gtin_search', rule_version: 'barcode-v2' });
  });
  it('is append-only (no update, delete or truncate), stamps recorded_at, and de-duplicates the same response', async () => {
    await db.exec(obs());
    await expect(db.exec(`update public.retailer_barcode_observations set tier = 'review'`)).rejects.toThrow(/append_only/);
    await expect(db.exec(`delete from public.retailer_barcode_observations`)).rejects.toThrow(/append_only/);
    await expect(db.exec(`truncate public.retailer_barcode_observations`)).rejects.toThrow(); // FK from reviews and the trigger both refuse
    const at = (await db.query<{ t: string }>(`select observed_at::text t from public.retailer_barcode_observations`)).rows[0].t;
    await expect(db.exec(obs({ at: `'${at}'` }))).rejects.toThrow(/duplicate key/);
    await expect(db.exec(obs({ at: "now() + interval '1 day'", sha: 'f'.repeat(64) }))).rejects.toThrow(/in_future/);
  });
  it('the Tesco origin mapping cannot be deleted while evidence references it (restrict, not a blocked set-null)', async () => {
    await db.exec(obs());
    await expect(db.exec(`delete from public.store_products where id = '${T}'`)).rejects.toThrow(/foreign key/);
  });
  it('a changed strong SKU suspends; A -> B -> A returns to active; an accepted review of B clears it; a reject holds', async () => {
    await db.exec(obs());
    await db.exec(obs({ sku: '100999999', sha: 'b'.repeat(64), at: "now() - interval '30 minutes'" }));
    expect(await status()).toBe('suspended_sku_changed');
    const prev = (await db.query<{ p: string }>(`select previous_strong_sku p from public.current_barcode_associations`)).rows[0].p;
    expect(prev).toBe('100684387');
    await db.exec(obs({ sha: 'c'.repeat(64), at: "now() - interval '20 minutes'" }));
    expect(await status()).toBe('active');
    const id = (await db.query<{ id: string }>(obs({ sku: '100999999', sha: 'd'.repeat(64), at: "now() - interval '10 minutes'" }))).rows[0].id;
    expect(await status()).toBe('suspended_sku_changed');
    await db.exec(`insert into public.retailer_barcode_association_reviews(gtin, store, sku, decision, observation_id, reviewer, reason)
      values ('5010034592605','dunnes','100999999','accept','${id}','owner','Relabelled SKU confirmed against the retailer page.')`);
    expect(await status()).toBe('active');
    await db.exec(`insert into public.retailer_barcode_association_reviews(gtin, store, sku, decision, observation_id, reviewer, reason)
      values ('5010034592605','dunnes','100999999','reject','${id}','owner','Different product on review of the page.')`);
    expect(await status()).toBe('held');
  });
  it('a previously strong association that is no longer found is suspended, not silently not_found', async () => {
    await db.exec(obs());
    await db.exec(obs({ outcome: 'not_found', tier: 'null', sha: 'e'.repeat(64), at: 'now()' }));
    expect(await status()).toBe('suspended_no_longer_found');
  });
  it('constraints reject inconsistent rows', async () => {
    await expect(db.exec(obs({ outcome: 'identity_consistent', tier: 'held' }))).rejects.toThrow();
    await expect(db.exec(obs({ gtin: '50100345926' }))).rejects.toThrow();
    await expect(db.exec(obs().replace('storefrontgateway.dunnesstoresgrocery.com', 'example.com'))).rejects.toThrow();
    await expect(db.exec(obs({ store: 'supervalu' }).replace(EP.supervalu, EP.dunnes))).rejects.toThrow();
    await expect(db.exec(obs().replace(',200,', ',503,'))).rejects.toThrow();
    await expect(db.exec(obs({ sku: '5010034592605' }))).rejects.toThrow();
    await expect(db.exec(obs().replace(',"tesco_name":"Dolmio 150g"', ''))).rejects.toThrow();
    await expect(db.exec(obs().replace("'sku_found_by_gtin_search'", "'gtin_returned_by_retailer'"))).rejects.toThrow();
  });
  it('the tier must agree with its reasons', async () => {
    await expect(db.exec(obs({ rr: '["extra_words:caramel|"]' }))).rejects.toThrow(/check constraint/);           // strong with a review reason
    await expect(db.exec(obs({ ir: '["pack"]', sha: '1'.repeat(64) }))).rejects.toThrow(/check constraint/);      // strong with a conflict
    await expect(db.exec(obs({ tier: 'review', sha: '2'.repeat(64) }))).rejects.toThrow(/check constraint/);      // review with no reason
    await expect(db.exec(obs({ outcome: 'identity_conflict', tier: 'held', sha: '3'.repeat(64) }))).rejects.toThrow(/check constraint/);
    await db.exec(obs({ tier: 'review', rr: '["extra_words:caramel|"]', sha: '4'.repeat(64) }));
    await db.exec(obs({ outcome: 'identity_conflict', tier: 'held', ir: '["pack"]', sha: '5'.repeat(64), at: "now() - interval '2 hours'" }));
  });
  it('a review is bound to its observation: it cannot decide another gtin, store or SKU', async () => {
    const id = (await db.query<{ id: string }>(obs())).rows[0].id;
    const review = (gtin: string, store: string, sku: string) => db.exec(`insert into public.retailer_barcode_association_reviews(gtin, store, sku, decision,
      observation_id, reviewer, reason) values ('${gtin}','${store}','${sku}','accept','${id}','owner','Relabelled SKU confirmed against the retailer page.')`);
    await expect(review('5010034592605', 'dunnes', '100999999')).rejects.toThrow(/foreign key/);
    await expect(review('5000000000000', 'dunnes', '100684387')).rejects.toThrow(/foreign key/);
    await expect(review('5010034592605', 'supervalu', '100684387')).rejects.toThrow(/foreign key/);
    await review('5010034592605', 'dunnes', '100684387');
  });
  it('service_role may only select and insert; anon/authenticated have no access', async () => {
    const q = (role: string, obj: string, p: string) => `has_table_privilege('${role}','public.${obj}','${p}')`;
    const priv = (await db.query<Record<string, boolean>>(`select ${q('service_role', 'retailer_barcode_observations', 'INSERT')} i,
      ${q('service_role', 'retailer_barcode_observations', 'UPDATE')} u, ${q('service_role', 'retailer_barcode_observations', 'DELETE')} d,
      ${q('service_role', 'retailer_barcode_association_reviews', 'UPDATE')} ru, ${q('anon', 'retailer_barcode_observations', 'SELECT')} a,
      ${q('authenticated', 'current_barcode_associations', 'SELECT')} v`)).rows[0];
    expect(priv).toEqual({ i: true, u: false, d: false, ru: false, a: false, v: false });
  });
});
