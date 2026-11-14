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

// Base tables (store_products/products/price_observations/scrape_runs/
// receipts/failures/latest_prices) PREDATE the migration history — there is no
// CREATE TABLE for them in supabase/migrations. Their shapes here are taken
// from the repo's AUTHORITATIVE in-repo fixtures (src/lib/*.test.ts) extended
// with the exact columns the REAL finaliser writes (was_price, on_promotion,
// source, the scrape_runs counters). This is a documented limitation: these
// specific tables cannot be loaded from a migration file; everything the
// migration itself defines (the apify_* RPCs, gate, evidence/verification/
// budget tables) IS the real migration SQL, and the finaliser + pause function
// are loaded verbatim from their migrations below.
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
-- Production-semantics price view: the real latest_prices only surfaces
-- observations within a 7-day window AND exposes exactly ONE (the LATEST) offer
-- per mapping — matching production. Seeds below are 5 days old: due for
-- renewal (>4 days) AND still visible in the window (<7 days).
create view public.latest_prices as
  select distinct on (store_product_id)
    store_product_id, 'tesco'::text store, price, observed_at
  from public.price_observations
  where observed_at > now() - interval '7 days'
  order by store_product_id, observed_at desc;
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

// Load the REAL finalize_store_scrape_product (NOT a stub) by extracting its
// exact definition from migration 20260822100000, and the REAL
// pause_tesco_collection_egress from 20260929093608. The price-write path is
// therefore exercised against the actual production finaliser.
function extractFunction(migrationPath, funcName) {
  const sql = readFileSync(migrationPath, 'utf8');
  const start = sql.indexOf(`create or replace function public.${funcName}(`);
  if (start < 0) throw new Error(`could not find ${funcName} in ${migrationPath}`);
  // The function body is dollar-quoted ($$ ... $$;). Find the closing $$; after start.
  const end = sql.indexOf('$$;', start);
  if (end < 0) throw new Error(`could not find end of ${funcName}`);
  return sql.slice(start, end + 3);
}
const REAL_FINALISER = extractFunction('supabase/migrations/20260822100000_add_price_observation_source.sql', 'finalize_store_scrape_product');
const REAL_PAUSE = extractFunction('supabase/migrations/20260929093608_tesco_direct_collection_evidence.sql', 'pause_tesco_collection_egress');
await q(REAL_FINALISER);
await q(REAL_PAUSE);
console.log('loaded REAL finalize_store_scrape_product + pause_tesco_collection_egress from their migrations');

// Apply BOTH migrations in order (base objects, then the security correction).
await q(readFileSync('supabase/migrations/20261108200000_tesco_apify_unattended_collection.sql', 'utf8'));
await q(readFileSync('supabase/migrations/20261109090000_tesco_apify_lease_fencing_and_page_binding.sql', 'utf8'));
await q(readFileSync('supabase/migrations/20261109140000_tesco_apify_snapshot_binding.sql', 'utf8'));
await q(readFileSync('supabase/migrations/20261113090000_tesco_apify_first_price_expansion.sql', 'utf8'));
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
  ('${MID}', 1.30, now() - interval '5 days', 'tesco_direct'),
  ('${MID_B}', 4.00, now() - interval '5 days', 'tesco_direct');
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
const snapshotOf = async (mid) => (await db.query(`select public.apify_mapping_snapshot($1) as s`, [mid])).rows[0].s;
// reserve with an explicit expected snapshot (defaults to the CURRENT snapshot).
async function reserve(a, mid, url, owner = a.owner, expected) {
  const exp = expected === undefined ? await snapshotOf(mid) : expected;
  return db.query(`select public.apify_reserve_tesco_request($1,$2,$3,$4,$5,$6,'renewal',$7::jsonb) as r`,
    [a.runId, GATE, a.token, owner, mid, url, JSON.stringify(exp)]);
}
async function record(a, mid, url, owner = a.owner) {
  return db.query(`select public.apify_record_tesco_page($1,$2,$3,$4,$5,$6,'renewal','ok',200,null,120,$7,
    '{"products":[{"sku":"x"}],"listing":null}'::jsonb, '[]'::jsonb,
    '{"provider":"apify"}'::jsonb, false, null, false,
    '{"sku":"x","actorId":"A","runId":"r","datasetId":"d","rawItem":{},"rawItemSha256":"${'a'.repeat(64)}"}'::jsonb)`,
    [a.runId, GATE, a.token, owner, mid, url, 'b'.repeat(64)]);
}
// finalise binds the assessed snapshot (defaults to the CURRENT snapshot).
async function finalise(a, mid, price, owner = a.owner, assessed) {
  const asn = assessed === undefined ? await snapshotOf(mid) : assessed;
  return db.query(`select public.apify_finalise_tesco_page($1,$2,$3,$4,$5,'renewal',$6,1.30,'x',$7::jsonb) as r`,
    [a.runId, GATE, a.token, owner, mid, price, JSON.stringify(asn)]);
}
const priceCount = async (mid) => (await db.query(`select count(*)::int n from public.price_observations where store_product_id=$1 and observed_at > now()-interval '1 hour'`, [mid])).rows[0].n;

