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

// Apply BOTH migrations in order (base objects, then the security correction).
await q(readFileSync('supabase/migrations/20261108200000_tesco_apify_unattended_collection.sql', 'utf8'));
await q(readFileSync('supabase/migrations/20261109090000_tesco_apify_lease_fencing_and_page_binding.sql', 'utf8'));
console.log('migrations applied OK');

// Mapping A: proven, due renewal.
const MID = '11111111-1111-1111-1111-111111111111';
const PID = '22222222-2222-2222-2222-222222222222';
const URL_A = 'https://www.tesco.ie/shop/en-IE/products/254877356';
// Mapping B: a DIFFERENT proven, due renewal with a DIFFERENT url/sku.
const MID_B = '44444444-4444-4444-4444-444444444444';
const PID_B = '55555555-5555-5555-5555-555555555555';
const URL_B = 'https://www.tesco.ie/shop/en-IE/products/260300754';
await q(`
insert into public.products(id, canonical_name, brand, ean) values
  ('${PID}','Long Grain Rice 1kg', null, '05000119309228'),
  ('${PID_B}','Free Range Eggs 12', null, '05000436926832');
insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status)
values
  ('${MID}','${PID}','tesco','254877356','${URL_A}','Tesco Easy Cook Long Grain Rice 1kg','Tesco',true,'05000119309228','resolved'),
  ('${MID_B}','${PID_B}','tesco','260300754','${URL_B}','Tesco Free Range Eggs 12','Tesco',true,'05000436926832','resolved');
insert into public.scrape_runs(id, store, run_id, status, started_at) values ('33333333-3333-3333-3333-333333333333','tesco','seed','success', now());
insert into public.scrape_product_receipts(run_id, store_product_id, outcome) values
  ('33333333-3333-3333-3333-333333333333','${MID}','success'),
  ('33333333-3333-3333-3333-333333333333','${MID_B}','success');
insert into public.price_observations(store_product_id, price, observed_at, source) values
  ('${MID}', 1.30, now() - interval '10 days', 'tesco_direct'),
  ('${MID_B}', 4.00, now() - interval '10 days', 'tesco_direct');
`);

// --- Assertions (replace printed-success checks) ---
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.error('FAIL:', msg); } else { console.log('ok:', msg); } }
async function expectThrows(fn, matcher, msg) {
  try { await fn(); failures++; console.error('FAIL (expected throw):', msg); }
  catch (e) { const ok = !matcher || String(e.message || e).includes(matcher); if (!ok) { failures++; console.error('FAIL (wrong error):', msg, '->', e.message); } else console.log('ok threw:', msg); }
}

const GATE = 'apify-tesco-ie-20261108';
async function begin(owner) {
  const r = (await db.query(`select public.apify_begin_tesco_run($1,'renewal',10,$2) as b`, [GATE, owner])).rows[0].b;
  return { runId: r.runId, token: r.leaseToken };
}
async function reserve(a, mid, url, owner = a.owner) {
  return db.query(`select public.apify_reserve_tesco_request($1,$2,$3,$4,$5,$6,'renewal')`, [a.runId, GATE, a.token, owner, mid, url]);
}
async function record(a, mid, url, owner = a.owner) {
  return db.query(`select public.apify_record_tesco_page($1,$2,$3,$4,$5,$6,'renewal','ok',200,null,120,$7,
    '{"products":[{"sku":"x"}],"listing":null}'::jsonb, '[]'::jsonb,
    '{"provider":"apify"}'::jsonb, false, null, false,
    '{"sku":"x","actorId":"A","runId":"r","datasetId":"d","rawItem":{},"rawItemSha256":"${'a'.repeat(64)}"}'::jsonb)`,
    [a.runId, GATE, a.token, owner, mid, url, 'b'.repeat(64)]);
}
async function finalise(a, mid, price, owner = a.owner) {
  return db.query(`select public.apify_finalise_tesco_page($1,$2,$3,$4,$5,'renewal',$6,1.30,'x') as r`, [a.runId, GATE, a.token, owner, mid, price]);
}
const priceCount = async (mid) => (await db.query(`select count(*)::int n from public.price_observations where store_product_id=$1 and observed_at > now()-interval '1 hour'`, [mid])).rows[0].n;

