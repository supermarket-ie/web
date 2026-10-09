import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { collectTescoSupervised, reconcileSupervisedRun, selectSupervisedCandidates, SUPERVISED_GATE, type ExecuteSql } from './tesco-supervised-collection';
import { fetchTescoCollectedPage, type TescoPageResponse } from './tesco-direct-collection-core';

let db: PGlite;
let execute: ExecuteSql;
let sleep: Mock<(ms: number) => Promise<void>>;
const ids = [randomUUID(), randomUUID(), randomUUID()];
const products = [randomUUID(), randomUUID(), randomUUID()];
const historic = randomUUID();
const sku = (i = 0) => String(123456789 + i);
const url = (i = 0) => `https://www.tesco.ie/shop/en-IE/products/${sku(i)}`;
function response(i = 0, changes: Record<string, unknown> = {}): TescoPageResponse {
  const product = { id: sku(i), tpnc: sku(i), title: 'Tesco Whole Milk 1L', brandName: 'TESCO',
    price: { actual: 1.29 }, isForSale: true, status: 'AvailableForSale',
    details: { packSize: [{ value: 1, units: 'l' }] }, ...changes };
  return { outcome: 'ok', status: 200, finalUrl: url(i), retryAfter: null, elapsedMs: 400,
    html: `<p>€1.29</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': {
      props: { config: { global: { locale: 'en-IE' } }, apolloCache: {
        ROOT_QUERY: { [`product({"tpnc":"${sku(i)}"})`]: { __ref: 'p' } }, p: product,
      } },
    } })}</script>` };
}
async function seed(i = 0, age = '5 days', price = 1.15) {
  await db.query(`insert into products values($1,'Whole Milk 1L',null);
    `, [products[i]]);
  await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
    values($1,$2,'tesco',$3,$4,'Tesco Whole Milk 1L','TESCO',true,'resolved')`, [ids[i], products[i], sku(i), url(i)]);
  await db.query(`insert into price_observations(store_product_id,price,observed_at,source)
    values($1,$2,now()-$3::interval,'tesco_direct')`, [ids[i], price, age]);
  await db.query(`insert into scrape_product_receipts values($1,$2,'success',now()-$3::interval)`, [historic, ids[i], age]);
}
async function observations() { return (await db.query<Record<string, unknown>>('select * from price_observations order by observed_at,id')).rows; }
async function gate() { return (await db.query<Record<string, unknown>>(`select * from tesco_egress_pool where egress_key=$1`, [SUPERVISED_GATE])).rows[0]; }
async function run(fetchPage = vi.fn().mockResolvedValue(response()), limit = 25, sql = execute) {
  return collectTescoSupervised({ mode: 'renewal', limit }, { execute: sql, sleep, fetchPage });
}

beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table products(id uuid primary key,canonical_name text,brand text);
    create table store_products(id uuid primary key,product_id uuid references products,store text,store_sku text,
      store_url text,store_product_name text,brand text,is_own_brand boolean,url_status text);
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
    -- Test fixture for the existing trusted-view contract, not a production migration.
    create view latest_prices as select distinct on (s.id) s.id store_product_id,s.product_id canonical_product_id,
      s.store,o.price,o.observed_at from store_products s join price_observations o on o.store_product_id=s.id
      where s.url_status='resolved' and o.price>0 and o.source='tesco_direct'
        and o.observed_at>now()-interval '7 days' order by s.id,o.observed_at desc,o.id;
    insert into tesco_egress_pool(egress_key) values('${SUPERVISED_GATE}');
    insert into scrape_runs(id,store,status,error_summary) values('${historic}','tesco','success','legacy non-JSON message');
  `);
  // Execute the repository's real append/idempotency function and real page/gate
  // migration. A JS mock cannot demonstrate database rollback or unique receipts.
  await db.exec(readFileSync('supabase/migrations/20260822100000_add_price_observation_source.sql', 'utf8')
    .split('create or replace function public.finalize_tesco_scrape_product_pepesto')[0]);
  await db.exec(readFileSync('supabase/migrations/20260929093608_tesco_direct_collection_evidence.sql', 'utf8'));
  execute = async query => {
    const results = await db.exec(query);
    return results.at(-1)?.rows as Record<string, unknown>[] ?? [];
  };
  sleep = vi.fn(async () => {
    // Advance only the test gate's pacing clock, not production selection time.
    await db.exec("update tesco_egress_pool set last_success_at=now()-interval '11 seconds'");
  });
}, 20_000);
afterEach(async () => { await db.close(); });