// ---- Happy path: begin → reserve → record → finalise → close ----
const A = { ...(await begin('fargate-owner-aaaaaaaa')), owner: 'fargate-owner-aaaaaaaa' };
await expectThrows(() => db.query(`select public.apify_begin_tesco_run('other-gate','renewal',1,'o')`), 'apify_gate_only', 'begin refuses non-Apify gate');
assert((await reserve(A, MID, URL_A)).rows[0].r.reserved === true, 'reserve succeeds for a due, proven mapping');
await expectThrows(() => reserve(A, MID, URL_A), 'attempt_already_recorded', 'reserve excludes a pending/recent URL');
// URL/mapping mismatch is refused at reservation.
await expectThrows(() => reserve(A, MID, URL_B), 'mapping_not_resolved_or_unproven', 'reserve refuses a URL that is not the mapping own url');
await record(A, MID, URL_A);
assert(await priceCount(MID) === 0, 'record writes NO price (evidence only)');
await expectThrows(() => finalise(A, MID, 0), 'positive_regular_price_required', 'finalise refuses non-positive price');
assert((await finalise(A, MID, 1.35)).rows[0].r.finalised === true, 'finalise writes the price for the token holder');
assert(Number((await db.query(`select price from public.price_observations where store_product_id=$1 order by observed_at desc limit 1`, [MID])).rows[0].price) === 1.35, 'latest price is the finalised regular price');

// DUPLICATE FINALISE behaviour with a production latest-only price view.
// After the first write the mapping's LATEST observation is now(), so it is no
// longer due; the second finalise is BLOCKED (observation_changed fires before
// the finaliser, OR receipt idempotency returns finalised=false). Either way,
// the intended invariant is: NO second observation is written.
const obsBefore = (await db.query(`select count(*)::int n from public.price_observations where store_product_id=$1`, [MID])).rows[0].n;
let dupBlocked = false; let dupFinalised = null;
try { dupFinalised = (await finalise(A, MID, 1.35)).rows[0].r.finalised; }
catch (e) { dupBlocked = String(e.message || e).includes('observation_changed'); }
const obsAfter = (await db.query(`select count(*)::int n from public.price_observations where store_product_id=$1`, [MID])).rows[0].n;
assert((dupBlocked || dupFinalised === false), 'duplicate finalise is BLOCKED (observation_changed or receipt idempotency)');
assert(obsAfter === obsBefore, 'duplicate finalise writes NO second observation');
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
insert into public.price_observations(store_product_id, price, observed_at, source) values ('${MID_C}', 0.59, now() - interval '5 days', 'tesco_direct');
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

