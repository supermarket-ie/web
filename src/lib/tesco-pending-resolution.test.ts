// Terminal resolution of HISTORICAL pending Tesco pages (migration
// 20261120090000): append-only, postgres-bridge only, explicit page, page row
// never modified, and only a RESOLVED pending page stops blocking its URL.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApifyDb, pgliteSupabase } from './test-support/apify-pglite';
import { selectApifyMappings } from './tesco-apify-collection';

const TP = '7c000000-0000-0000-0000-0000000000a1';
const T = '7c000000-0000-0000-0000-000000000001';
const RUN = '7c000000-0000-0000-0000-0000000000ff';
const OLD = '7c000000-0000-0000-0000-0000000000f0';
const PAGE = '7c000000-0000-0000-0000-0000000000e1';
const SKU = '318272231';
const URL = `https://www.tesco.ie/shop/en-IE/products/${SKU}`;
const NAME = 'Lenor Outdoorable Summer Breeze Fabric Conditioner 60 Washes 840ml';
const REASON = 'Historical pending page from an orphaned Nov 2026 run; outcome unknown; never retried; owner-approved terminal disposition.';
let db: PGlite; let sb: SupabaseClient;
const n = async (sql: string, p: unknown[] = []) => (await db.query<{ n: number }>(sql, p)).rows[0].n;
const pageRow = async () => (await db.query<{ j: unknown }>(`select to_jsonb(d) j from public.tesco_direct_collection_pages d where id = $1`, [PAGE])).rows[0].j;
const createdAt = async () => (await db.query<{ c: string }>(`select created_at::text c from public.tesco_direct_collection_pages where id = $1`, [PAGE])).rows[0].c;
const resolve = async (over: { url?: string; at?: string; reason?: string } = {}) =>
  db.query(`select tesco_internal.resolve_historical_pending_page($1, $2, $3::timestamptz, $4) id`,
    [PAGE, over.url ?? URL, over.at ?? await createdAt(), over.reason ?? REASON]);

beforeEach(async () => {
  db = await createApifyDb(); sb = pgliteSupabase(db);
  await db.exec(`
    insert into public.products(id, canonical_name, brand, ean) values ('${TP}','${NAME}','Lenor',null);
    insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status) values
      ('${T}','${TP}','tesco','${SKU}','${URL}','${NAME}','Lenor',false,null,'resolved');
    insert into public.scrape_runs(id, store, run_id, status, started_at) values
      ('${OLD}','tesco','seed-proven','success', now() - interval '30 days'),
      ('${RUN}','tesco','orphaned-run','running', now() - interval '12 days');
    -- Proven (earlier success), price long expired; an orphaned pending page blocks the URL.
    insert into public.scrape_product_receipts(run_id, store_product_id, outcome) values ('${OLD}','${T}','success');
    insert into public.tesco_direct_collection_pages(id, run_id, egress_key, requested_url, mode, outcome, detail, created_at)
      values ('${PAGE}','${RUN}','apify-tesco-ie-20261108','${URL}','products','pending','{"provider":"apify"}', now() - interval '12 days');
  `);
});
afterEach(async () => { await db.close(); });