// ---- Happy path: begin → reserve → record → finalise → close ----
const A = { ...(await begin('fargate-owner-aaaaaaaa')), owner: 'fargate-owner-aaaaaaaa' };
await expectThrows(() => db.query(`select public.apify_begin_tesco_run('other-gate','renewal',1,'o')`), 'apify_gate_only', 'begin refuses non-Apify gate');
assert((await reserve(A, MID, URL_A)).rows[0].apify_reserve_tesco_request === true, 'reserve succeeds for a due, proven mapping');
await expectThrows(() => reserve(A, MID, URL_A), 'attempt_already_recorded', 'reserve excludes a pending/recent URL');
// URL/mapping mismatch is refused at reservation.
await expectThrows(() => reserve(A, MID, URL_B), 'mapping_not_resolved_or_unproven', 'reserve refuses a URL that is not the mapping own url');
await record(A, MID, URL_A);
assert(await priceCount(MID) === 0, 'record writes NO price (evidence only)');
await expectThrows(() => finalise(A, MID, 0), 'positive_regular_price_required', 'finalise refuses non-positive price');
assert((await finalise(A, MID, 1.35)).rows[0].r.finalised === true, 'finalise writes the price for the token holder');
assert(Number((await db.query(`select price from public.price_observations where store_product_id=$1 order by observed_at desc limit 1`, [MID])).rows[0].price) === 1.35, 'latest price is the finalised regular price');
// Receipt idempotency.
const b4 = await priceCount(MID);
assert((await finalise(A, MID, 1.35)).rows[0].r.finalised === false && await priceCount(MID) === b4, 'receipt idempotency blocks a second finalise');
await db.query(`select public.apify_close_tesco_run($1,$2,$3,$4,'complete')`, [A.runId, GATE, A.token, A.owner]);
assert((await db.query(`select leased_until, lease_token from public.tesco_egress_pool where egress_key=$1`, [GATE])).rows[0].leased_until === null, 'lease + token released on close');

// ============================================================
// REGRESSION — the reproduced cross-worker attack (must NOT write/clear).
// 1. Worker A begins + records an OK page for mapping A.
// 2. A's lease expires; worker B begins a successor run (new token).
// 3. A calls finalise with ITS run/token but a DIFFERENT mapping B.
// 4. A closes its run.
// Expected: step 3 raises (stale token), writes nothing for B; step 4 does
// NOT clear B's lease.
// ============================================================
// Clear pacing so these binding/fencing regressions are not masked by the 10s
// pacing guard (pacing is covered by its own behaviour, not under test here).
const clearPacing = () => db.query(`update public.tesco_egress_pool set last_success_at = now() - interval '1 hour' where egress_key=$1`, [GATE]);

// Worker A records its OWN mapping (MID_B, still due). The attack target is the
// DIFFERENT mapping MID (which A never reserved/recorded in its run).
await clearPacing();
const WA = { ...(await begin('fargate-worker-a-xxxx')), owner: 'fargate-worker-a-xxxx' };
await reserve(WA, MID_B, URL_B);
await record(WA, MID_B, URL_B);
// Simulate A's lease expiring so B can claim.
await db.query(`update public.tesco_egress_pool set leased_until = now() - interval '1 minute' where egress_key=$1`, [GATE]);
const WB = { ...(await begin('fargate-worker-b-yyyy')), owner: 'fargate-worker-b-yyyy' };
assert(WB.token !== WA.token, 'successor run minted a NEW fencing token');

// A tries to finalise a DIFFERENT mapping (MID) using its OWN (now stale) token.
const attackBefore = await priceCount(MID);
await expectThrows(() => finalise(WA, MID, 9.99), 'lease_lost_or_superseded', 'superseded worker A CANNOT finalise (stale token)');
assert(await priceCount(MID) === attackBefore, 'no price written for the attacked mapping by the superseded worker');

