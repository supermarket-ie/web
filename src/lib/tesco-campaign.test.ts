import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { runTescoRecoveryCampaign } from './tesco-campaign';
import {
  selectSupervisedCandidates, listExcludedSharedSkuGroups, type ExecuteSql,
  SUPERVISED_GATE,
} from './tesco-supervised-collection';
import type { TescoPageResponse } from './tesco-direct-collection-core';

let db: PGlite;
let execute: ExecuteSql;
let sleep: Mock<(ms: number) => Promise<void>>;

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table products(id uuid primary key,canonical_name text,brand text);
    create table store_products(id uuid primary key,product_id uuid references products,store text,store_sku text,
      store_url text,store_product_name text,brand text,is_own_brand boolean,url_status text,gtin text);
    create table price_observations(id uuid primary key default gen_random_uuid(),store_product_id uuid references store_products,
      price numeric,was_price numeric,on_promotion boolean,observed_at timestamptz,source text);
    create table scrape_runs(id uuid primary key default gen_random_uuid(),store text,run_id text,started_at timestamptz default now(),
      finished_at timestamptz,target_count int default 0,retrieval_method text,run_scope text,error_summary text,
      attempted_count int default 0,fetched int default 0,extracted int default 0,inserted int default 0,
      unchanged_count int default 0,failed int default 0,threshold_pct numeric default 70,coverage_pct numeric,
      threshold_breached boolean default false,status text default 'running',duration_seconds int);
    create table scrape_product_receipts(run_id uuid references scrape_runs,store_product_id uuid references store_products,
      outcome text,created_at timestamptz default now(),primary key(run_id,store_product_id));
    create table scrape_failures(run_id uuid,store_product_id uuid,store text,failure_stage text,failure_reason text,
      store_url text,canonical_name text,is_retryable boolean,consecutive_failures int,raw_error text,
      unique(run_id,store_product_id,failure_reason));
    create table tesco_egress_pool(egress_key text primary key,enabled boolean default false,leased_until timestamptz,
      cooldown_until timestamptz,last_success_at timestamptz,updated_at timestamptz,last_block_at timestamptz,
      consecutive_blocks int default 0,total_blocks int default 0);
    create view latest_prices as select distinct on (s.id) s.id store_product_id,s.product_id canonical_product_id,
      s.store,o.price,o.observed_at from store_products s join price_observations o on o.store_product_id=s.id
      where s.url_status='resolved' and o.price>0 and o.source='tesco_direct'
        and o.observed_at>now()-interval '7 days' order by s.id,o.observed_at desc,o.id;
    insert into tesco_egress_pool(egress_key) values('${SUPERVISED_GATE}');
  `);
  await db.exec(readFileSync('supabase/migrations/20260822100000_add_price_observation_source.sql', 'utf8')
    .split('create or replace function public.finalize_tesco_scrape_product_pepesto')[0]);
  await db.exec(readFileSync('supabase/migrations/20260929093608_tesco_direct_collection_evidence.sql', 'utf8'));
  execute = async query => { const results = await db.exec(query); return results.at(-1)?.rows as Record<string, unknown>[] ?? []; };
  sleep = vi.fn(async () => { await db.exec("update tesco_egress_pool set last_success_at=now()-interval '11 seconds'"); });
}, 20_000);
afterEach(async () => { await db.close(); });

// Seed an EXPANSION-eligible product (proven, no fresh price) with a UNIQUE SKU.
async function seedUnique(sku: number, overlap: 0 | 2 = 0) {
  const pid = randomUUID(); const sid = randomUUID();
  await db.query(`insert into products values($1,'Whole Milk 1L',null)`, [pid]);
  await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
    values($1,$2,'tesco',$3,$4,'Tesco Whole Milk 1L','TESCO',true,'resolved')`,
    [sid, pid, String(sku), `https://www.tesco.ie/shop/en-IE/products/${sku}`]);
  await db.query(`insert into scrape_runs(id,store,run_id,status) values($1,'tesco',$2,'success')`, [randomUUID(), `leg_${sku}`]);
  await db.query(`insert into scrape_product_receipts(run_id,store_product_id,outcome) select id,$1,'success' from scrape_runs where run_id=$2`, [sid, `leg_${sku}`]);
  // Optional Dunnes+SuperValu fresh peers to give this product overlap=2.
  if (overlap === 2) for (const store of ['dunnes', 'supervalu']) {
    const psid = randomUUID();
    await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
      values($1,$2,$3,$4,'u','n','b',true,'resolved')`, [psid, pid, store, `${store}-${sku}`]);
    await db.query(`insert into price_observations(store_product_id,price,observed_at,source) values($1,1.0,now(),'tesco_direct')`, [psid]);
  }
  return sid;
}
// Seed a SHARED-SKU group: m distinct canonical products on ONE sku (expansion-eligible).
async function seedShared(sku: number, names: string[]) {
  const ids: string[] = [];
  for (const name of names) {
    const pid = randomUUID(); const sid = randomUUID(); ids.push(sid);
    await db.query(`insert into products values($1,$2,null)`, [pid, name]);
    await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
      values($1,$2,'tesco',$3,$4,$5,'TESCO',true,'resolved')`, [sid, pid, String(sku), `https://www.tesco.ie/shop/en-IE/products/${sku}`, name]);
    await db.query(`insert into scrape_runs(id,store,run_id,status) values($1,'tesco',$2,'success')`, [randomUUID(), `sh_${sku}_${sid}`]);
    await db.query(`insert into scrape_product_receipts(run_id,store_product_id,outcome) select id,$1,'success' from scrape_runs where run_id=$2`, [sid, `sh_${sku}_${sid}`]);
  }
  return ids;
}
function okPage(sku: string, title = 'Tesco Whole Milk 1L', units: 'l' = 'l', value = 1): TescoPageResponse {
  const product = { id: sku, tpnc: sku, title, brandName: 'TESCO', price: { actual: 1.29 },
    isForSale: true, status: 'AvailableForSale', details: { packSize: [{ value, units }] } };
  return { outcome: 'ok', status: 200, finalUrl: `https://www.tesco.ie/shop/en-IE/products/${sku}`, retryAfter: null, elapsedMs: 400,
    html: `<p>€1.29</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': {
      props: { config: { global: { locale: 'en-IE' } }, apolloCache: {
        ROOT_QUERY: { [`product({"tpnc":"${sku}"})`]: { __ref: 'p' } }, p: product } } } })}</script>` };
}
const deps = (fetchPage: Mock<(u: string) => Promise<TescoPageResponse>>) => ({ execute, sleep, fetchPage });