describe('historical pending-page terminal resolution', () => {
  it('an unresolved pending page blocks the URL (selector and reserve, unchanged)', async () => {
    expect((await selectApifyMappings(sb, 'expansion', 10)).map(m => m.id)).toEqual([]);
  });
  it('resolution records an append-only disposition and leaves the page row byte-identical', async () => {
    const before = await pageRow();
    await resolve();
    expect(await pageRow()).toEqual(before);
    const r = (await db.query<Record<string, unknown>>(`select * from public.tesco_pending_page_resolutions where page_id = $1`, [PAGE])).rows[0];
    expect(r.disposition).toBe('abandoned_unknown_outcome');
    expect(r.page_snapshot).toEqual(before);
    expect(r.resolved_by).toBe('postgres');
    await expect(db.exec(`update public.tesco_pending_page_resolutions set reason = 'x' where page_id = '${PAGE}'`)).rejects.toThrow(/append_only/);
    await expect(db.exec(`delete from public.tesco_pending_page_resolutions where page_id = '${PAGE}'`)).rejects.toThrow(/append_only/);
    await expect(db.exec(`delete from public.tesco_direct_collection_pages where id = '${PAGE}'`)).rejects.toThrow();
  });
  it('after resolution the mapping is selectable again; no price or receipt is written', async () => {
    await resolve();
    expect((await selectApifyMappings(sb, 'expansion', 10)).map(m => m.id)).toEqual([T]);
    expect(await n(`select count(*)::int n from public.price_observations where store_product_id = $1`, [T])).toBe(0);
    expect(await n(`select count(*)::int n from public.scrape_product_receipts where store_product_id = $1`, [T])).toBe(1);
  });
  it('after resolution the reserve RPC no longer raises attempt_already_recorded for that URL', async () => {
    const begin = async () => (await sb.rpc('apify_begin_tesco_run', { p_egress_key: 'apify-tesco-ie-20261108', p_mode: 'expansion', p_target_count: 1, p_owner: 'fargate-test-owner' })).data as { runId: string; leaseToken: string };
    const reserve = async (b: { runId: string; leaseToken: string }) => sb.rpc('apify_reserve_tesco_request', { p_run_id: b.runId, p_egress_key: 'apify-tesco-ie-20261108',
      p_lease_token: b.leaseToken, p_owner: 'fargate-test-owner', p_store_product_id: T, p_store_url: URL, p_mode: 'expansion',
      p_expected_snapshot: (await sb.rpc('apify_mapping_snapshot', { p_store_product_id: T })).data });
    const b1 = await begin();
    expect((await reserve(b1)).error?.message).toContain('attempt_already_recorded');
    await sb.rpc('apify_close_tesco_run', { p_run_id: b1.runId, p_egress_key: 'apify-tesco-ie-20261108', p_lease_token: b1.leaseToken, p_owner: 'fargate-test-owner', p_stop_reason: 'complete' });
    await resolve();
    await db.exec(`update public.tesco_egress_pool set last_success_at = null`);
    const b2 = await begin();
    const r = await reserve(b2);
    expect(r.error).toBeNull();
    // A NEW pending page is recorded for the new attempt; the old page is untouched.
    expect(await n(`select count(*)::int n from public.tesco_direct_collection_pages where requested_url = $1 and outcome = 'pending'`, [URL])).toBe(2);
  });
  it('refuses: not historical, mismatched expectation, not pending, short reason, double resolution', async () => {
    await expect(resolve({ url: 'https://www.tesco.ie/shop/en-IE/products/999999999' })).rejects.toThrow(/expectation_changed/);
    await expect(resolve({ at: '2026-01-01T00:00:00Z' })).rejects.toThrow(/expectation_changed/);
    await expect(resolve({ reason: 'too short' })).rejects.toThrow(/explicit_page_and_reason_required/);
    await db.exec(`update public.tesco_direct_collection_pages set created_at = now() - interval '2 days' where id = '${PAGE}'`);
    await expect(resolve()).rejects.toThrow(/not_historical/);
    await db.exec(`update public.tesco_direct_collection_pages set created_at = now() - interval '12 days' where id = '${PAGE}'`);
    await resolve();
    await expect(resolve()).rejects.toThrow(); // primary key: one disposition per page
    await db.exec(`update public.tesco_direct_collection_pages set outcome = 'ok' where id = '${PAGE}'`);
    await expect(resolve()).rejects.toThrow(/page_not_pending/);
  });
  it('refuses while the page\'s run holds a live gate lease', async () => {
    await db.exec(`update public.tesco_egress_pool set lease_run_id = '${RUN}', leased_until = now() + interval '5 minutes' where egress_key = 'apify-tesco-ie-20261108'`);
    await expect(resolve()).rejects.toThrow(/live_lease/);
  });
  it('is not callable by service_role (postgres SQL bridge only)', async () => {
    await db.exec(`set role service_role`);
    await expect(db.query(`select tesco_internal.resolve_historical_pending_page($1,$2,now(),$3)`, [PAGE, URL, REASON])).rejects.toThrow();
    await expect(db.exec(`insert into public.tesco_pending_page_resolutions(page_id, run_id, requested_url, page_created_at, page_snapshot, disposition, reason, resolved_by)
      values ('${PAGE}','${RUN}','${URL}', now(), '{}'::jsonb, 'abandoned_unknown_outcome', '${REASON}', 'x')`)).rejects.toThrow();
    await db.exec(`reset role`);
  });
});