// ============================================================
// REGRESSION — the EXACT reported mapping reproduction: the canonical product
// changes (rice→eggs) BEFORE reservation. The collector reserves with the OLD
// (rice) expected snapshot; reservation must REJECT (expected_snapshot_changed)
// so collection never proceeds on stale evidence, and no price is written.
// ============================================================
const MID_D = '88888888-8888-8888-8888-888888888888';
const PID_RICE = '99999999-9999-9999-9999-999999999999';
const PID_EGGS = 'aaaaaaaa-0000-0000-0000-000000000000';
const URL_D = 'https://www.tesco.ie/shop/en-IE/products/300000001';
await q(`
insert into public.products(id, canonical_name, brand, ean) values
  ('${PID_RICE}','Rice Canonical', null, null), ('${PID_EGGS}','Eggs Canonical', null, null);
insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status)
values ('${MID_D}','${PID_RICE}','tesco','300000001','${URL_D}','Tesco Rice','Tesco',true,null,'resolved');
insert into public.scrape_product_receipts(run_id, store_product_id, outcome) values ('33333333-3333-3333-3333-333333333333','${MID_D}','success');
insert into public.price_observations(store_product_id, price, observed_at, source) values ('${MID_D}', 1.00, now() - interval '5 days', 'tesco_direct');
`);
await clearPacing();
const WD = { ...(await begin('fargate-worker-d-wwww')), owner: 'fargate-worker-d-wwww' };
// Collector selected/assessed the RICE snapshot...
const riceSnap = await snapshotOf(MID_D);
// ...but product_id is changed to the EGGS canonical BEFORE reservation.
await q(`update public.store_products set product_id='${PID_EGGS}' where id='${MID_D}';`);
const dBefore = await priceCount(MID_D);
await expectThrows(() => reserve(WD, MID_D, URL_D, WD.owner, riceSnap), 'expected_snapshot_changed',
  'reservation REJECTS when the canonical product changed (rice->eggs) before reserve');
assert(await priceCount(MID_D) === dBefore, 'no price written for the rice->eggs reproduction');
await db.query(`select public.apify_close_tesco_run($1,$2,$3,$4,'degraded')`, [WD.runId, GATE, WD.token, WD.owner]);

// ============================================================
// REGRESSION — durable budget reservations enforce the cap.
// ============================================================
// Reserve amounts up to a tiny cap; the next reservation must be refused, and
// outstanding (unsettled) reservations keep counting (restart/uncertain).
const r1 = (await db.query(`select public.apify_reserve_budget('budget-test', null, 0.6, 1.0) as r`)).rows[0].r;
assert(Number(r1.remainingUsd) === 0.4, 'first reservation leaves the expected remaining balance');
const r2 = (await db.query(`select public.apify_reserve_budget('budget-test', null, 0.3, 1.0) as r`)).rows[0].r;
assert(Number(r2.remainingUsd) === 0.1, 'second reservation further reduces the balance');
// $0.2 more would exceed the $1.0 cap (0.9 committed) -> refused.
await expectThrows(() => db.query(`select public.apify_reserve_budget('budget-test', null, 0.2, 1.0)`), 'budget_exhausted',
  'reservation refused when it would exceed the cap (outstanding reservations counted)');
// Settling r1 to a SMALLER actual frees balance; reconciled committed = 0.1+0.3.
await db.query(`select public.apify_settle_budget($1, 0.1, 'provrun1')`, [r1.reservationId]);
assert(Number((await db.query(`select public.apify_campaign_committed_usd('budget-test') as c`)).rows[0].c) === 0.4,
  'settling to the actual charge reconciles committed spend (0.1 actual + 0.3 outstanding)');
// An unsettled reservation (r2) STILL counts (delayed/uncertain billing).
await expectThrows(() => db.query(`select public.apify_reserve_budget('budget-test', null, 0.7, 1.0)`), 'budget_exhausted',
  'an unsettled reservation keeps counting against the cap (delayed billing safe)');

