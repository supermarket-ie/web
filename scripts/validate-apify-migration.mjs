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

// --- Assertions (replace printed-success checks) ---
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('FAIL:', msg); } else { console.log('ok:', msg); } }
async function expectThrows(fn, matcher, msg) {
  try { await fn(); failures++; console.error('FAIL (expected throw):', msg); }
  catch (e) { const ok = !matcher || String(e.message || e).includes(matcher); if (!ok) { failures++; console.error('FAIL (wrong error):', msg, '->', e.message); } else console.log('ok threw:', msg); }
}

const URL = 'https://www.tesco.ie/shop/en-IE/products/254877356';
const owner = 'fargate-abcdef123456';
const [{ apify_begin_tesco_run: runId }] = (await db.query(
  `select public.apify_begin_tesco_run('apify-tesco-ie-20261108','renewal',1,$1) as apify_begin_tesco_run`, [owner])).rows;

// NEGATIVE: wrong gate key is refused everywhere.
await expectThrows(() => db.query(`select public.apify_begin_tesco_run('other-gate','renewal',1,$1)`, [owner]), 'apify_gate_only', 'begin refuses non-Apify gate');

// Reserve (atomic guards).
const reserve = await db.query(
  `select public.apify_reserve_tesco_request($1,'apify-tesco-ie-20261108',$2,$3,$4,'renewal') as ok`, [runId, owner, MID, URL]);
assert(reserve.rows[0].ok === true, 'reserve succeeds for a due, proven mapping');

// NEGATIVE: a second reserve for the same URL is excluded (pending row exists).
await expectThrows(() => db.query(`select public.apify_reserve_tesco_request($1,'apify-tesco-ie-20261108',$2,$3,$4,'renewal')`, [runId, owner, MID, URL]), 'attempt_already_recorded', 'reserve excludes a pending/recent URL');

// NEGATIVE: reserve under a WRONG owner is refused (lease/ownership).
await expectThrows(() => db.query(`select public.apify_reserve_tesco_request($1,'apify-tesco-ie-20261108','fargate-imposter99',$2,'https://www.tesco.ie/shop/en-IE/products/999999',''||'renewal')`, [runId, MID]), 'ownership_or_gate_lost', 'reserve refuses a non-owner');

// Record the page (staged; p_accept=false in the new flow).
const rec = await db.query(
  `select public.apify_record_tesco_page($1,'apify-tesco-ie-20261108',$2,$3,$4,'renewal','ok',200,null,120,$5,
     '{"products":[{"sku":"254877356"}],"listing":null}'::jsonb,
     '[{"storeProductId":"${MID}","sku":"254877356","reasons":[]}]'::jsonb,
     '{"provider":"apify"}'::jsonb,
     false, null, 1.30, '254877356', 'Tesco Easy Cook Long Grain Rice 1kg',
     false, null, false,
     '{"sku":"254877356","actorId":"A","runId":"r","datasetId":"d","rawItem":{"product_id":"254877356"},"rawItemSha256":"${'a'.repeat(64)}","scrapedAt":"2026-11-08T22:00:00Z","freshness":{"perItemPreconditionMet":true,"level":"after_submit_precondition_met"},"freshnessVerified":false}'::jsonb
   ) as result`,
  [runId, owner, MID, URL, 'b'.repeat(64)]);
assert(rec.rows[0].result.finalised === false, 'record stages without finalising (p_accept=false)');
const evRows = (await db.query(`select actor_id, raw_item_sha256 from public.tesco_apify_provider_evidence where run_id=$1`, [runId])).rows;
assert(evRows.length === 1 && evRows[0].raw_item_sha256 === 'a'.repeat(64), 'provider evidence recorded with raw-item hash');
assert((await db.query(`select count(*)::int n from public.price_observations where store_product_id=$1 and observed_at > now()-interval '1 hour'`, [MID])).rows[0].n === 0, 'no price written at record time');

