// current_pair_review_status hotfix (20261123120000) must return EXACTLY what 20261122090000 returned, for a varied
// fixture of approvals and later evidence, at several evaluation times.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const N = 24;
const id = (k: string, i: number) => `7e${k}00000-0000-0000-0000-${String(i).padStart(12, '0')}`;
const tescoParsed = (sku: string, name: string, gtin = '05000157062673') => JSON.stringify({ products: [{ sku, name, brand: 'HEINZ', gtin, quantity: { grams: 400 } }] });
const identity = (title: string, brand: string | null = 'Heinz') => JSON.stringify({ title, brand, quantity: null, packSize: null, ingredients: null });

describe('current_pair_review_status hotfix is behaviour-identical', () => {
  it('matches the previous definition on a varied fixture', async () => {
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
    const snapshot = async () => {
      const out: unknown[] = [];
      for (const days of [0, 3, 9, 15, 400]) for (const active of [false, true])
        out.push((await db.query(`select * from public.current_pair_review_status(now() + make_interval(secs => $1::float8 * 86400), $2)`, [days, active])).rows);
      return JSON.stringify(out);
    };
    const before = await snapshot();
    expect(before).toContain('suspended_identity_changed');
    expect(before).toContain('"status":"active"');
    for (const s of ['suspended_sku_changed', 'suspended_no_recent_evidence', 'expired_needs_review']) expect(before).toContain(s);
    await db.exec(readFileSync('supabase/migrations/20261123120000_pair_status_performance.sql', 'utf8'));
    expect(await snapshot()).toBe(before);
    // 20261125090000: narrow latest-review sort (identical rows) + the single-read jsonb wrapper (identical rows).
    await db.exec(readFileSync('supabase/migrations/20261125090000_pair_status_single_read.sql', 'utf8'));
    expect(await snapshot()).toBe(before);
    // 20261125120000: side verdicts pre-aggregated per pair, unordered core + ordered wrapper (identical rows and order).
    await db.exec(readFileSync('supabase/migrations/20261125120000_pair_status_pre_aggregate.sql', 'utf8'));
    expect(await snapshot()).toBe(before);
    for (const days of [0, 3, 9, 15, 400]) for (const active of [false, true]) {
      // Decode the jsonb rows back to the function's column types and compare as multisets, both directions.
      const r = (await db.query<{ total: number; json_n: number; diff: number }>(`
        with t as (select now() + make_interval(secs => $1::float8 * 86400) as at),
        s as (select * from public.current_pair_review_status((select at from t), $2)),
        j as (select x.* from jsonb_to_recordset(public.current_pair_review_status_json((select at from t), $2)) as x(
          left_offer_id uuid, right_offer_id uuid, classification text, left_source_hash text, right_source_hash text,
          left_evidence_at timestamptz, right_evidence_at timestamptz, reviewed_at timestamptz, rationale text, reviewer text, status text))
        select (select count(*) from s)::int total, (select count(*) from j)::int json_n,
          ((select count(*) from (select * from s except all select * from j) a) + (select count(*) from (select * from j except all select * from s) b))::int diff`, [days, active])).rows[0];
      expect(r.json_n).toBe(r.total);
      expect(r.diff).toBe(0);
    }
    const grants = (await db.query<{ a: boolean; u: boolean; s: boolean }>(`select has_function_privilege('anon', 'public.current_pair_review_status_json(timestamptz,boolean)', 'execute') a,
      has_function_privilege('authenticated', 'public.current_pair_review_status_json(timestamptz,boolean)', 'execute') u,
      has_function_privilege('service_role', 'public.current_pair_review_status_json(timestamptz,boolean)', 'execute') s`)).rows[0];
    expect(grants).toEqual({ a: false, u: false, s: true });
    await db.close();
  }, 60000);
});