// Identity verification record + reuse invalidation on fingerprint change.
await db.query(`select public.apify_record_identity_verification($1,$2,'{}'::jsonb,'{}'::jsonb,'det rationale long enough here','deterministic',$3,null,null,$4,720)`, [MID, 'c'.repeat(64), 'v2', 'd'.repeat(64)]);
await db.query(`select public.apify_record_identity_verification($1,$2,'{}'::jsonb,'{}'::jsonb,'changed identity rationale here','deterministic_plus_ai',$3,'m',null,$4,720)`, [MID, 'e'.repeat(64), 'v2', 'f'.repeat(64)]);
const activeV = (await db.query(`select identity_fingerprint from public.tesco_identity_verifications where store_product_id=$1 and invalidated_at is null`, [MID])).rows;
assert(activeV.length === 1 && activeV[0].identity_fingerprint === 'e'.repeat(64), 'a new fingerprint invalidates the prior active verification');

// ---- FIRST-PRICE expansion path (20261113090000): single-use, evidence-bound approval ----
// Mapping C: resolved, canonical URL, NEVER observed, NO success receipt, one-to-one SKU.
const MID_FP = 'a1a1a1a1-0000-0000-0000-000000000001';
const PID_FP = 'a2a2a2a2-0000-0000-0000-000000000002';
const URL_FP = 'https://www.tesco.ie/shop/en-IE/products/279000001';
// Mapping D: a second unproven mapping (used to test cross-mapping reuse).
const MID_FR = 'b1b1b1b1-0000-0000-0000-000000000001';
const PID_FR = 'b2b2b2b2-0000-0000-0000-000000000002';
const URL_FR = 'https://www.tesco.ie/shop/en-IE/products/279000002';
const EV_FP = 'c1c1c1c1-0000-0000-0000-000000000001'; // retained evidence page for C
const EV_FR_OLD = 'c2c2c2c2-0000-0000-0000-000000000002'; // 20-day-old evidence page for D
const SHA_EV = 'c'.repeat(64);
const FPR = 'd'.repeat(64); // approved identity fingerprint
const SEED_RUN = '33333333-3333-3333-3333-333333333333';
await q(`
insert into public.products(id, canonical_name, brand, ean) values
  ('${PID_FP}','Nutella Hazelnut Spread 400g','Nutella','7622300441074'),
  ('${PID_FR}','Example Soup 400g','Example',null);
insert into public.store_products(id, product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, gtin, url_status)
values
  ('${MID_FP}','${PID_FP}','tesco','279000001','${URL_FP}','Nutella Hazelnut Spread 400g','Nutella',false,null,'resolved'),
  ('${MID_FR}','${PID_FR}','tesco','279000002','${URL_FR}','Example Soup 400g','Example',false,null,'resolved');
insert into public.tesco_direct_collection_pages(id, run_id, egress_key, requested_url, store_product_id, mode, outcome, body_sha256, parsed, created_at)
values
  ('${EV_FP}','${SEED_RUN}','${GATE}','${URL_FP}','${MID_FP}','products','ok','${SHA_EV}','{"products":[{"sku":"279000001"}]}'::jsonb, now() - interval '3 days'),
  ('${EV_FR_OLD}','${SEED_RUN}','${GATE}','${URL_FR}','${MID_FR}','products','ok','${'e'.repeat(64)}','{"products":[{"sku":"279000002"}]}'::jsonb, now() - interval '20 days');
`);
const resetPacing = () => db.query(`update public.tesco_egress_pool set last_success_at = null where egress_key = $1`, [GATE]);
const assessmentFor = (over = {}) => ({
  decision: 'verified_exact', model: 'anthropic.claude-test', rule_version: 'tesco-identity-v1',
  reason: 'Same brand, product type and size; the Tesco page title and SKU match the mapped canonical product.',
  mapping_id: MID_FP, source_page_id: EV_FP, source_body_sha256: SHA_EV, identity_fingerprint: FPR, ...over,
});
async function recordApproval({ mid = MID_FP, page = EV_FP, sha = SHA_EV, fp = FPR, assessment = assessmentFor(), snapshot } = {}) {
  const snap = snapshot === undefined ? await snapshotOf(mid) : snapshot;
  return (await db.query(`select public.apify_record_first_price_approval($1,$2,$3,$4,$5::jsonb,$6::jsonb) as id`,
    [mid, page, sha, fp, JSON.stringify(assessment), JSON.stringify(snap)])).rows[0].id;
}
async function reserveExp(a, mid, url, approvalId, mode = 'expansion') {
  await resetPacing();
  const exp = await snapshotOf(mid);
  return db.query(`select public.apify_reserve_tesco_request($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) as r`,
    [a.runId, GATE, a.token, a.owner, mid, url, mode, JSON.stringify(exp), approvalId]);
}
async function recordExp(a, mid, url, sku) {
  return db.query(`select public.apify_record_tesco_page($1,$2,$3,$4,$5,$6,'expansion','ok',200,null,120,$7,
    $8::jsonb, '[]'::jsonb, '{"provider":"apify"}'::jsonb, false, null, false,
    '{"sku":"${sku}","actorId":"A","runId":"r","datasetId":"d","rawItem":{},"rawItemSha256":"${'a'.repeat(64)}"}'::jsonb)`,
    [a.runId, GATE, a.token, a.owner, mid, url, 'f'.repeat(64), JSON.stringify({ products: [{ sku }], listing: null })]);
}
async function finaliseExp(a, mid, price, approvalId, liveFp) {
  const asn = await snapshotOf(mid);
  return db.query(`select public.apify_finalise_tesco_page($1,$2,$3,$4,$5,'expansion',$6,null,'x',$7::jsonb,$8,$9) as r`,
    [a.runId, GATE, a.token, a.owner, mid, price, JSON.stringify(asn), approvalId, liveFp]);
}
const approvalRow = async (id) => (await db.query(`select * from public.tesco_first_price_approvals where id=$1`, [id])).rows[0];
const receiptCount = async (mid) => (await db.query(`select count(*)::int n from public.scrape_product_receipts where store_product_id=$1 and outcome='success'`, [mid])).rows[0].n;
const allPriceCount = async (mid) => (await db.query(`select count(*)::int n from public.price_observations where store_product_id=$1`, [mid])).rows[0].n;