// NEGATIVE: finalise requires a positive price.
await expectThrows(() => db.query(`select public.apify_finalise_tesco_page($1,'apify-tesco-ie-20261108',$2,$3,$4,'renewal',0,1.30,'254877356','x')`, [runId, owner, MID, URL]), 'positive_regular_price_required', 'finalise refuses non-positive price');

// NEGATIVE: finalise under a WRONG owner / expired lease writes nothing.
await expectThrows(() => db.query(`select public.apify_finalise_tesco_page($1,'apify-tesco-ie-20261108','fargate-imposter99',$2,$3,'renewal',1.35,1.30,'254877356','x')`, [runId, MID, URL]), 'ownership_or_lease_lost', 'finalise refuses a non-owner (lease fencing)');

// POSITIVE: finalise by the real owner writes the price + receipt.
const fin = await db.query(`select public.apify_finalise_tesco_page($1,'apify-tesco-ie-20261108',$2,$3,$4,'renewal',1.35,1.30,'254877356','Tesco Easy Cook Long Grain Rice 1kg') as result`, [runId, owner, MID, URL]);
assert(fin.rows[0].result.finalised === true, 'finalise writes the price for the owner');
const price = (await db.query(`select price from public.price_observations where store_product_id=$1 order by observed_at desc limit 1`, [MID])).rows[0];
assert(Number(price.price) === 1.35, 'latest price_observation is the finalised regular price');
assert((await db.query(`select count(*)::int n from public.scrape_product_receipts where run_id=$1 and store_product_id=$2 and outcome='success'`, [runId, MID])).rows[0].n === 1, 'a success receipt exists');

// NEGATIVE: receipt idempotency — a second finalise for the same run+product does not double-write.
const before = (await db.query(`select count(*)::int n from public.price_observations where store_product_id=$1`, [MID])).rows[0].n;
const fin2 = await db.query(`select public.apify_finalise_tesco_page($1,'apify-tesco-ie-20261108',$2,$3,$4,'renewal',1.35,1.30,'254877356','x') as result`, [runId, owner, MID, URL]);
const after = (await db.query(`select count(*)::int n from public.price_observations where store_product_id=$1`, [MID])).rows[0].n;
assert(fin2.rows[0].result.finalised === false && after === before, 'receipt idempotency blocks a second finalise');

// Identity verification record + reuse invalidation on fingerprint change.
await db.query(`select public.apify_record_identity_verification($1,$2,'{}'::jsonb,'{}'::jsonb,'det rationale long enough','deterministic',$3,null,null,$4,720)`, [MID, 'c'.repeat(64), 'v2', 'd'.repeat(64)]);
await db.query(`select public.apify_record_identity_verification($1,$2,'{}'::jsonb,'{}'::jsonb,'changed identity rationale','deterministic_plus_ai',$3,'m',null,$4,720)`, [MID, 'e'.repeat(64), 'v2', 'f'.repeat(64)]);
const active = (await db.query(`select identity_fingerprint from public.tesco_identity_verifications where store_product_id=$1 and invalidated_at is null`, [MID])).rows;
assert(active.length === 1 && active[0].identity_fingerprint === 'e'.repeat(64), 'a new fingerprint invalidates the prior active verification (one active)');

// Close run + lease released.
await db.query(`select public.apify_close_tesco_run($1,'apify-tesco-ie-20261108',$2,'complete')`, [runId, owner]);
const runRow = (await db.query(`select status from public.scrape_runs where id=$1`, [runId])).rows[0];
assert(runRow.status === 'success', 'run closes success');
assert((await db.query(`select leased_until from public.tesco_egress_pool where egress_key='apify-tesco-ie-20261108'`)).rows[0].leased_until === null, 'lease released on close');

console.log(`\n${failures === 0 ? 'ALL MIGRATION ASSERTIONS PASSED' : failures + ' MIGRATION ASSERTION(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