describe('supervised renewal with PostgreSQL finalisation', () => {
  it('exposes a reconcilable run ID when the lease claim acknowledgement is lost', async () => {
    await seed();
    const progress = vi.fn(), fetchPage = vi.fn();
    const flaky: ExecuteSql = async sql => {
      const rows = await execute(sql);
      if (sql.includes('insert into scrape_runs(id,store,run_id')) throw new Error('ack lost');
      return rows;
    };
    await expect(collectTescoSupervised({ mode: 'renewal' }, { execute: flaky, progress, fetchPage })).rejects.toThrow('ack lost');
    const runId = progress.mock.calls[0][0].runId;
    expect(await reconcileSupervisedRun(execute, runId)).toMatchObject({ inserted: 0, unresolved: [] });
    expect(fetchPage).not.toHaveBeenCalled();
    expect((await gate()).leased_until).not.toBeNull();
  });
  it('selects still-fresh four-day observations oldest-first, separately from expansion', async () => {
    await seed(0, '4 days'); await seed(1, '6 days'); await seed(2, '3 days 23 hours');
    expect((await selectSupervisedCandidates(execute, 'renewal', 100)).map(m => m.id)).toEqual([ids[1], ids[0]]);
    expect(await selectSupervisedCandidates(execute, 'expansion', 100)).toEqual([]);
    expect((await collectTescoSupervised({ mode: 'renewal', dryRun: true }, { execute })).result).toBe('dry_run');
    expect((await db.query('select count(*)::int n from scrape_runs')).rows).toEqual([{ n: 1 }]);
    expect((await gate()).leased_until).toBeNull();
  });
  it('appends a verified live price, preserving the earlier row and releasing the lease', async () => {
    await seed(); const before = await observations();
    const result = await run();
    expect(result).toMatchObject({ result: 'complete', inserted: 1, completed: 1, unresolved: [] });
    const after = await observations();
    expect(after[0]).toEqual(before[0]); expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ price: '1.29', source: 'tesco_direct' });
    expect((await gate()).leased_until).toBeNull();
    expect((await db.query('select store_product_name from store_products')).rows[0]).toEqual({ store_product_name: 'Tesco Whole Milk 1L' });
  });
  it('renews an unchanged price with a new observation instead of changing its timestamp', async () => {
    await seed(0, '5 days', 1.29); const before = await observations();
    const result = await run();
    expect(await observations()).toHaveLength(2);
    expect((await observations())[0]).toEqual(before[0]);
    expect((await db.query('select unchanged_count from scrape_runs where id=$1', [result.id])).rows[0]).toEqual({ unchanged_count: 1 });
  });
  it('preserves the trusted price when no regular price is available', async () => {
    await seed(); const before = await observations();
    expect(await run(vi.fn().mockResolvedValue(response(0, { price: { actual: null } })))).toMatchObject({ inserted: 0, completed: 1 });
    expect(await observations()).toEqual(before);
    expect((await db.query('select price from latest_prices')).rows[0]).toEqual({ price: '1.15' });
  });
  it('stops on a pack mismatch without requesting the next product or changing either old price', async () => {
    await seed(0, '6 days'); await seed(1); const before = await observations();
    const fetcher = vi.fn().mockResolvedValue(response(0, { title: 'Tesco Whole Milk 2L', details: { packSize: [{ value: 2, units: 'l' }] } }));
    expect(await run(fetcher)).toMatchObject({ result: 'identity_validation_anomaly', inserted: 0, completed: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(await observations()).toEqual(before);
  });
  it('rejects a different SKU, even when its title and price look correct', async () => {
    await seed();
    expect(await run(vi.fn().mockResolvedValue(response(1)))).toMatchObject({ result: 'identity_validation_anomaly', inserted: 0 });
  });
  it('makes repeated finalisation idempotent in the real finalizer', async () => {
    await seed(); const result = await run();
    const again = await db.query(`select finalize_store_scrape_product(p_run_uuid=>$1,p_store=>'tesco',
      p_store_product_id=>$2,p_success=>true,p_price=>99) inserted`, [result.id, ids[0]]);
    expect(again.rows[0]).toEqual({ inserted: false });
    expect(await observations()).toHaveLength(2);
    const fetcher = vi.fn();
    expect(await collectTescoSupervised({ mode: 'renewal', resume: String(result.id) }, { execute, fetchPage: fetcher })).toMatchObject({ result: 'terminal_run' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not finalise twice if the same checkpoint command is delivered twice', async () => {
    await seed();
    const duplicate: ExecuteSql = async sql => { const result = await execute(sql); if (sql.endsWith('select 1 checkpointed')) await execute(sql); return result; };
    expect(await run(undefined, 25, duplicate)).toMatchObject({ inserted: 1 });
    expect(await observations()).toHaveLength(2);
  });
  it('holds an unknown interrupted request across restarts and new runs', async () => {
    await seed(); const before = await observations();
    const result = await run(vi.fn().mockRejectedValue(new Error('process interrupted')));
    expect(result).toMatchObject({ result: 'interrupted', inserted: 0, reserved: 1, unresolved: [url()] });
    const fetcher = vi.fn();
    expect(await collectTescoSupervised({ mode: 'renewal', resume: String(result.id) }, { execute, fetchPage: fetcher })).toMatchObject({ result: 'unresolved_attempts' });
    expect(await selectSupervisedCandidates(execute, 'renewal', 25)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled(); expect(await observations()).toEqual(before);
    expect((await reconcileSupervisedRun(execute, String(result.id))).unresolved).toEqual([url()]);
  });
  it('resumes after a lost commit acknowledgement without refetching or redating the committed product', async () => {
    await seed(0, '6 days'); await seed(1);
    let lost = false;
    const flaky: ExecuteSql = async sql => { const result = await execute(sql); if (!lost && sql.endsWith('select 1 checkpointed')) { lost = true; throw new Error('ack lost'); } return result; };
    const first = await run(undefined, 25, flaky);
    expect(first).toMatchObject({ result: 'interrupted', inserted: 1, unresolved: [] });
    const afterFirst = await observations();
    const fetcher = vi.fn().mockResolvedValue(response(1));
    const resumed = await collectTescoSupervised({ mode: 'renewal', resume: String(first.id) }, { execute, sleep, fetchPage: fetcher });
    expect(resumed).toMatchObject({ result: 'complete', inserted: 2 });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(url(1));
    expect((await observations()).filter(x => x.store_product_id === ids[0])).toEqual(afterFirst.filter(x => x.store_product_id === ids[0]));
  });
  it('rolls the page and observation back together if finalisation fails', async () => {
    await seed(); const before = await observations();
    await db.exec(`create function reject_price() returns trigger language plpgsql as $$ begin raise exception 'fixture'; end $$;
      create trigger reject_price before insert on price_observations for each row execute function reject_price()`);
    expect(await run()).toMatchObject({ result: 'interrupted', completed: 0, inserted: 0, unresolved: [url()] });
    expect(await observations()).toEqual(before);
  });
  it.each([403, 429])('preserves HTTP %s restrictions and stops the whole run', async status => {
    await seed(0, '6 days'); await seed(1); const before = await observations();
    const fetcher = vi.fn(async (requested: string) => fetchTescoCollectedPage(requested,
      vi.fn().mockResolvedValue(new Response('Denied', { status, headers: { 'Retry-After': '200000' } }))));
    const result = await run(fetcher);
    expect(result).toMatchObject({ result: status === 403 ? 'access_block' : 'rate_limited', inserted: 0, completed: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(await observations()).toEqual(before);
    expect(Date.parse(String((await gate()).cooldown_until))).toBeGreaterThan(Date.now() + 199000_000);
    expect((await gate()).leased_until).toBeNull();
  });
  it('preserves quarantine even if checkpoint persistence fails after the restriction', async () => {
    await seed();
    const broken: ExecuteSql = sql => sql.endsWith('select 1 checkpointed') ? Promise.reject(new Error('write lost')) : execute(sql);
    const result = await run(vi.fn().mockResolvedValue({ ...response(), status: 403, outcome: 'access_block', html: 'Denied' }), 25, broken);
    expect(result).toMatchObject({ inserted: 0, unresolved: [url()] });
    expect((result.summary as Record<string, unknown>).stopReason).toBe('access_block');
    expect(Date.parse(String((await gate()).cooldown_until))).toBeGreaterThan(Date.now() + 47 * 3600_000);
  });
  it.each(['network_error', 'unsafe_redirect'] as const)('stops on %s without automatic retries', async outcome => {
    await seed(0, '6 days'); await seed(1);
    const fetcher = vi.fn().mockResolvedValue({ ...response(), html: '', outcome, status: null, redirectUrl: 'https://www.tesco.ie/login' });
    expect(await run(fetcher)).toMatchObject({ result: outcome, inserted: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(Date.parse(String((await gate()).cooldown_until))).toBeGreaterThan(Date.now() + 14 * 60_000);
  });
  it('stops malformed pages and keeps the earlier price', async () => {
    await seed(); const before = await observations();
    expect(await run(vi.fn().mockResolvedValue({ ...response(), html: '<html>unusable</html>' }))).toMatchObject({ result: 'parse_error', inserted: 0 });
    expect(await observations()).toEqual(before);
  });
  it.each(['leased_until', 'cooldown_until'])('does not fetch while %s is active', async field => {
    await seed(); await db.exec(`update tesco_egress_pool set ${field}=now()+interval '1 hour'`);
    const fetcher = vi.fn(); await expect(run(fetcher)).rejects.toThrow('gate_unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fails closed if the mapping changes while its page is being fetched', async () => {
    await seed(); const before = await observations();
    const fetcher = vi.fn(async () => { await db.exec("update products set canonical_name='Whole Milk 2L'"); return response(); });
    expect(await run(fetcher)).toMatchObject({ result: 'interrupted', inserted: 0, unresolved: [url()] });
    expect(await observations()).toEqual(before);
  });
  it('does not overwrite or duplicate a concurrent refresh', async () => {
    await seed();
    const fetcher = vi.fn(async () => { await db.query("insert into price_observations(store_product_id,price,observed_at,source) values($1,1.4,now(),'tesco_direct')", [ids[0]]); return response(); });
    expect(await run(fetcher)).toMatchObject({ result: 'interrupted', inserted: 0 });
    expect(await observations()).toHaveLength(2);
    expect((await db.query('select price from latest_prices')).rows[0]).toEqual({ price: '1.4' });
  });
  it('an expired owner cannot write or release a successor lease', async () => {
    await seed();
    const fetcher = vi.fn(async () => {
      await db.exec(`update scrape_runs set error_summary=(error_summary::jsonb || '{"activeSupervisor":"successor"}'::jsonb)::text where run_id like 'tesco_supervised_%';
        update tesco_egress_pool set leased_until=now()+interval '1 hour'`);
      return response();
    });
    expect(await run(fetcher)).toMatchObject({ inserted: 0 });
    expect((await gate()).leased_until).not.toBeNull();
  });
  it('handles quotes, backslashes and dollar delimiters as data', async () => {
    await seed(); await db.query('update store_products set store_product_name=$1', ["Tesco Whole Milk 1L '$runner$ \\ text"]);
    // The stored title may fail identity, but cannot terminate the DO block or mutate the schema.
    await run(); expect((await db.query('select count(*)::int n from products')).rows[0]).toEqual({ n: 1 });
  });
  it('enforces explicit modes and bounded limits before querying or fetching', async () => {
    const sql = vi.fn();
    await expect(collectTescoSupervised({ mode: 'renewal', limit: 101 }, { execute: sql })).rejects.toThrow('Limit');
    expect(sql).not.toHaveBeenCalled();
  });
});
