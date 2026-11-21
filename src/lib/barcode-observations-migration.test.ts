// PGlite validation of the PROPOSED migration 20261121090000 (append-only barcode observations + current view).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let db: PGlite;
const T = '7b000000-0000-0000-0000-000000000001';
const obs = (over: Record<string, string> = {}) => {
  const v = { gtin: '5010034592605', store: 'dunnes', sku: '100684387', outcome: 'identity_consistent', tier: 'strong', sha: 'a'.repeat(64),
    at: "now() - interval '1 hour'", ...over };
  return `insert into public.retailer_barcode_observations(gtin, gtin_kind, gtin_origin_store, gtin_origin_sku, gtin_origin_store_product_id, gtin_origin_evidence,
    store, evidence_kind, query, endpoint, http_status, result_total, result_items, response_sha256, resolved_sku, outcome, tier, identity_reasons, title_agreement, rule_version, observed_at)
    values ('${v.gtin}','gtin13','tesco','251698238','${T}','{"table":"tesco_apify_provider_evidence","field":"raw_item.gtin"}',
    '${v.store}','sku_found_by_gtin_search','${v.gtin}','https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/search?q=${v.gtin}',200,
    ${v.outcome === 'not_found' ? 0 : 1},'[]','${v.sha}',${v.outcome === 'not_found' || v.outcome === 'ambiguous' ? 'null' : `'${v.sku}'`},'${v.outcome}',${v.tier === 'null' ? 'null' : `'${v.tier}'`},'[]',0.9,'barcode-v1',${v.at})`;
};
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
    expect(r[0]).toMatchObject({ gtin: '5010034592605', store: 'dunnes', resolved_sku: '100684387', status: 'active', evidence_kind: 'sku_found_by_gtin_search' });
  });
  it('is append-only (no update, delete or truncate) and de-duplicates the same response', async () => {
    await db.exec(obs());
    await expect(db.exec(`update public.retailer_barcode_observations set tier = 'review'`)).rejects.toThrow(/append_only/);
    await expect(db.exec(`delete from public.retailer_barcode_observations`)).rejects.toThrow(/append_only/);
    await expect(db.exec(`truncate public.retailer_barcode_observations`)).rejects.toThrow(/append_only/);
    const at = (await db.query<{ t: string }>(`select observed_at::text t from public.retailer_barcode_observations`)).rows[0].t;
    await expect(db.exec(obs({ at: `'${at}'` }))).rejects.toThrow(/duplicate key/);
  });
  it('suspends when a later strong observation resolves the barcode to a DIFFERENT SKU', async () => {
    await db.exec(obs());
    await db.exec(obs({ sku: '100999999', sha: 'b'.repeat(64), at: 'now()' }));
    expect((await db.query<{ status: string }>(`select status from public.current_barcode_associations`)).rows[0].status).toBe('suspended_sku_changed');
  });
  it('the latest observation wins: a later held or not-found observation is not active', async () => {
    await db.exec(obs());
    await db.exec(obs({ outcome: 'identity_conflict', tier: 'held', sha: 'c'.repeat(64), at: 'now()' }));
    expect((await db.query<{ status: string }>(`select status from public.current_barcode_associations`)).rows[0].status).toBe('held');
    await db.exec(obs({ outcome: 'not_found', tier: 'null', sha: 'd'.repeat(64), at: "now() + interval '1 second'" }));
    expect((await db.query<{ status: string }>(`select status from public.current_barcode_associations`)).rows[0].status).toBe('not_found');
  });
  it('constraints reject inconsistent rows (tier vs outcome, malformed GTIN, non-retailer endpoint)', async () => {
    await expect(db.exec(obs({ outcome: 'identity_consistent', tier: 'held' }))).rejects.toThrow();
    await expect(db.exec(obs({ gtin: '50100345926' }))).rejects.toThrow();
    await expect(db.exec(obs().replace('https://storefrontgateway.dunnesstoresgrocery.com', 'https://example.com'))).rejects.toThrow();
  });
  it('service_role may only select and insert; anon/authenticated have no access', async () => {
    const priv = (await db.query<Record<string, boolean>>(`select has_table_privilege('service_role','public.retailer_barcode_observations','INSERT') i,
      has_table_privilege('service_role','public.retailer_barcode_observations','UPDATE') u, has_table_privilege('service_role','public.retailer_barcode_observations','DELETE') d,
      has_table_privilege('anon','public.retailer_barcode_observations','SELECT') a, has_table_privilege('authenticated','public.current_barcode_associations','SELECT') v`)).rows[0];
    expect(priv).toEqual({ i: true, u: false, d: false, a: false, v: false });
  });
});
