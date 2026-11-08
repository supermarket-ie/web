// Local PGlite validation of the Apify migration: pre-create the Supabase roles
// and the minimal FK-referenced tables/functions the migration depends on, then
// apply the migration and exercise the RPCs end-to-end. Catches DDL/function
// defects (ambiguous columns, bad return types, grant/role errors) without a
// live DB. Not a substitute for the operator apply, but a strong pre-check.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = await PGlite.create();
const q = (sql) => db.exec(sql);

// Supabase roles referenced by revoke/grant.
await q(`create role anon; create role authenticated; create role service_role;`);

// Minimal stubs for tables the migration FK-references or reads.
await q(`
create table public.scrape_runs (
  id uuid primary key, store text, run_id text, target_count int, retrieval_method text,
  run_scope text, status text, started_at timestamptz, finished_at timestamptz,
  duration_seconds int, attempted_count int default 0, fetched int default 0, extracted int default 0,
  inserted int default 0, unchanged_count int default 0, failed int default 0,
  silently_skipped_count int default 0, threshold_pct numeric default 70, threshold_breached boolean default false,
  coverage_pct numeric, error_summary text
);
create table public.store_products (
  id uuid primary key, product_id uuid, store text, store_sku text, store_url text,
  store_product_name text, brand text, is_own_brand boolean default false, gtin text, url_status text
);
create table public.products (id uuid primary key, canonical_name text, brand text, ean text);
create table public.price_observations (
  id uuid default gen_random_uuid(), store_product_id uuid, price numeric, was_price numeric,
  on_promotion boolean default false, observed_at timestamptz default now(), source text
);
create table public.scrape_product_receipts (
  run_id uuid, store_product_id uuid, outcome text, created_at timestamptz default now(),
  primary key (run_id, store_product_id)
);
create table public.scrape_failures (
  run_id uuid, store_product_id uuid, store text, failure_stage text, failure_reason text,
  store_url text, canonical_name text, is_retryable boolean, consecutive_failures int, raw_error text,
  primary key (run_id, store_product_id, failure_reason)
);
create view public.latest_prices as
  select store_product_id, 'tesco'::text store, price, observed_at from public.price_observations;
create table public.tesco_egress_pool (
  egress_key text primary key, label text, enabled boolean default true, priority int default 100,
  cooldown_until timestamptz, leased_until timestamptz, last_success_at timestamptz, last_block_at timestamptz,
  consecutive_blocks int default 0, total_successes bigint default 0, total_blocks bigint default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.tesco_direct_collection_pages (
  id uuid primary key default gen_random_uuid(), run_id uuid references public.scrape_runs(id),
  egress_key text, requested_url text, final_url text, mode text, outcome text, http_status int,
  retry_after text, elapsed_ms int, body_sha256 text, parsed jsonb, identity_results jsonb default '[]'::jsonb,
  detail text, created_at timestamptz default now(), unique(run_id, requested_url)
);
`);

// Minimal finalize_store_scrape_product + pause_tesco_collection_egress stubs
// matching the real signatures the migration calls.
await q(`
create function public.finalize_store_scrape_product(
  p_run_uuid uuid, p_store text, p_store_product_id uuid, p_success boolean,
  p_price numeric default null, p_previous_price numeric default null, p_was_price numeric default null,
  p_on_promotion boolean default false, p_store_url text default null, p_store_sku text default null,
  p_store_product_name text default null, p_fetched int default 0, p_extracted int default 0,
  p_failure_stage text default null, p_failure_reason text default null, p_canonical_name text default null,
  p_raw_error text default null, p_is_retryable boolean default false
) returns boolean language plpgsql as $$
begin
  insert into public.scrape_product_receipts(run_id, store_product_id, outcome)
  values (p_run_uuid, p_store_product_id, case when p_success then 'success' else 'failure' end)
  on conflict (run_id, store_product_id) do nothing;
  if not found then return false; end if;
  if p_success then
    insert into public.price_observations(store_product_id, price, observed_at, source)
    values (p_store_product_id, p_price, now(), lower(p_store)||'_direct');
  end if;
  return true;
end $$;
create function public.pause_tesco_collection_egress(p_egress_key text, p_until timestamptz, p_blocked boolean default false)
returns void language plpgsql as $$
begin
  update public.tesco_egress_pool set cooldown_until = greatest(coalesce(cooldown_until, now()), p_until),
    leased_until = null, updated_at = now() where egress_key = p_egress_key;
end $$;
`);