// -- Approval recording: every binding is validated before a row exists. --
await expectThrows(() => recordApproval({ mid: MID }), 'already_proven_no_approval_needed', 'approval refused for a mapping that already has a success receipt');
await expectThrows(() => recordApproval({ sha: 'b'.repeat(64), assessment: assessmentFor({ source_body_sha256: 'b'.repeat(64) }) }), 'evidence_mismatch', 'approval refused when the evidence sha256 does not match the retained page');
await expectThrows(() => recordApproval({ page: EV_FR_OLD, sha: 'e'.repeat(64), assessment: assessmentFor({ source_page_id: EV_FR_OLD, source_body_sha256: 'e'.repeat(64) }) }), 'evidence_mismatch', 'approval refused for an evidence page that belongs to a DIFFERENT mapping');
await expectThrows(() => recordApproval({ mid: MID_FR, page: EV_FR_OLD, sha: 'e'.repeat(64), assessment: assessmentFor({ mapping_id: MID_FR, source_page_id: EV_FR_OLD, source_body_sha256: 'e'.repeat(64) }) }), 'evidence_stale', 'approval refused for retained evidence older than 14 days');
await expectThrows(() => recordApproval({ assessment: assessmentFor({ decision: 'needs_review' }) }), 'assessment_invalid', 'approval refused unless the AI decision is verified_exact');
await expectThrows(() => recordApproval({ assessment: assessmentFor({ reason: 'ok' }) }), 'assessment_invalid', 'approval refused for an AI assessment with no substantive reason');
await expectThrows(() => recordApproval({ assessment: assessmentFor({ mapping_id: MID_FR }) }), 'assessment_binding_mismatch', 'approval refused when the assessment is bound to another mapping');
await expectThrows(() => recordApproval({ assessment: assessmentFor({ identity_fingerprint: 'a'.repeat(64) }) }), 'assessment_binding_mismatch', 'approval refused when the assessment fingerprint differs from the supplied one');
const staleSnap = { ...(await snapshotOf(MID_FP)), canonical_name: 'Something Else' };
await expectThrows(() => recordApproval({ snapshot: staleSnap }), 'expected_snapshot_changed', 'approval refused when the supplied mapping snapshot is not the live mapping');
assert((await db.query(`select count(*)::int n from public.tesco_first_price_approvals`)).rows[0].n === 0, 'no approval row exists after every refused attempt');

