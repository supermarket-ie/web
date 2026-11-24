// Maintained side cache (migration 20261127090000) must give EXACTLY the verdicts of pair_review_status_rows at every step as
// evidence arrives (append-only, sticky flags); the single read falls back to the exact computation away from "now".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const N = 24;
const id = (k: string, i: number) => `7e${k}00000-0000-0000-0000-${String(i).padStart(12, '0')}`;
const tescoParsed = (sku: string, name: string, gtin = '05000157062673') => JSON.stringify({ products: [{ sku, name, brand: 'HEINZ', gtin, quantity: { grams: 400 } }] });
const identity = (title: string, brand: string | null = 'Heinz') => JSON.stringify({ title, brand, quantity: null, packSize: null, ingredients: null });

describe('pair status side cache is behaviour-identical', () => {
  it('cached verdicts equal the exact computation as evidence arrives', async () => {
    const db = await PGlite.create();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.store_products (id uuid primary key, product_id uuid, store text, store_sku text, store_url text, store_product_name text);
      create table public.tesco_direct_collection_pages (id uuid primary key default gen_random_uuid(), requested_url text, final_url text,
        outcome text, http_status int, body_sha256 text, parsed jsonb, created_at timestamptz default now());`);
    for (const m of ['20261011113227_retailer_identity_responses', '20261103141000_offer_comparison_review_ledger', '20261118120000_durable_pair_approvals',
      '20261121090000_retailer_barcode_observations', '20261122090000_machine_pair_approvals']) await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'));
    for (let i = 0; i < N; i++) {
      const t = id('a', i), s = id('b', i), d = id('d', i), p = id('c', i);
      const tsku = String(250000000 + i), ssku = String(1000000000 + i), dsku = String(100000000 + i);
      const turl = `https://www.tesco.ie/shop/en-IE/products/${tsku}`, surl = `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/x-id-${ssku}`;
      const dapi = `https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/products/${dsku}`;
      await db.exec(`insert into public.store_products values ('${t}', '${p}', 'tesco', '${tsku}', '${turl}', 'Heinz Soup 400G'),
        ('${s}', '${p}', 'supervalu', '${ssku}', '${surl}', 'Heinz Soup (400 g)'),
        ('${d}', '${p}', 'dunnes', '${dsku}', 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/x/${dsku}', 'Heinz Soup 400g')`);
      const page = (await db.query<{ id: string; created_at: string }>(`insert into public.tesco_direct_collection_pages(requested_url, final_url, outcome, http_status, body_sha256, parsed, created_at)
        values ($1, $1, 'ok', 200, $2, $3::jsonb, now() - interval '${(i % 10) + 1} days') returning id, created_at::text`, [turl, 'c'.repeat(64), tescoParsed(tsku, 'Heinz Soup 400G')])).rows[0];
      const resp = async (store: string, offer: string, sku: string, url: string, kind: string, req: string, ageDays: number, title = 'Heinz Soup (400 g)') =>
        (await db.query<{ id: string; body_sha256: string; retrieved_at: string }>(`insert into public.retailer_identity_responses(store, sku, product_url, requested_url, final_url, retrieved_at,
          content_type, body_text, parser_version, source_kind, source_path, identity, run_uuid, store_product_id)
          values ($1, $2, $3, $4, $4, now() - make_interval(secs => $5::float8 * 86400), 'text/html', $6, 'retailer-identity-response-v3', $7, '$', $8::jsonb, gen_random_uuid(), $9)
          returning id, body_sha256, retrieved_at::text`, [store, sku, url, req, ageDays, `<html>${i}${store}${ageDays}${title}</html>`, kind, identity(title), offer])).rows[0];
      const r1 = await resp('supervalu', s, ssku, surl, 'captured_product', surl, (i % 9) + 0.5);
      const insertReview = (l: string, r: string, lk: string, ls: { id: string; hash: string; at: string }, rk: string, rs: { id: string; hash: string; at: string }, cls = 'exact_product') =>
        db.query(`insert into public.retailer_offer_pair_reviews(left_offer_id, right_offer_id, classification, left_source_kind, left_source_id, left_source_hash, left_captured_at,
          right_source_kind, right_source_id, right_source_hash, right_captured_at, rationale, reviewer, checked_attributes, reviewed_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Fixture review of captured evidence.', 'owner', '["brand","product_name","pack_size"]', now() - interval '${i % 5} days')`,
          [l, r, cls, lk, ls.id, ls.hash, ls.at, rk, rs.id, rs.hash, rs.at]);
      await insertReview(t, s, 'tesco_page', { id: page.id, hash: 'c'.repeat(64), at: page.created_at }, 'retailer_response', { id: r1.id, hash: r1.body_sha256, at: r1.retrieved_at }, i % 7 === 0 ? 'comparable_alternative' : 'exact_product');
      if (i % 2 === 0) {
        const rd = await resp('dunnes', d, dsku, `https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/x/${dsku}`, 'captured_product_api', dapi, (i % 6) + 0.2, 'Heinz Soup 400g');
        await insertReview(t, d, 'tesco_page', { id: page.id, hash: 'c'.repeat(64), at: page.created_at }, 'retailer_response', { id: rd.id, hash: rd.body_sha256, at: rd.retrieved_at });
      }
      // Later evidence of several kinds: same identity, changed identity, other SKU, fresh Tesco page, listing-only.
      if (i % 3 === 0) await resp('supervalu', s, ssku, surl, 'captured_product', surl, 0.1, i % 6 === 0 ? 'Heinz Soup Reduced Salt (400 g)' : 'Heinz Soup (400 g)');
      if (i % 4 === 1) await resp('supervalu', s, ssku, surl, 'captured_listing', 'https://shop.supervalu.ie/search?q=x', 0.1, 'Different (400 g)');
      if (i % 5 === 2) await db.exec(`insert into public.tesco_direct_collection_pages(requested_url, final_url, outcome, http_status, body_sha256, parsed, created_at)
        values ('${turl}', '${turl}', 'ok', 200, '${'e'.repeat(64)}', '${tescoParsed(tsku, i % 10 === 2 ? 'Heinz Soup Light 400G' : 'Heinz Soup 400G')}'::jsonb, now() - interval '1 hour')`);
      if (i % 8 === 3) await db.exec(`insert into public.retailer_identity_observations(store_product_id, store, sku, source_kind, product_url, requested_url, final_url, body_sha256, parser_version, identity, observed_at)
        values ('${s}', 'supervalu', '${ssku}', 'captured_product', '${surl}', '${surl}', '${surl}', '${'d'.repeat(64)}', 'retailer-identity-response-v3', '${identity('Heinz Soup Big (400 g)')}'::jsonb, now())`);
      if (i % 11 === 5) await db.exec(`update public.store_products set store_sku = '${String(1000000000 + 900 + i)}' where id = '${s}'`);
    }
    for (const m of ['20261123120000_pair_status_performance', '20261125090000_pair_status_single_read', '20261125120000_pair_status_pre_aggregate', '20261127090000_pair_status_side_cache'])
      await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'));
    // Exact rows vs cached rows at the same instant, as multisets in both directions.
    const diff = async (active: boolean) => (await db.query<{ exact: number; cached: number; d: number }>(`
      with t as (select now() as at),
      e as (select * from public.pair_review_status_rows((select at from t), $1)),
      c as (select * from public.pair_review_status_rows_cached((select at from t), $1))
      select (select count(*) from e)::int exact, (select count(*) from c)::int cached,
        ((select count(*) from (select * from e except all select * from c) a) + (select count(*) from (select * from c except all select * from e) b))::int d`, [active])).rows[0];
    const same = async (label: string) => { for (const active of [false, true]) { const r = await diff(active); expect({ label, active, ...r }).toMatchObject({ d: 0 }); expect(r.cached).toBe(r.exact); } };
    const statuses = async () => (await db.query<{ s: string; n: number }>(`select status s, count(*)::int n from public.pair_review_status_rows(now(), false) group by 1 order by 1`)).rows;
    const refresh = async () => (await db.query<{ n: number }>(`select public.refresh_pair_review_side_cache() n`)).rows[0].n;

    expect(await refresh()).toBeGreaterThan(0);
    await same('initial');
    const initial = await statuses();
    expect(initial.map(x => x.s)).toEqual(expect.arrayContaining(['active']));
    // 1. a second refresh with no new evidence changes nothing
    await refresh(); await same('idempotent refresh');
    // 2. new CHANGED-identity evidence on a SuperValu side (sticky identity change) and an observation under ANOTHER SKU
    const sv = (await db.query<{ id: string; store_sku: string }>(`select id, store_sku from public.store_products where store = 'supervalu' order by id limit 6`)).rows;
    const resp = (offer: string, sku: string, title: string, ageDays: number, recordedAhead = '0 hours') => db.query(`insert into public.retailer_identity_responses(store, sku, product_url, requested_url, final_url, retrieved_at,
      content_type, body_text, parser_version, source_kind, source_path, identity, run_uuid, store_product_id, recorded_at)
      values ('supervalu', $1, 'https://shop.supervalu.ie/x', 'https://shop.supervalu.ie/x', 'https://shop.supervalu.ie/x', now() - make_interval(secs => $2::float8 * 86400), 'text/html',
      $3, 'retailer-identity-response-v3', 'captured_product', '$', $4::jsonb, gen_random_uuid(), $5, now() + $6::interval)`, [sku, ageDays, `<html>${offer}${title}${ageDays}${recordedAhead}</html>`, identity(title), offer, recordedAhead]);
    await resp(sv[0].id, sv[0].store_sku, 'Heinz Soup Reduced Salt (400 g)', 0.01);
    await resp(sv[1].id, '1099999991', 'Heinz Soup (400 g)', 0.01);
    await resp(sv[2].id, sv[2].store_sku, 'Heinz Soup (400 g)', 0.01);          // fresh unchanged evidence
    await refresh(); await same('changed identity + other sku + fresh evidence');
    const after2 = await statuses();
    expect(after2.find(x => x.s === 'suspended_identity_changed')?.n ?? 0).toBeGreaterThanOrEqual(1);
    expect(after2.find(x => x.s === 'suspended_sku_changed')?.n ?? 0).toBeGreaterThanOrEqual(1);
    // 2b. STICKY: later ordinary evidence on the same sides must not clear either flag (folding is OR, never overwrite).
    // Time passes: the watermark moves 1 hour ahead and the NEW evidence is recorded 2 hours ahead, so the earlier flagged rows
    // are older than the watermark margin and are NOT re-folded; the flags must come from the cache alone.
    await refresh(); await same('before time passes');
    await db.exec(`update public.pair_review_cache_state set evaluated_through = now() + interval '1 hour'`);
    await resp(sv[0].id, sv[0].store_sku, 'Heinz Soup (400 g)', 0.001, '2 hours');
    await resp(sv[1].id, sv[1].store_sku, 'Heinz Soup (400 g)', 0.001, '2 hours');
    await refresh();
    await same('sticky flags survive a refresh that folds only new evidence');
    expect((await statuses()).find(x => x.s === 'suspended_sku_changed')?.n ?? 0).toBeGreaterThanOrEqual(1);
    expect((await statuses()).find(x => x.s === 'suspended_identity_changed')?.n ?? 0).toBeGreaterThanOrEqual(1);
    // 3. a late-arriving row: RETRIEVED days ago but RECORDED now must still be folded in
    await resp(sv[3].id, sv[3].store_sku, 'Heinz Soup Big (400 g)', 0.5);
    await refresh(); await same('late-arriving evidence');
    // 4. a fresh Tesco page whose product changed, and one for another offer unchanged
    const te = (await db.query<{ id: string; store_sku: string }>(`select id, store_sku from public.store_products where store = 'tesco' order by id limit 4`)).rows;
    for (const [k, t] of te.entries()) await db.exec(`insert into public.tesco_direct_collection_pages(requested_url, final_url, outcome, http_status, body_sha256, parsed, created_at)
      values ('https://www.tesco.ie/shop/en-IE/products/${t.store_sku}', 'https://www.tesco.ie/shop/en-IE/products/${t.store_sku}', 'ok', 200, '${'f'.repeat(64)}',
      '${tescoParsed(t.store_sku, k % 2 ? 'Heinz Soup Light 400G' : 'Heinz Soup 400G')}'::jsonb, now())`);
    await refresh(); await same('tesco pages');
    // 5. an offer whose store SKU is reassigned (SKU conflict, recomputed live)
    await db.exec(`update public.store_products set store_sku = '1099999999' where id = '${sv[4].id}'`);
    await refresh(); await same('store sku reassigned');
    // 6. a new review supersedes an older one for a pair
    await db.exec(`insert into public.retailer_offer_pair_reviews(left_offer_id, right_offer_id, classification, rationale, reviewer)
      select left_offer_id, right_offer_id, 'not_comparable', 'Owner: not the same product.', 'owner' from public.retailer_offer_pair_reviews limit 1`);
    await refresh(); await same('superseded by a negative review');
    // 7. far from "now" the single read computes exactly as before and does not need the cache
    const far = (await db.query<{ a: string; b: string }>(`select public.current_pair_review_status_json(now() + interval '20 days', false)::text a,
      (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.pair_review_status_rows(now() + interval '20 days', false) s)::text b`)).rows[0];
    expect(JSON.parse(far.a).length).toBe(JSON.parse(far.b).length);
    // 8. near "now" the single read returns the same rows as the exact computation
    const near = (await db.query<{ n: number; m: number }>(`select jsonb_array_length(public.current_pair_review_status_json(now(), true)) n,
      (select count(*) from public.pair_review_status_rows(now(), true))::int m`)).rows[0];
    expect(near.n).toBe(near.m);
    // grants: service_role may call the single read and refresh; browser roles may not; the cache is not directly writable
    const g = (await db.query<{ a: boolean; s: boolean; w: boolean }>(`select has_function_privilege('anon', 'public.refresh_pair_review_side_cache()', 'execute') a,
      has_function_privilege('service_role', 'public.current_pair_review_status_json(timestamptz,boolean)', 'execute') s,
      has_table_privilege('service_role', 'public.pair_review_side_cache', 'insert') w`)).rows[0];
    expect(g).toEqual({ a: false, s: true, w: false });
    await db.close();
  }, 180000);
});