// A also cannot finalise mapping B even if it passed a plausible URL earlier:
// it never reserved/recorded B in its run, so there is no ok page bound to B.
// (Covered above by the token failure; also assert B's lease survives A's close.)
const bTokenBefore = (await db.query(`select lease_token from public.tesco_egress_pool where egress_key=$1`, [GATE])).rows[0].lease_token;
await db.query(`select public.apify_close_tesco_run($1,$2,$3,$4,'complete')`, [WA.runId, GATE, WA.token, WA.owner]);
const bTokenAfter = (await db.query(`select lease_token, leased_until from public.tesco_egress_pool where egress_key=$1`, [GATE])).rows[0];
assert(bTokenAfter.lease_token === bTokenBefore && bTokenAfter.lease_token === WB.token, 'worker A close did NOT clear worker B lease/token');
assert(bTokenAfter.leased_until !== null, 'worker B lease still live after A close');
// Clean up B's run.
await db.query(`select public.apify_close_tesco_run($1,$2,$3,$4,'complete')`, [WB.runId, GATE, WB.token, WB.owner]);

// ============================================================
// REGRESSION — mapping changed between reservation and finalise.
// Reserve+record mapping A, then change the stored mapping (e.g. sku/url),
// then finalise must refuse (snapshot mismatch) and write nothing.
// ============================================================
// Reset the gate for a fresh run and make MID due again (its price is from A's
// write above, which is recent → not due). Use expansion semantics on MID_B
// after removing its observation would be complex; instead test on a fresh
// mapping C.
const MID_C = '66666666-6666-6666-6666-666666666666';
const PID_C = '77777777-7777-7777-7777-777777777777';
const URL_C = 'https://www.tesco.ie/shop/en-IE/products/297844134';
await q(`
insert into public.products(id, canonical_name, brand, ean) values ('${PID_C}','Spaghetti 500g', null, '05057373964694');
insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status)
values ('${MID_C}','${PID_C}','tesco','297844134','${URL_C}','Tesco Spaghetti 500g','Tesco',true,'05057373964694','resolved');
insert into public.scrape_product_receipts(run_id, store_product_id, outcome) values ('33333333-3333-3333-3333-333333333333','${MID_C}','success');
insert into public.price_observations(store_product_id, price, observed_at, source) values ('${MID_C}', 0.59, now() - interval '10 days', 'tesco_direct');
`);
await clearPacing();
const WC = { ...(await begin('fargate-worker-c-zzzz')), owner: 'fargate-worker-c-zzzz' };
await reserve(WC, MID_C, URL_C);
await record(WC, MID_C, URL_C);
// Mapping changes under us (brand correction, say).
await q(`update public.store_products set brand='CHANGED' where id='${MID_C}';`);
const cBefore = await priceCount(MID_C);
await expectThrows(() => finalise(WC, MID_C, 0.59), 'mapping_snapshot_changed', 'finalise refuses when the mapping snapshot changed since reservation');
assert(await priceCount(MID_C) === cBefore, 'no price written when the mapping changed mid-collection');
await db.query(`select public.apify_close_tesco_run($1,$2,$3,$4,'degraded')`, [WC.runId, GATE, WC.token, WC.owner]);

// Identity verification record + reuse invalidation on fingerprint change.
await db.query(`select public.apify_record_identity_verification($1,$2,'{}'::jsonb,'{}'::jsonb,'det rationale long enough here','deterministic',$3,null,null,$4,720)`, [MID, 'c'.repeat(64), 'v2', 'd'.repeat(64)]);
await db.query(`select public.apify_record_identity_verification($1,$2,'{}'::jsonb,'{}'::jsonb,'changed identity rationale here','deterministic_plus_ai',$3,'m',null,$4,720)`, [MID, 'e'.repeat(64), 'v2', 'f'.repeat(64)]);
const activeV = (await db.query(`select identity_fingerprint from public.tesco_identity_verifications where store_product_id=$1 and invalidated_at is null`, [MID])).rows;
assert(activeV.length === 1 && activeV[0].identity_fingerprint === 'e'.repeat(64), 'a new fingerprint invalidates the prior active verification');

console.log(`\n${failures === 0 ? 'ALL MIGRATION ASSERTIONS PASSED' : failures + ' MIGRATION ASSERTION(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