// -- MISSING approval: reserve and finalise both refuse an unproven mapping. --
const FPA = { ...(await begin('fargate-owner-cccccccc')), owner: 'fargate-owner-cccccccc' };
await expectThrows(() => reserveExp(FPA, MID_FP, URL_FP, null), 'mapping_not_resolved_or_unproven', 'MISSING approval: expansion reserve refuses an unproven mapping');
await expectThrows(() => reserveExp(FPA, MID_FP, URL_FP, '99999999-9999-9999-9999-999999999999'), 'first_price_approval_invalid', 'unknown approval id is refused at reserve');

const APPROVAL = await recordApproval();
const ap0 = await approvalRow(APPROVAL);
assert(ap0 && ap0.consumed_at === null && ap0.evidence_page_id === EV_FP && ap0.evidence_body_sha256 === SHA_EV && ap0.identity_fingerprint === FPR,
  'a valid approval is recorded, unconsumed, bound to the retained page, its sha256 and the identity fingerprint');

// -- Approval can never be used for a different mapping or in RENEWAL. --
await expectThrows(() => reserveExp(FPA, MID_FR, URL_FR, APPROVAL), 'first_price_approval_invalid', 'REUSE ACROSS MAPPINGS: an approval for mapping C cannot reserve mapping D');
await expectThrows(() => reserveExp(FPA, MID_FP, URL_FP, APPROVAL, 'renewal'), 'mapping_not_resolved_or_unproven', 'RENEWAL never accepts a first-price approval');

// -- CHANGED mapping: any change to the approved mapping invalidates the approval. --
await db.query(`update public.store_products set brand = 'Nutella Changed' where id = $1`, [MID_FP]);
await expectThrows(() => reserveExp(FPA, MID_FP, URL_FP, APPROVAL), 'first_price_approval_snapshot_changed', 'CHANGED MAPPING: reserve refuses once the mapping differs from the approved snapshot');
await db.query(`update public.store_products set brand = 'Nutella' where id = $1`, [MID_FP]);

// -- Happy reserve + record, then the finalise guards. --
const rsv = (await reserveExp(FPA, MID_FP, URL_FP, APPROVAL)).rows[0].r;
assert(rsv && rsv.reserved === true && rsv.firstPrice === true, 'reserve admits the unproven mapping ONLY with its live approval (firstPrice=true)');
assert((await approvalRow(APPROVAL)).consumed_at === null, 'reserve does NOT consume the approval');
await recordExp(FPA, MID_FP, URL_FP, '279000001');
assert(await allPriceCount(MID_FP) === 0, 'recording evidence writes no price');