describe('Tesco recovery campaign (PGlite)', () => {
  it('excludes shared-SKU groups from selection and reports them; never requests them', async () => {
    await seedUnique(900001);
    await seedShared(950000, ['Yogurt Rice Cakes 100g', 'Mixed Berry Yogurt Rice Cakes 96g', 'Sweet Chilli Rice Cakes']);
    // Selection with exclusion returns only the unique product.
    const sel = await selectSupervisedCandidates(execute, 'expansion', 100, { excludeSharedSku: true });
    expect(sel.map(c => c.store_sku)).toEqual(['900001']);
    const excluded = await listExcludedSharedSkuGroups(execute, 'expansion');
    expect(excluded).toHaveLength(1);
    expect(excluded[0]).toMatchObject({ store_sku: '950000', member_count: 3, reason: 'shared_sku_canonical_group_deferred' });

    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(okPage(u.split('/').pop()!)));
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 1000, maxPerRun: 100 }, deps(fetcher));
    // The shared-SKU URL is NEVER requested.
    const requested = fetcher.mock.calls.map(c => c[0]);
    expect(requested.some(u => u.endsWith('/950000'))).toBe(false);
    expect(requested).toContain('https://www.tesco.ie/shop/en-IE/products/900001');
    expect(report.excludedSharedSkuGroups).toHaveLength(1);
    expect(report.acceptedPrices).toBe(1);
  });

  it('runs sequential bounded batches to process more than one run worth of products', async () => {
    for (let i = 0; i < 5; i++) await seedUnique(960000 + i);
    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(okPage(u.split('/').pop()!)));
    // maxPerRun=2 forces >=3 sequential runs for 5 products, with no re-approval.
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 1000, maxPerRun: 2 }, deps(fetcher));
    expect(report.runs.length).toBeGreaterThanOrEqual(3);
    expect(report.acceptedPrices).toBe(5);
    expect(report.stoppedReason).toBe('no_more_eligible');
    // Each requested URL is distinct across the whole campaign.
    const requested = fetcher.mock.calls.map(c => c[0]);
    expect(new Set(requested).size).toBe(requested.length);
    expect(report.remainingEligible).toBe(0);
  });

  it('respects the total request budget across runs', async () => {
    for (let i = 0; i < 6; i++) await seedUnique(970000 + i);
    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(okPage(u.split('/').pop()!)));
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 4, maxPerRun: 2 }, deps(fetcher));
    expect(report.requestsIssued).toBeLessThanOrEqual(4);
    expect(report.acceptedPrices).toBeLessThanOrEqual(4);
    expect(report.stoppedReason).toBe('budget_exhausted');
    expect(report.remainingEligible).toBeGreaterThan(0); // some left over
  });

  it('holds-and-continues ordinary mismatches across the campaign (no premature stop)', async () => {
    for (let i = 0; i < 4; i++) await seedUnique(980000 + i);
    // product 980001 is a measure mismatch (2L) -> ordinary hold; others accept.
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const sku = u.split('/').pop()!;
      return Promise.resolve(sku === '980001' ? okPage(sku, 'Tesco Whole Milk 2L', 'l', 2) : okPage(sku));
    });
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 1000, maxPerRun: 100 }, deps(fetcher));
    expect(report.stoppedReason).toBe('no_more_eligible');
    expect(report.acceptedPrices).toBe(3); // 3 accepted, 1 held
  });

  it('reports a CONSECUTIVE-hold-threshold stop distinctly from other systemic stops', async () => {
    // 5 unique products, all ordinary measure mismatches -> 5 consecutive holds
    // trips the (raised) consecutive breaker. The campaign report must surface
    // this as its own stoppedReason, flagged systemic, distinct from an identity
    // validation anomaly or a quarantine stop.
    for (let i = 0; i < 6; i++) await seedUnique(995100 + i);
    const fetcher = vi.fn().mockImplementation((u: string) =>
      Promise.resolve(okPage(u.split('/').pop()!, 'Tesco Whole Milk 2L', 'l', 2)));
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 1000, maxPerRun: 100 }, deps(fetcher));
    expect(report.stoppedReason).toBe('identity_hold_consecutive_exceeded');
    expect(report.stoppedSystemic).toBe(true);
    expect(report.acceptedPrices).toBe(0);
    expect(report.ordinaryHolds).toBe(5);         // 5 holds recorded before the stop
    expect(report.quarantinedProducts).toBe(0);   // distinct from a quarantine stop
    expect(fetcher).toHaveBeenCalledTimes(5);      // stopped at the 5th consecutive hold
  });

  it('reports a hold-RATE-threshold stop distinctly from the consecutive stop', async () => {
    // hold,hold,accept repeating keeps consecutive <= 2 (never trips the
    // consecutive breaker) but drives the hold rate above 40% after >=10 attempts
    // -> identity_hold_rate_exceeded, a DISTINCT stoppedReason.
    for (let i = 0; i < 14; i++) await seedUnique(995200 + i);
    const pattern = [true, true, false]; // hold, hold, accept
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const sku = u.split('/').pop()!;
      const n = fetcher.mock.calls.length - 1;
      return Promise.resolve(pattern[n % 3]
        ? okPage(sku, 'Tesco Whole Milk 2L', 'l', 2)
        : okPage(sku));
    });
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 1000, maxPerRun: 100 }, deps(fetcher));
    expect(report.stoppedReason).toBe('identity_hold_rate_exceeded');
    expect(report.stoppedSystemic).toBe(true);
    expect(report.quarantinedProducts).toBe(0);
  });

  it('STOPS the campaign on a systemic/terminal run and does not continue', async () => {
    for (let i = 0; i < 4; i++) await seedUnique(990000 + i);
    // Every product returns a page whose structured SKU differs (missing exact) ->
    // systemic identity stop on the first run.
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const sku = u.split('/').pop()!; const other = String(Number(sku) + 500000);
      return Promise.resolve({ ...okPage(other), finalUrl: `https://www.tesco.ie/shop/en-IE/products/${other}` });
    });
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 1000, maxPerRun: 100 }, deps(fetcher));
    expect(report.stoppedReason).toBe('identity_validation_anomaly');
    expect(report.runs).toHaveLength(1); // did not start a second run
    expect(report.acceptedPrices).toBe(0);
  });

  it('STOPS on an interruption (lost acknowledgement) and reports unresolved, without retrying', async () => {
    for (let i = 0; i < 3; i++) await seedUnique(991000 + i);
    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(okPage(u.split('/').pop()!)));
    // Throw on the first checkpoint ack -> the run interrupts with a pending page.
    let thrown = false;
    const flaky: ExecuteSql = async (sql) => {
      const r = await execute(sql);
      if (!thrown && sql.endsWith('select 1 checkpointed')) { thrown = true; throw new Error('ack lost'); }
      return r;
    };
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 1000, maxPerRun: 100 },
      { execute: flaky, sleep, fetchPage: fetcher });
    expect(report.stoppedReason).toBe('interrupted');
    expect(report.runs).toHaveLength(1);
  });

  it('quarantines the Heinz product across the campaign and reports it separately (no termination)', async () => {
    // Heinz: unique SKU, ambiguous canonical identity -> quarantine_continue.
    const hpid = randomUUID(); const hsid = randomUUID();
    await db.query(`insert into products values($1,'Heinz By Nature Chicken Dinner 7+ Months 200g',null)`, [hpid]);
    await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
      values($1,$2,'tesco','264880549','https://www.tesco.ie/shop/en-IE/products/264880549','Heinz Dinner','Heinz',false,'resolved')`, [hsid, hpid]);
    await db.query(`insert into scrape_runs(id,store,run_id,status) values($1,'tesco','hz','success')`, [randomUUID()]);
    await db.query(`insert into scrape_product_receipts(run_id,store_product_id,outcome) select id,$1,'success' from scrape_runs where run_id='hz'`, [hsid]);
    await seedUnique(993001); // one clean product after Heinz
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const sku = u.split('/').pop()!;
      if (sku === '264880549') {
        const product = { id: sku, tpnc: sku, title: 'Heinz Sunday Chicken Dinner Baby Food Jar 200g', brandName: 'Heinz',
          price: { actual: 1.89 }, isForSale: true, status: 'AvailableForSale', details: { packSize: [{ value: 200, units: 'g' }] } };
        return Promise.resolve({ outcome: 'ok', status: 200, finalUrl: u, retryAfter: null, elapsedMs: 400,
          html: `<p>€1.89</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': {
            props: { config: { global: { locale: 'en-IE' } }, apolloCache: {
              ROOT_QUERY: { [`product({"tpnc":"${sku}"})`]: { __ref: 'p' } }, p: product } } } })}</script>` } as TescoPageResponse);
      }
      return Promise.resolve(okPage(sku));
    });
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 1000, maxPerRun: 100 }, deps(fetcher));
    expect(report.stoppedReason).toBe('no_more_eligible');  // did NOT terminate on Heinz
    expect(report.quarantinedProducts).toBe(1);
    expect(report.acceptedPrices).toBe(1);                   // the clean product
    expect(report.ordinaryHolds).toBe(0);
  });

  it('produces a consolidated report with all required sections', async () => {
    await seedUnique(992000, 2); // overlap=2 (fresh dunnes+supervalu peers)
    await seedShared(992500, ['A 1kg', 'B 2kg']);
    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(okPage(u.split('/').pop()!)));
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 1000, maxPerRun: 100 }, deps(fetcher));
    expect(report).toMatchObject({ mode: 'expansion' });
    // All required report sections (requirement 6): accepted, ordinary holds,
    // quarantined, shared-SKU exclusions, systemic flag, actual remaining count.
    for (const k of ['acceptedPrices', 'ordinaryHolds', 'quarantinedProducts',
      'excludedSharedSkuGroups', 'excludedSharedSkuMappings', 'stoppedSystemic',
      'remainingEligible', 'unresolvedRequests']) {
      expect(report).toHaveProperty(k);
    }
    expect(report.runs.length).toBeGreaterThanOrEqual(1);
    expect(report.excludedSharedSkuGroups.map(g => g.store_sku)).toContain('992500');
    expect(report.excludedSharedSkuMappings).toBeGreaterThanOrEqual(2); // 2 members in 992500
    expect(report.stoppedSystemic).toBe(false); // clean exhaustion is not systemic
    // remainingEligible is an ACTUAL count, not capped at 100.
    expect(typeof report.remainingEligible).toBe('number');
  });

  it('reports a systemic terminal stop distinctly (stoppedSystemic=true)', async () => {
    for (let i = 0; i < 3; i++) await seedUnique(994000 + i);
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const sku = u.split('/').pop()!; const other = String(Number(sku) + 500000);
      return Promise.resolve({ ...okPage(other), finalUrl: `https://www.tesco.ie/shop/en-IE/products/${other}` });
    });
    const report = await runTescoRecoveryCampaign({ mode: 'expansion', requestBudget: 1000, maxPerRun: 100 }, deps(fetcher));
    expect(report.stoppedReason).toBe('identity_validation_anomaly');
    expect(report.stoppedSystemic).toBe(true);
  });
});