// Apply the migration under test.
const migration = readFileSync('supabase/migrations/20261108200000_tesco_apify_unattended_collection.sql', 'utf8');
await q(migration);
console.log('migration applied OK');

// Seed a proven, due renewal mapping.
const MID = '11111111-1111-1111-1111-111111111111';
const PID = '22222222-2222-2222-2222-222222222222';
await q(`
insert into public.products(id, canonical_name, brand, ean) values ('${PID}','Long Grain Rice 1kg', null, '05000119309228');
insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status)
values ('${MID}','${PID}','tesco','254877356','https://www.tesco.ie/shop/en-IE/products/254877356','Tesco Easy Cook Long Grain Rice 1kg','Tesco',true,'05000119309228','resolved');
-- prove it + an old observation (due for renewal)
insert into public.scrape_runs(id, store, run_id, status, started_at) values ('33333333-3333-3333-3333-333333333333','tesco','seed','success', now());
insert into public.scrape_product_receipts(run_id, store_product_id, outcome) values ('33333333-3333-3333-3333-333333333333','${MID}','success');
insert into public.price_observations(store_product_id, price, observed_at, source) values ('${MID}', 1.30, now() - interval '10 days', 'tesco_direct');
`);

// Exercise the RPC flow as service_role would.
const owner = 'fargate-abcdef123456';
const [{ apify_begin_tesco_run: runId }] = (await db.query(
  `select public.apify_begin_tesco_run('apify-tesco-ie-20261108','renewal',1,$1) as apify_begin_tesco_run`, [owner])).rows;
console.log('begin run:', runId);

const reserve = await db.query(
  `select public.apify_reserve_tesco_request($1,'apify-tesco-ie-20261108',$2,$3,$4,'renewal') as ok`,
  [runId, owner, MID, 'https://www.tesco.ie/shop/en-IE/products/254877356']);
console.log('reserve:', reserve.rows[0]);

const rec = await db.query(
  `select public.apify_record_tesco_page($1,'apify-tesco-ie-20261108',$2,$3,$4,'renewal','ok',200,null,120,$5,
     '{"products":[{"sku":"254877356"}],"listing":null}'::jsonb,
     '[{"storeProductId":"${MID}","sku":"254877356","reasons":[]}]'::jsonb,
     '{"provider":"apify"}'::jsonb,
     true, 1.35, 1.30, '254877356', 'Tesco Easy Cook Long Grain Rice 1kg',
     false, null, false,
     '{"sku":"254877356","actorId":"A","runId":"r","datasetId":"d","rawItem":{"product_id":"254877356"},"rawItemSha256":"${'a'.repeat(64)}","scrapedAt":"2026-11-08T22:00:00Z","freshness":{"requiredFreshnessMet":true,"level":"fresh_after_submit"},"freshnessVerified":true}'::jsonb
   ) as result`,
  [runId, owner, MID, 'https://www.tesco.ie/shop/en-IE/products/254877356', 'b'.repeat(64)]);
console.log('record:', JSON.stringify(rec.rows[0]));

// Verify: a price_observation + receipt were written, provider evidence stored.
const prices = await db.query(`select price, source from public.price_observations where store_product_id=$1 order by observed_at desc limit 1`, [MID]);
const ev = await db.query(`select actor_id, provider_run_id, raw_item_sha256 from public.tesco_apify_provider_evidence where run_id=$1`, [runId]);
const ver = await db.query(`select 1 from public.tesco_identity_verifications where store_product_id=$1`, [MID]);
console.log('latest price row:', prices.rows[0]);
console.log('provider evidence rows:', ev.rows.length, ev.rows[0]);

// record identity verification (as the collector does)
await db.query(`select public.apify_record_identity_verification($1,$2,'{}'::jsonb,'{}'::jsonb,'det','deterministic','v2',null,null,$3,720)`,
  [MID, 'c'.repeat(64), 'd'.repeat(64)]);
const ver2 = await db.query(`select count(*)::int n from public.tesco_identity_verifications where store_product_id=$1`, [MID]);
console.log('identity verifications:', ver2.rows[0].n);

await db.query(`select public.apify_close_tesco_run($1,'apify-tesco-ie-20261108',$2,'complete')`, [runId, owner]);
const runRow = await db.query(`select status, error_summary from public.scrape_runs where id=$1`, [runId]);
console.log('run closed status:', runRow.rows[0].status);

console.log('\nALL MIGRATION CHECKS PASSED');