await expectThrows(() => finaliseExp(FPA, MID_FP, 3.5, null, FPR), 'first_price_approval_required', 'MISSING approval: finalise refuses a first price');
await expectThrows(() => finaliseExp(FPA, MID_FP, 3.5, '99999999-9999-9999-9999-999999999999', FPR), 'first_price_approval_invalid', 'finalise refuses an unknown approval id');
await expectThrows(() => finaliseExp(FPA, MID_FP, 3.5, APPROVAL, 'a'.repeat(64)), 'first_price_live_identity_mismatch', 'MISMATCHED identity: finalise refuses when the live fingerprint differs from the approved one');
await expectThrows(() => finaliseExp(FPA, MID_FP, 3.5, APPROVAL, null), 'first_price_live_identity_mismatch', 'finalise refuses a missing live fingerprint');
await db.query(`update public.tesco_direct_collection_pages set body_sha256 = $2 where id = $1`, [EV_FP, '1'.repeat(64)]);
await expectThrows(() => finaliseExp(FPA, MID_FP, 3.5, APPROVAL, FPR), 'first_price_evidence_mismatch', 'MISMATCHED evidence: finalise refuses when the retained evidence no longer matches the approval');
await db.query(`update public.tesco_direct_collection_pages set body_sha256 = $2 where id = $1`, [EV_FP, SHA_EV]);
await db.query(`update public.store_products set brand = 'Nutella Changed' where id = $1`, [MID_FP]);
await expectThrows(() => finaliseExp(FPA, MID_FP, 3.5, APPROVAL, FPR), 'mapping_snapshot_changed', 'CHANGED MAPPING: finalise refuses when the mapping changed after reservation');
await db.query(`update public.store_products set brand = 'Nutella' where id = $1`, [MID_FP]);
assert(await allPriceCount(MID_FP) === 0 && await receiptCount(MID_FP) === 0 && (await approvalRow(APPROVAL)).consumed_at === null,
  'every refused finalise left NO price, NO receipt and the approval UNCONSUMED');

// -- Success: price + first receipt + consumption in one transaction. --
assert((await finaliseExp(FPA, MID_FP, 3.5, APPROVAL, FPR)).rows[0].r.finalised === true, 'finalise with a valid approval and matching live identity writes the first price');
const ap1 = await approvalRow(APPROVAL);
assert(await allPriceCount(MID_FP) === 1 && await receiptCount(MID_FP) === 1, 'exactly one price and one success receipt were written');
assert(ap1.consumed_at !== null && ap1.consumed_run_id === FPA.runId, 'the approval was consumed by this run in the same transaction');
await db.query(`select public.apify_close_tesco_run($1,$2,$3,$4,'complete')`, [FPA.runId, GATE, FPA.token, FPA.owner]);

// -- ATTEMPTED REUSE: a consumed approval is dead even if the mapping looks unproven again. --
await expectThrows(() => recordApproval(), 'already_proven_no_approval_needed', 'a proven mapping cannot receive a fresh approval');
await db.query(`delete from public.scrape_product_receipts where store_product_id = $1`, [MID_FP]);
await db.query(`delete from public.price_observations where store_product_id = $1`, [MID_FP]);
await db.query(`delete from public.tesco_direct_collection_pages where run_id = $1`, [FPA.runId]);
const FPB = { ...(await begin('fargate-owner-dddddddd')), owner: 'fargate-owner-dddddddd' };
await expectThrows(() => reserveExp(FPB, MID_FP, URL_FP, APPROVAL), 'first_price_approval_invalid', 'REUSE: reserve refuses a consumed approval');
await db.query(`insert into public.tesco_direct_collection_pages(run_id, egress_key, requested_url, store_product_id, mapping_snapshot, mode, outcome, body_sha256, parsed)
  values ($1,$2,$3,$4,$5::jsonb,'products','ok',$6,'{"products":[{"sku":"279000001"}]}'::jsonb)`,
  [FPB.runId, GATE, URL_FP, MID_FP, JSON.stringify(await snapshotOf(MID_FP)), 'f'.repeat(64)]);
await expectThrows(() => finaliseExp(FPB, MID_FP, 3.5, APPROVAL, FPR), 'first_price_approval_already_consumed', 'REUSE: finalise refuses a consumed approval and writes nothing');
assert(await allPriceCount(MID_FP) === 0 && await receiptCount(MID_FP) === 0, 'the replay attempt wrote NO price and NO receipt');
await db.query(`select public.apify_close_tesco_run($1,$2,$3,$4,'complete')`, [FPB.runId, GATE, FPB.token, FPB.owner]);

console.log(`\n${failures === 0 ? 'ALL MIGRATION ASSERTIONS PASSED' : failures + ' MIGRATION ASSERTION(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
