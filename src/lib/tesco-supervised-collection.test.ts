import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { collectTescoSupervised, reconcileSupervisedRun, selectSupervisedCandidates, SUPERVISED_GATE, type ExecuteSql } from './tesco-supervised-collection';
import { fetchTescoCollectedPage, parseTescoCollectedPage, validateTescoCollectedIdentity, type TescoPageResponse } from './tesco-direct-collection-core';
import { selectAcquisitionCandidates } from './tesco-acquisition-handoff';
import { reentryEvidenceSql, independentExactIdentity, reviewedCanonicalEvidenceGap, selectReviewedCandidates, type ReentryEvidence } from './tesco-hold-reentry';
import { prepareMachineAssessment, type AiReviewedMapping } from './tesco-machine-approval';

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
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable
      as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant execute on function auth.jwt() to authenticated;
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
  await db.exec(readFileSync('supabase/migrations/20261101000000_tesco_hold_reentry_reviews.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261101182500_tesco_machine_reentry_approvals.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261101220707_tesco_supervised_operational_recovery.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261104121700_tesco_explicit_food_counts.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261104123000_tesco_evidence_receipt_guard.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261104123500_tesco_reviewed_evidence_followup.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261104134000_tesco_evidence_pack_totals.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261105114138_tesco_reviewed_plural_pack_counts.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261105162825_tesco_explicit_net_pack_quantity.sql', 'utf8'));
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

describe('audited held Tesco re-entry (production database transactions)', () => {
  async function operationalApproval(page: string, assessed?: Record<string, unknown>, suppliedEvidence?: unknown) {
    const [row] = await execute(`select ${reentryEvidenceSql(ids[0],page)} evidence`);
    const evidence = row.evidence as ReentryEvidence;
    const assessment = { decision:'verified_exact',
      model:'previous-chatgpt-work-independent-inference',
      source:'docs/tesco-hold-reentry-production-queue-20261101.jsonl',
      reason:'Exact previous Tesco SKU and source page, branded pack and independently matching peer evidence.',
      mapping_id:ids[0],source_page_id:page,source_body_sha256:evidence.page.body_sha256,
      validation:{independently_exact:true,checks:['historical_success','brand','pack','variant','peers']},
      ...assessed,
    };
    const json = (value:unknown) => `E'${JSON.stringify(value).replaceAll('\\','\\\\').replaceAll("'","''")}'::jsonb`;
    const [result] = await execute(`select tesco_internal.record_verified_hold_reentry(
      '${ids[0]}'::uuid,'${page}'::uuid,${json(suppliedEvidence??evidence)},${json(assessment)}) review_id`);
    return result.review_id as string;
  }
  it.each([false,true])('server-rederives the explicit peer count; wrong count=%s',async wrong=>{
    const {page,live}=await heldEvidence({title:'Example Pizza Pockets Pepperoni 2 Pack 250g',brandName:'Example',
      details:{packSize:[{value:250,units:'g'}]}});
    await db.query("update products set canonical_name='Example Pepperoni Pizza Pockets 250g',brand='Example' where id=$1",[products[0]]);
    await db.query("update store_products set brand='Example',is_own_brand=false,store_product_name=case when store='tesco' then 'Example Pizza Pockets Pepperoni 2 Pack' when store='dunnes' then $2 else 'Example Pepperoni Pizza Pockets 250g' end where product_id=$1",
      [products[0],`Example ${wrong?3:2} Pepperoni and Cheese Pizza Pockets 250g`]);
    const [row]=await execute(`select ${reentryEvidenceSql(ids[0],page)} evidence`);
    expect(independentExactIdentity(row.evidence as ReentryEvidence)).toBe(!wrong);
    if(wrong){
      await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_pack_or_variant_conflict');
      expect((await db.query('select * from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
      return;
    }
    const review=await operationalApproval(page);
    const result=await collectTescoSupervised({mode:'expansion',limit:1,reviewedCandidates:[review]},
      {execute,sleep,fetchPage:vi.fn().mockResolvedValue(live)});
    expect(result).toMatchObject({result:'complete',inserted:1,completed:1});
    expect((await db.query('select * from tesco_hold_reentry_uses where review_id=$1',[review])).rows).toHaveLength(1);
  });
  it.each([false,true])('retains the original mapping quantity for generic manufacturer recovery; wrong=%s',async wrong=>{
    const {page,live}=await heldEvidence({title:'Example Creamy Vegetable Soup 579g',brandName:'Example',gtin:'05012345678901',
      details:{packSize:[{value:579,units:'g'}]}});
    await db.query("update products set canonical_name='Creamy Vegetable Soup',brand=null where id=$1",[products[0]]);
    await db.query("update store_products set store_product_name=$1,brand='Example',is_own_brand=false where id=$2",
      [`Example Creamy Vegetable Soup ${wrong?500:579}g`,ids[0]]);
    await db.query("update store_products set store_product_name='Example Creamy Vegetable Soup 579g',brand='Example' where store='dunnes'");
    await db.query("update store_products set store_product_name='Other Creamy Chicken Soup 400g',brand='Other' where store='supervalu'");
    if(wrong){await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_pack_or_variant_conflict');return;}
    const review=await operationalApproval(page);
    const result=await collectTescoSupervised({mode:'expansion',limit:1,reviewedCandidates:[review]},
      {execute,sleep,fetchPage:vi.fn().mockResolvedValue(live)});
    expect(result).toMatchObject({result:'complete',inserted:1,completed:1});
    expect((await db.query('select * from tesco_hold_reentry_uses where review_id=$1',[review])).rows).toHaveLength(1);
    expect((await db.query<{store_product_name:string}>("select store_product_name from store_products where store='supervalu'")).rows[0].store_product_name)
      .toBe('Other Creamy Chicken Soup 400g');
  });
  it.each(['valid','bad drained','wrong original'])('revalidates an immutable legacy drained capture as a new net-weight price: %s',async kind=>{
    const {page,live}=await heldEvidence({title:'Example Tomatoes 400g',brandName:'Example',gtin:'05012345678901',
      details:{packSize:[{value:'250',units:'G'}],netContents:'400g e',drainedWeight:'250g'}});
    await db.query("update products set canonical_name='Example Tomatoes 400g',brand='Example' where id=$1",[products[0]]);
    await db.query("update store_products set brand='Example',is_own_brand=false,store_product_name=$1 where id=$2",
      [`Example Tomatoes ${kind==='wrong original'?500:400}g`,ids[0]]);
    await db.query("update store_products set brand='Example',store_product_name='Example Tomatoes 400g' where store in ('dunnes','supervalu')");
    // Test setup represents a capture retained before net/drained reconciliation.
    await db.query(`update tesco_direct_collection_pages set parsed=jsonb_set(parsed,'{products,0,quantity}','{"grams":250}') where id=$1`,[page]);
    if(kind==='bad drained')await db.query(`update tesco_direct_collection_pages set parsed=jsonb_set(parsed,'{products,0,identityDetails,drainedWeight}','"240g"') where id=$1`,[page]);
    if(kind!=='valid'){await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_pack_or_variant_conflict');return;}
    const review=await operationalApproval(page);
    const result=await collectTescoSupervised({mode:'expansion',limit:1,reviewedCandidates:[review]},
      {execute,sleep,fetchPage:vi.fn().mockResolvedValue(live)});
    expect(result).toMatchObject({result:'complete',inserted:1,completed:1});
    const source=(await db.query<{parsed:{products:{quantity:{grams:number}}[]}}>('select parsed from tesco_direct_collection_pages where id=$1',[page])).rows[0];
    expect(source.parsed.products[0].quantity).toEqual({grams:250});
    const captured=(await db.query<{parsed:{products:{quantity:{grams:number}}[]}}>('select parsed from tesco_direct_collection_pages where run_id=$1',[result.id])).rows[0];
    expect(captured.parsed.products[0].quantity).toEqual({grams:400});
  });
  it('requires a new reviewed live request after successful evidence acquisition', async () => {
    const {live}=await heldEvidence();
    const acquisition=await collectTescoSupervised({mode:'expansion',limit:1,evidenceOnly:true,evidenceIds:[ids[0]]},
      {execute,sleep,fetchPage:vi.fn().mockResolvedValue(live)});
    const [page]=(await db.query<{id:string}>('select id from tesco_direct_collection_pages where run_id=$1',[acquisition.id])).rows;
    const [row]=await execute(`select ${reentryEvidenceSql(ids[0],page.id)} evidence`);
    expect(independentExactIdentity(row.evidence as ReentryEvidence)).toBe(true);
    const review=await operationalApproval(page.id);
    const result=await collectTescoSupervised({mode:'expansion',limit:1,reviewedCandidates:[review]},
      {execute,sleep,fetchPage:vi.fn().mockResolvedValue(response(0,{price:{actual:2.49}}))});
    expect(result).toMatchObject({result:'complete',inserted:1,completed:1});
    expect((await observations()).filter(x=>x.store_product_id===ids[0]).at(-1)?.price).toBe('2.49');
    expect((await db.query('select * from scrape_product_receipts where run_id=$1',[acquisition.id])).rows).toHaveLength(0);
  });
  it.each(['pending','network_error'])('preserves a separate recent %s attempt after acquisition', async outcome => {
    const {live}=await heldEvidence();
    const acquisition=await collectTescoSupervised({mode:'expansion',limit:1,evidenceOnly:true,evidenceIds:[ids[0]]},
      {execute,sleep,fetchPage:vi.fn().mockResolvedValue(live)});
    const [page]=(await db.query<{id:string}>('select id from tesco_direct_collection_pages where run_id=$1',[acquisition.id])).rows;
    await db.query(`insert into tesco_direct_collection_pages(run_id,egress_key,requested_url,mode,outcome)
      values($1,$2,$3,'products',$4)`,[historic,SUPERVISED_GATE,url(),outcome]);
    const [row]=await execute(`select ${reentryEvidenceSql(ids[0],page.id)} evidence`);
    expect(independentExactIdentity(row.evidence as ReentryEvidence)).toBe(false);
    await expect(operationalApproval(page.id)).rejects.toThrow('tesco_recovery_source_identity_not_exact');
  });
  it('does not exempt an unfinished acquisition source', async () => {
    const {live}=await heldEvidence();
    const acquisition=await collectTescoSupervised({mode:'expansion',limit:1,evidenceOnly:true,evidenceIds:[ids[0]]},
      {execute,sleep,fetchPage:vi.fn().mockResolvedValue(live)});
    const [page]=(await db.query<{id:string}>('select id from tesco_direct_collection_pages where run_id=$1',[acquisition.id])).rows;
    await db.query("update scrape_runs set status='running',finished_at=null where id=$1",[acquisition.id]);
    await expect(operationalApproval(page.id)).rejects.toThrow('tesco_recovery_source_identity_not_exact');
  });
  it('does not exempt an unavailable acquisition source for immediate retry', async () => {
    await heldEvidence();
    const acquisition=await collectTescoSupervised({mode:'expansion',limit:1,evidenceOnly:true,evidenceIds:[ids[0]]},
      {execute,sleep,fetchPage:vi.fn().mockResolvedValue(response(0,{isForSale:false}))});
    const [page]=(await db.query<{id:string}>('select id from tesco_direct_collection_pages where run_id=$1',[acquisition.id])).rows;
    await expect(operationalApproval(page.id)).rejects.toThrow('tesco_recovery_source_identity_not_exact');
  });
  async function machineApproval(page: string, overrides: Record<string, unknown> = {}, roleClaims: Record<string, boolean> = {
    tesco_reentry_machine_approver: true,
  }) {
    const [row] = await execute(`select ${reentryEvidenceSql(ids[0],page)} evidence`);
    const evidence = row.evidence as ReentryEvidence;
    const machine = randomUUID(), claimedActor = randomUUID(), review = randomUUID();
    await db.query('insert into auth.users(id) values($1),($2)',[machine,claimedActor]);
    const assessment = {
      decision:'verified_exact',model:'chatgpt-work-audited-identity-inference',
      source:'docs/tesco-hold-reentry-production-queue-20261101.jsonl',
      reason:'Independent matching of Tesco SKU, source barcode, brand, pack and correct retailer peers.',
      mapping_id:ids[0],source_page_id:page,source_body_sha256:evidence.page.body_sha256,
      validation:{independently_exact:true,checks:['unique_sku','source_page','brand','pack','variant','peers']},
      ...overrides,
    };
    await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',machine]);
    await db.query('select set_config($1,$2,false)',
      ['request.jwt.claims',JSON.stringify({sub:machine,role:'authenticated',app_metadata:roleClaims,
        user_metadata:{tesco_reentry_machine_approver:true}})]);
    await db.exec('set role authenticated');
    try {
      await db.query(`insert into tesco_hold_reentry_reviews
        (id,store_product_id,source_page_id,evidence_snapshot,independent_reason,reviewer_id,
         approval_kind,machine_assessment,expires_at)
        values($1,$2,$3,$4,$5,$6,'human',$7,now()+interval '2 days')`,
      [review,ids[0],page,JSON.stringify(evidence),assessment.reason,claimedActor,JSON.stringify(assessment)]);
    } finally {
      await db.exec('reset role');
      await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub','']);
      await db.query('select set_config($1,$2,false)',['request.jwt.claims','']);
    }
    return { review, machine, assessment };
  }
  it('records a bridge-bound evidence decision and consumes it exactly once with live verification',async()=>{
    const {page,live}=await heldEvidence();
    const review=await operationalApproval(page);
    const rows=await db.query<{reviewer_id:string|null;collector_identity:string;approval_kind:string}>(
      'select reviewer_id,collector_identity,approval_kind from tesco_hold_reentry_reviews where id=$1',[review]);
    expect(rows.rows[0]).toEqual({reviewer_id:null,collector_identity:'postgres:supervised_sql_bridge',approval_kind:'collector'});
    expect(await selectReviewedCandidates(execute,[review])).toHaveLength(1);
    expect((await collect(review,live)).result).toMatchObject({result:'complete',inserted:1});
    expect((await db.query('select * from tesco_hold_reentry_uses')).rows).toHaveLength(1);
    expect(await selectReviewedCandidates(execute,[review])).toEqual([]);
    await expect(operationalApproval(page)).rejects.toThrow(); // Now fresh; cannot mint a second decision.
  });
  it('forbids direct collector inserts, ordinary Auth/service role access and old machine-Auth approval',async()=>{
    const {page}=await heldEvidence();
    const [e]=await execute(`select ${reentryEvidenceSql(ids[0],page)} evidence`);
    await expect(db.query(`insert into tesco_hold_reentry_reviews
      (store_product_id,source_page_id,evidence_snapshot,independent_reason,approval_kind,expires_at)
      values($1,$2,$3,$4,'collector',now()+interval '2 days')`,
      [ids[0],page,JSON.stringify(e.evidence),'Pretend unverified direct collector approval should be denied.']))
      .rejects.toThrow('tesco_operational_recovery_function_required');
    for(const role of ['anon','authenticated','service_role']){
      await db.exec(`set role ${role}`);
      try {
        await expect(db.exec(`select tesco_internal.record_verified_hold_reentry(
          '${ids[0]}','${page}','{}'::jsonb,'{}'::jsonb)`)).rejects.toThrow();
      } finally {await db.exec('reset role');}
    }
    expect((await db.query('select * from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
  });
  it('rejects source swaps, tampered snapshots, forged independent claims and material identity conflicts',async()=>{
    const {page}=await heldEvidence();
    const [row]=await execute(`select ${reentryEvidenceSql(ids[0],page)} evidence`);
    await expect(operationalApproval(page,{}, {...row.evidence as object, proven:false})).rejects.toThrow('tesco_recovery_evidence_snapshot_changed');
    await expect(operationalApproval(page,{source_body_sha256:'f'.repeat(64)})).rejects.toThrow('tesco_recovery_assessment_not_bound_to_source');
    await expect(operationalApproval(page,{validation:{independently_exact:false}})).rejects.toThrow('verified_identity_evidence_required');
    await db.query("update store_products set brand='WRONG BRAND' where id=$1",[ids[0]]);
    await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_barcode_or_brand_conflict');
    await db.query("update store_products set brand='TESCO',gtin='9999999999999' where id=$1",[ids[0]]);
    await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_barcode_or_brand_conflict');
    expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
  });
  it('the database rejects incorrect canonical pack, variant and mapped pack even with a forged verified AI verdict',async()=>{
    const {page}=await heldEvidence();
    await db.query("update products set canonical_name='Whole Milk 2L' where id=$1",[products[0]]);
    await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_pack_or_variant_conflict');
    await db.query("update products set canonical_name='Whole Chocolate Milk 1L' where id=$1",[products[0]]);
    await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_pack_or_variant_conflict');
    await db.query("update products set canonical_name='Whole Milk 1L' where id=$1",[products[0]]);
    await db.query("update store_products set store_product_name='Tesco Whole Milk 3L' where id=$1",[ids[0]]);
    await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_pack_or_variant_conflict');
    expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
  });
  it.each([
    ['sized single versus multipack', 'Whole Milk 1L', 'Tesco Whole Milk 6x1L'],
    ['multipack versus sized single', 'Whole Milk 6x1L', 'Tesco Whole Milk 1L'],
  ])('the database rejects %s before recording an operational decision',async(_label,canonical,title)=>{
    const {page}=await heldEvidence({title});
    await db.query('update products set canonical_name=$1 where id=$2',[canonical,products[0]]);
    await db.query('update store_products set store_product_name=$1 where id=$2',[title,ids[0]]);
    // The snapshot is authentic and the assessment claims success. The SQL
    // boundary must independently reject the explicit count contradiction.
    await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_pack_or_variant_conflict');
    expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
  });
  it('the database rejects different explicit can counts before operational approval',async()=>{
    const title='Tesco Cola 8 Cans';
    const {page}=await heldEvidence({title,details:{packSize:[{value:8,units:'each'}]}});
    await db.query('update products set canonical_name=$1 where id=$2',['Tesco Cola 6 Cans',products[0]]);
    await db.query('update store_products set store_product_name=$1 where product_id=$2',[title,products[0]]);
    await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_pack_or_variant_conflict');
    expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
  });
  it.each([
    ['different volume', 2, 'l'],
    ['different measurement dimension', 1000, 'g'],
  ])('the database rejects structured quantity contradicting the source title: %s',async(_label,value,units)=>{
    const {page}=await heldEvidence({details:{packSize:[{value,units}]}});
    await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_pack_or_variant_conflict');
    expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
  });
  it.each(['canonical','source','mapped'] as const)(
    'the database rejects an additional compound quantity in the %s identity',async(location)=>{
      const compound='Tesco Whole Milk 1L + 500ml';
      const {page}=await heldEvidence(location==='source'?{title:compound}:{});
      if(location==='canonical'){
        await db.query('update products set canonical_name=$1 where id=$2',['Whole Milk 1L + 500ml',products[0]]);
      }else{
        await db.query('update store_products set store_product_name=$1 where id=$2',[compound,ids[0]]);
      }
      await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_pack_or_variant_conflict');
      expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
    });
  it.each(['final_url','http_status','body_sha256','source_run_status'] as const)(
    'the database fails closed on missing mandatory retained evidence: %s',async(field)=>{
      const {page}=await heldEvidence();
      if(field==='source_run_status'){
        await db.query(`update scrape_runs set status=null
          where id=(select run_id from tesco_direct_collection_pages where id=$1)`,[page]);
      }else{
        // Identifiers come only from the fixed test-case allowlist above.
        await db.query(`update tesco_direct_collection_pages set ${field}=null where id=$1`,[page]);
      }
      await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_source_identity_not_exact');
      expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
    });
  it.each([
    ['empty object', {}],
    ['numeric string', {millilitres:'1000'}],
    ['multiple measurement units', {millilitres:1000,grams:1000}],
    ['zero quantity', {millilitres:0}],
  ])('the database rejects malformed retained source quantity: %s',async(_label,quantity)=>{
    const {page}=await heldEvidence();
    await db.query(`update tesco_direct_collection_pages
      set parsed=jsonb_set(parsed,'{products,0,quantity}',$2::jsonb) where id=$1`,
    [page,JSON.stringify(quantity)]);
    await expect(operationalApproval(page)).rejects.toThrow('tesco_recovery_source_identity_not_exact');
    expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
  });
  it.each([
    ['six litre multipack', 'Tesco Whole Milk 6x1L', 'Tesco Whole Milk 6x1L', 'TESCO', 6, 'l'],
    ['three weight multipack', 'John West Tuna Steak 3x110g', 'John West Tuna Steak 3x110g', 'John West', 330, 'g'],
    ['decimal volume', 'Ballygowan Still Water 1.5L', 'Ballygowan Still Water 1.5L', 'Ballygowan', 1500, 'ml'],
    ['counted sticks with total weight', 'Pedigree Dentastix Daily Small Dog Treats 7 Pack',
      'Pedigree Dentastix Daily Small Dog Treats 7 Dental Sticks', 'Pedigree', 110, 'g'],
  ])('the database retains exact operational approval for %s',async(_label,canonical,title,brand,value,units)=>{
    const {page}=await heldEvidence({title,brandName:brand,details:{packSize:[{value,units}]}});
    await db.query('update products set canonical_name=$1,brand=$2 where id=$3',[canonical,brand,products[0]]);
    await db.query(`update store_products set store_product_name=$1,brand=$2,is_own_brand=$3
      where id=$4 or (product_id=$5 and store in ('dunnes','supervalu'))`,
    [title,brand,brand==='TESCO',ids[0],products[0]]);
    const review=await operationalApproval(page);
    expect(review).toMatch(/^[0-9a-f-]{36}$/);
    expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(1);
    expect(await selectReviewedCandidates(execute,[review])).toHaveLength(1);
    // Recording a valid decision is still not collection or price recovery.
    expect((await db.query('select store_product_id from latest_prices where store_product_id=$1',[ids[0]])).rows).toHaveLength(0);
  });
  async function authenticatedReviewInsert(
    page: string, actor: string, claimedReviewer: string, permission: boolean,
  ) {
    const [row]=await execute(`select ${reentryEvidenceSql(ids[0],page)} evidence`);
    const review=randomUUID();
    await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',actor]);
    await db.query('select set_config($1,$2,false)',
      ['request.jwt.claims',JSON.stringify({sub:actor,role:'authenticated',
        app_metadata:{tesco_reentry_reviewer:permission}})]);
    await db.exec('set role authenticated');
    try {
      await db.query(`insert into tesco_hold_reentry_reviews
        (id,store_product_id,source_page_id,evidence_snapshot,independent_reason,reviewer_id,expires_at)
        values($1,$2,$3,$4,$5,$6,now()+interval '2 days')`,
      [review,ids[0],page,JSON.stringify(row.evidence),
        'Accountably reviewed the exact canonical identity, barcode, pack and retained source page.',claimedReviewer]);
    } finally {
      await db.exec('reset role');
      await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub','']);
      await db.query('select set_config($1,$2,false)',['request.jwt.claims','']);
    }
    return review;
  }
  async function heldEvidence(changes: Record<string, unknown> = {}) {
    await seed(0, '8 days');
    for (const store of ['dunnes', 'supervalu']) {
      const peer = randomUUID();
      await db.query(`insert into store_products(id,product_id,store,store_sku,store_product_name,brand,url_status)
        values($1,$2,$3,'peer-'||$3,'Whole Milk 1L','Tesco','resolved')`, [peer, products[0], store]);
      await db.query(`insert into price_observations(store_product_id,price,observed_at,source)
        values($1,1.45,now()-interval '2 hours','tesco_direct')`, [peer]);
    }
    const sourceRun = randomUUID(), page = randomUUID();
    await db.query(`insert into scrape_runs(id,store,status,finished_at,error_summary)
      values($1,'tesco','success',now()-interval '2 days','{}')`, [sourceRun]);
    const live = response(0, changes);
    await db.query(`insert into tesco_direct_collection_pages
      (id,run_id,egress_key,requested_url,final_url,mode,outcome,http_status,body_sha256,parsed,identity_results,created_at)
      values($1,$2,$3,$4,$4,'products','ok',200,$5,$6,$7,now()-interval '2 days')`,
    [page,sourceRun,SUPERVISED_GATE,url(),'a'.repeat(64),
      JSON.stringify(parseTescoCollectedPage(live.html, url())),
      JSON.stringify([{ storeProductId: ids[0], sku: sku(), reasons: ['historical_hold'] }])]);
    return { page, live };
  }
  async function approve(page: string) {
    const [e] = await execute(`select ${reentryEvidenceSql(ids[0], page)} evidence`);
    const review = randomUUID(), reviewer = randomUUID();
    await db.query('insert into auth.users(id) values($1)',[reviewer]);
    await db.query('select set_config($1,$2,false)',
      ['request.jwt.claim.sub',reviewer]);
    await db.query('select set_config($1,$2,false)',
      ['request.jwt.claims',JSON.stringify({sub:reviewer,role:'authenticated',
        app_metadata:{tesco_reentry_reviewer:true}})]);
    await db.exec('set role authenticated');
    try {
      await db.query(`insert into tesco_hold_reentry_reviews
        (id,store_product_id,source_page_id,evidence_snapshot,independent_reason,reviewer_id,expires_at)
        values($1,$2,$3,$4,$5,$6,now()+interval '2 days')`,
      [review, ids[0], page, JSON.stringify(e.evidence),
        'Reviewed exact canonical, brand, pack and variant against current evidence and a retained page.',
        reviewer]);
    } finally {
      await db.exec('reset role');
      await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub','']);
      await db.query('select set_config($1,$2,false)',['request.jwt.claims','']);
    }
    return review;
  }
  async function collect(review: string, live: TescoPageResponse) {
    const fetchPage = vi.fn().mockResolvedValue(live);
    const result = await collectTescoSupervised({ mode: 'expansion', limit: 1, reviewedCandidates: [review] },
      { execute, sleep, fetchPage });
    return { result, fetchPage };
  }
  it('binds an approval to the authenticated account, not a caller-supplied reviewer UUID',async()=>{
    const {page}=await heldEvidence();
    const signer=randomUUID(), forged=randomUUID();
    await db.query('insert into auth.users(id) values($1),($2)',[signer,forged]);
    const review=await authenticatedReviewInsert(page,signer,forged,true);
    const result=(await db.query<{reviewer_id:string,approved_at:string}>(
      'select reviewer_id,approved_at from tesco_hold_reentry_reviews where id=$1',[review])).rows[0];
    expect(result.reviewer_id).toBe(signer);
    expect(new Date(result.approved_at).getTime()).toBeLessThanOrEqual(Date.now());
    expect((await selectReviewedCandidates(execute,[review]))).toHaveLength(1);
  });
  it('refuses a signed-in non-reviewer and cannot accept anonymous/service-role approval writes',async()=>{
    const {page}=await heldEvidence();
    const actor=randomUUID();
    await db.query('insert into auth.users(id) values($1)',[actor]);
    await expect(authenticatedReviewInsert(page,actor,actor,false))
      .rejects.toThrow('authenticated_tesco_reentry_reviewer_required');
    for(const role of ['anon','service_role']){
      await db.exec('set role '+role);
      try {
        await expect(db.exec(`insert into tesco_hold_reentry_reviews
          (store_product_id,source_page_id,evidence_snapshot,independent_reason,reviewer_id,expires_at)
          values('${ids[0]}','${page}','{}','A real review must be authenticated and evidence-bound.',
            '${actor}',now()+interval '2 days')`)).rejects.toThrow();
      } finally {await db.exec('reset role');}
    }
    expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
  });
  it('retires the separate machine-Auth route even when that JWT is privileged',async()=>{
    const {page}=await heldEvidence();
    await expect(machineApproval(page)).rejects.toThrow('authenticated_tesco_reentry_reviewer_required');
    expect((await db.query('select id from tesco_hold_reentry_reviews')).rows).toHaveLength(0);
  });
  it('rejects machine approvals with missing or contradictory AI/evidence attestation',async()=>{
    const {page}=await heldEvidence();
    for(const bad of [{decision:'uncertain'},{source_body_sha256:'f'.repeat(64)},
      {validation:{independently_exact:false,checks:[]}},{mapping_id:randomUUID()}]) {
      await expect(machineApproval(page,bad)).rejects.toThrow();
    }
    const count=await db.query<{n:number}>('select count(*) n from tesco_hold_reentry_reviews');
    expect(Number(count.rows[0].n)).toBe(0);
  });
  it('rejects machine privilege forged in user_metadata and ambiguous dual privileged roles',async()=>{
    const {page}=await heldEvidence();
    await expect(machineApproval(page,{},{})).rejects.toThrow('authenticated_tesco_reentry_reviewer_required');
    await expect(machineApproval(page,{},
      {tesco_reentry_machine_approver:true,tesco_reentry_reviewer:true})).rejects.toThrow(
      'authenticated_tesco_reentry_reviewer_required');
  });
  it('converts only exact source-bound prior AI evidence into machine attestation',async()=>{
    const {page}=await heldEvidence();
    const [row]=await execute(`select ${reentryEvidenceSql(ids[0],page)} evidence`);
    const evidence=row.evidence as ReentryEvidence;
    const product=evidence.page.parsed.products[0];
    const manifest:AiReviewedMapping={type:'candidate',
      status:'AI_VERIFIED_PENDING_AUTHENTICATED_HUMAN_APPROVAL_AND_FRESH_LIVE_FETCH',
      sku:sku(),mapping_id:ids[0],source_page_id:page,
      source_body_sha256:evidence.page.body_sha256,
      review_reason:'AI assessed correct Tesco source, exact variant, pack and both verified retailer peers.',
      positive_independent_code_gate:true,
      source_identity:{name:product.name,brand:product.brand ?? '',quantity:product.quantity ?? {}},
      peer_identity:evidence.peers.map(p=>({store:p.store,name:p.store_product_name})),
    };
    const prepare=(v:AiReviewedMapping)=>prepareMachineAssessment(v,evidence,'verified-manifest.jsonl','gpt-work-review');
    expect(prepare(manifest)?.decision).toBe('verified_exact');
    expect(prepare({...manifest,source_body_sha256:'f'.repeat(64)})).toBeNull();
    expect(prepare({...manifest,sku:'555555555'})).toBeNull();
    expect(prepare({...manifest,status:'AI_REJECTED'})).toBeNull();
    expect(prepare({...manifest,peer_identity:[{store:'dunnes',name:'Orange Juice 1L'}]})).toBeNull();
  });
  it('admits an exact held Tesco identity with only one fresh peer after authenticated approval',async()=>{
    const {page,live}=await heldEvidence();
    await db.query('update products set brand=$1 where id=$2',['TESCO',products[0]]);
    await db.exec(`delete from price_observations where store_product_id in
      (select id from store_products where store='supervalu')`);
    const review=await approve(page);
    const rows=await selectReviewedCandidates(execute,[review]);
    expect(rows).toHaveLength(1);
    expect(rows[0].overlap).toBe(1);
    expect((await collect(review,live)).result).toMatchObject({result:'complete',inserted:1});
  });
  it('admits a zero-peer mapping only with an independently matching canonical Tesco barcode',async()=>{
    const gtin='05012345678901';
    const {page,live}=await heldEvidence({gtin});
    await db.exec('alter table products add column ean text');
    await db.query('update products set ean=$1 where id=$2',[gtin,products[0]]);
    await db.exec(`delete from price_observations where store_product_id in
      (select id from store_products where store in ('dunnes','supervalu'))`);
    const review=await approve(page);
    const rows=await selectReviewedCandidates(execute,[review]);
    expect(rows).toHaveLength(1);
    expect(rows[0].overlap).toBe(0);
    expect((await collect(review,live)).result).toMatchObject({result:'complete',inserted:1});
  });
  it('does not admit a zero-peer mapping on historical receipts and Tesco page metadata alone',async()=>{
    const {page,live}=await heldEvidence();
    await db.exec(`delete from price_observations where store_product_id in
      (select id from store_products where store in ('dunnes','supervalu'))`);
    const review=await approve(page);
    expect(await selectReviewedCandidates(execute,[review])).toEqual([]);
    expect((await collect(review,live)).fetchPage).not.toHaveBeenCalled();
  });
  it('returns a successfully recovered held product to ordinary supervised renewal without a new approval',async()=>{
    const {page,live}=await heldEvidence();
    const review=await approve(page);
    expect((await collect(review,live)).result).toMatchObject({result:'complete',inserted:1});
    // Simulate five days elapsed: historical holds precede the latest trusted
    // observation, and new live renewal still validates exact identity.
    await db.exec(`update tesco_direct_collection_pages
      set created_at=created_at-interval '6 days'
      where requested_url='${url()}'`);
    await db.exec(`update price_observations
      set observed_at=now()-interval '5 days'
      where store_product_id='${ids[0]}' and observed_at>now()-interval '1 day'`);
    const due=await selectSupervisedCandidates(execute,'renewal',100,{excludeSharedSku:true});
    expect(due.map(x=>x.id)).toContain(ids[0]);
    expect(due[0].reentry).toBeUndefined();
    // No re-review ID is required; this is the original exact live validator.
    const fetched=vi.fn().mockResolvedValue(live);
    const result=await collectTescoSupervised({mode:'renewal',limit:1},
      {execute,sleep,fetchPage:fetched});
    expect(result).toMatchObject({result:'complete',inserted:1});
    expect(fetched).toHaveBeenCalledTimes(1);
  });
  it('cannot infer exact identity from two fresh peer prices for an unrelated product',async()=>{
    const {page,live}=await heldEvidence();
    await db.exec(`update store_products set store_product_name='Tesco Whole Cream 1L'
      where store in ('dunnes','supervalu')`);
    const review=await approve(page);
    expect(await selectReviewedCandidates(execute,[review])).toEqual([]);
    expect((await collect(review,live)).fetchPage).not.toHaveBeenCalled();
  });
  it('does not trust a contradictory branded peer in a two-peer reviewed mapping',async()=>{
    const {page,live}=await heldEvidence();
    await db.query('update products set brand=$1 where id=$2',['Tesco',products[0]]);
    await db.exec(`update store_products set brand='Other Manufacturer' where store='dunnes'`);
    const review=await approve(page);
    expect(await selectReviewedCandidates(execute,[review])).toEqual([]);
    expect((await collect(review,live)).fetchPage).not.toHaveBeenCalled();
  });
  it('recovers an independently barcoded Tesco offer without asserting a conflicting peer is exact',async()=>{
    const gtin='05012345678901';
    const {page,live}=await heldEvidence({gtin});
    await db.exec('alter table products add column ean text');
    await db.query('update products set ean=$1 where id=$2',[gtin,products[0]]);
    await db.exec(`update store_products set store_product_name='Tesco Vanilla Whole Milk 1L'
      where store='dunnes'`);
    const review=await approve(page);
    expect(await selectReviewedCandidates(execute,[review])).toHaveLength(1);
    expect((await collect(review,live)).result).toMatchObject({result:'complete',inserted:1});
    expect((await db.query("select store_product_name from store_products where store='dunnes'")).rows[0])
      .toEqual({store_product_name:'Tesco Vanilla Whole Milk 1L'});
  });
  it('keeps a past hold and its historical observation, then finalises only a newly fetched verified price once', async () => {
    const { page, live } = await heldEvidence(); const review = await approve(page);
    expect((await selectSupervisedCandidates(execute, 'expansion', 100))).toEqual([]);
    const before = await observations(), dryFetcher = vi.fn();
    expect(await collectTescoSupervised({ mode: 'expansion', reviewedCandidates: [review], dryRun: true },
      { execute, fetchPage: dryFetcher })).toMatchObject({ result: 'dry_run', selected: [{ id: ids[0] }] });
    expect(dryFetcher).not.toHaveBeenCalled();
    const { result, fetchPage } = await collect(review, live);
    expect(result).toMatchObject({ result: 'complete', reserved: 1, completed: 1, inserted: 1 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(await observations()).toHaveLength(before.length + 1);
    const receipt = (await db.query<{detail: string}>(`select detail from tesco_direct_collection_pages where run_id=$1`, [result.id])).rows[0];
    expect(JSON.parse(receipt.detail)).toMatchObject({ purpose: 'audited_hold_reentry', reviewId: review,
      sourcePageId: page, independentlyExact: true });
    expect(await selectReviewedCandidates(execute, [review])).toEqual([]);
    expect((await db.query('select * from tesco_hold_reentry_uses')).rows).toHaveLength(1);
    await db.query(`select finalize_store_scrape_product(p_run_uuid=>$1,p_store=>'tesco',p_store_product_id=>$2,p_success=>true,p_price=>99)`,[result.id,ids[0]]);
    expect(await observations()).toHaveLength(before.length + 1);
  });
  it.each([
    ['incomplete canonical quantity', 'Chilli and Garlic Stir Fry Sauce',
      'Blue Dragon Sweet Chilli & Garlic Stir Fry Sauce 120G', 'Blue Dragon', 120, 'g', 'measureExactnessFailed'],
    ['different exact-name wording', 'Airwick Pure Soft Cotton Aerosol 250ml',
      'Air Wick Pure Aerosol Soft Cotton Air Freshener 250ml', 'AIR WICK', 250, 'ml',
      'candidate does not establish full exact canonical identity'],
  ])('permits audited evidence to resolve %s without exempting other collection modes',
    async (_label, canonical, title, brand, size, units, legacyReason) => {
      const { page, live } = await heldEvidence({ title, brandName: brand,
        details: { packSize: [{ value: size, units }] } });
      await db.query(`update products set canonical_name=$1,brand=$2 where id=$3`,[canonical,brand,products[0]]);
      await db.query(`update store_products set store_product_name=$1,brand=$2,is_own_brand=false where id=$3`,
        [title,brand,ids[0]]);
      await db.query(`update store_products set store_product_name=$1,brand=$2 where store in ('dunnes','supervalu')`,
        [title,brand]);
      const parsed = parseTescoCollectedPage(live.html,url()).products[0];
      const ordinaryReasons = validateTescoCollectedIdentity({ storeProductId: ids[0],
        canonicalName: canonical, canonicalBrand: brand, storeProductName: title, storeBrand: brand,
        isOwnBrand: false, storeSku: sku(), storeUrl: url(), duplicateSkuCount: 1,
        duplicateCanonicalNames: [canonical], isFresh: false }, parsed);
      expect(ordinaryReasons).toContain(legacyReason);
      const review = await approve(page);
      const { result } = await collect(review,live);
      expect(result).toMatchObject({ result: 'complete', inserted: 1 });
      const record = (await db.query<{detail:string}>(`select detail from tesco_direct_collection_pages where run_id=$1`,
        [result.id])).rows[0];
      expect(JSON.parse(record.detail)).toMatchObject({ auditedEvidenceGap: true,
        independentlyExact: true, legacyValidatorReasons: ordinaryReasons });
    });
  it('never treats a conflict, missing price or unexpected validator result as an audited canonical-evidence gap', async () => {
    const { page, live } = await heldEvidence();
    const [row] = await execute(`select ${reentryEvidenceSql(ids[0],page)} evidence`);
    const evidence = row.evidence as ReentryEvidence;
    const product = parseTescoCollectedPage(live.html,url()).products[0];
    for (const reason of ['measureConflict','packCountConflict','brandConflict','brandExactnessFailed',
      'formulationConflict','variantConflict','productTypeConflict','ownLabelConflict',
      'unavailable_or_no_regular_price','different_sku_requires_mapping_review']) {
      expect(reviewedCanonicalEvidenceGap(evidence,product,[reason])).toBe(false);
      expect(reviewedCanonicalEvidenceGap(evidence,product,['measureExactnessFailed',reason])).toBe(false);
    }
    expect(reviewedCanonicalEvidenceGap(evidence,{...product,price:null},['measureExactnessFailed'])).toBe(false);
    expect(reviewedCanonicalEvidenceGap(evidence,{...product,name:'Tesco Vanilla Whole Milk 1L'},
      ['candidate does not establish full exact canonical identity'])).toBe(false);
  });
  it.each([
    ['orange juice versus juice drink', 'Orange Juice 1L', 'Jaffa Gold Orange Juice Drink 1 Litre', 'Jaffa Gold', 1000],
    ['unadvertised citrus variant', 'Flash Kitchen Spray 800ml', 'Flash Kitchen Cleaning Spray Citrus 800ml', 'Flash', 800],
  ])('rejects an actual existing-validator false positive: %s', async (_label, canonical, title, brand, ml) => {
    const { page, live } = await heldEvidence({ title, brandName: brand,
      details: { packSize: [{ value: ml, units: 'ml' }] } });
    await db.query(`update products set canonical_name=$1 where id=$2`, [canonical, products[0]]);
    await db.query(`update store_products set store_product_name=$1,brand=$2,is_own_brand=false where id=$3`,
      [title, brand, ids[0]]);
    const parsed = parseTescoCollectedPage(live.html, url()).products[0];
    expect(validateTescoCollectedIdentity({ storeProductId: ids[0], canonicalName: canonical, canonicalBrand: null,
      storeProductName: title, storeBrand: brand, isOwnBrand: false, storeSku: sku(), storeUrl: url(),
      duplicateSkuCount: 1, duplicateCanonicalNames: [canonical], isFresh: false }, parsed)).toEqual([]);
    const review = await approve(page);
    const { fetchPage, result } = await collect(review, live);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.result).toBe('no_due_products');
    expect((await selectReviewedCandidates(execute,[review]))).toEqual([]);
  });
  it.each([
    ['4 rolls versus 24 standard rolls', 'Andrex Complete Clean Toilet Tissue 4 Roll',
      'Andrex Complete Clean Toilet Tissue 24 Standard Rolls', 'Andrex', 24, 'each'],
    ['single 110g versus 3x110g', 'John West Tuna Steak 110g',
      'John West Tuna Steak 3x110g', 'John West', 110, 'g'],
    ['7 pack versus 4 sticks', 'Pedigree Rodeo Beef 7 Pack',
      'Pedigree Rodeo Beef 4 Sticks 70G', 'Pedigree', 70, 'g'],
    ['4 pack versus 21 dental sticks', 'Pedigree Dentastix Daily Large Dog 4 Pack',
      'Pedigree Dentastix Daily Large Dog Treats 21 Dental Sticks', 'Pedigree', 21, 'each'],
    ['single 18g bar versus 4x18g', 'Cadbury Dairy Milk Little Chocolate Bar 18g',
      'Cadbury Dairy Milk Little Chocolate Bars Multipack 4x18g', 'Cadbury', 18, 'g'],
  ])('blocks held-pack identity mismatch at review selection: %s',
    async (_label, canonical, title, brand, packSize, units) => {
      const { page, live } = await heldEvidence({ title, brandName: brand,
        details: {packSize:[{value:packSize,units}]} });
      await db.query(`update products set canonical_name=$1,brand=$2 where id=$3`,[canonical,brand,products[0]]);
      await db.query(`update store_products set store_product_name=$1,brand=$2,is_own_brand=false where id=$3`,
        [title,brand,ids[0]]);
      await db.query(`update store_products set store_product_name=$1 where store in ('dunnes','supervalu')`,[canonical]);
      const review=await approve(page), {result,fetchPage}=await collect(review,live);
      expect(result.result).toBe('no_due_products');
      expect(fetchPage).not.toHaveBeenCalled();
    });
  it('blocks a freshly reviewed Tesco source when either retailer peer is a conflicting flavour',async()=>{
    const {page,live}=await heldEvidence();
    await db.query(`update store_products set store_product_name='Tesco Vanilla Whole Milk 1L'
      where store='dunnes'`);
    const review=await approve(page);
    const {result,fetchPage}=await collect(review,live);
    expect(result.result).toBe('no_due_products');
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it.each(['1.5L','1.5 Litre','1,5L'])(
    'recognises %s as 1500ml in exact reviewed evidence, not as a 5L product',async measure=>{
      const title=`Ballygowan Hint of Fruit Peach ${measure}`;
      const {page,live}=await heldEvidence({title,brandName:'Ballygowan',
        details:{packSize:[{value:1.5,units:'l'}]}});
      await db.query(`update products set canonical_name=$1,brand='Ballygowan' where id=$2`,
        [title,products[0]]);
      await db.query(`update store_products set store_product_name=$1,brand='Ballygowan',is_own_brand=false
        where id=$2`,[title,ids[0]]);
      await db.query(`update store_products set store_product_name=$1,brand='Ballygowan'
        where store in ('dunnes','supervalu')`,[title]);
      const review=await approve(page);
      const {result}=await collect(review,live);
      expect(result).toMatchObject({result:'complete',inserted:1});
    });
  it.each(['different canonical identity', 'equivalent synonym', 'new shared mapping after approval'])(
    'rejects shared-SKU validator concern: %s', async scenario => {
      const { page, live } = await heldEvidence();
      const review = await approve(page);
      const another = randomUUID(), productId = randomUUID();
      await db.query(`insert into products(id,canonical_name) values($1,$2)`, [productId,
        scenario === 'different canonical identity' ? 'Whole Cream 1L' : 'Whole Milk 1 Litre']);
      await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
        values($1,$2,'tesco',$3,$4,'Tesco Whole Milk 1L','TESCO',true,'resolved')`,
      [another, productId, sku(), url()]);
      const { result, fetchPage } = await collect(review, live);
      expect(result.result).toBe('no_due_products');
      expect(fetchPage).not.toHaveBeenCalled();
    });
  it('a source-page mutation, revocation and past 24h pending request cannot silently inherit approval', async () => {
    const { page, live } = await heldEvidence(); const review = await approve(page);
    await db.query(`update tesco_direct_collection_pages set body_sha256=$1 where id=$2`, ['b'.repeat(64),page]);
    expect((await collect(review,live)).fetchPage).not.toHaveBeenCalled();
    await db.query(`update tesco_direct_collection_pages set body_sha256=$1 where id=$2`, ['a'.repeat(64),page]);
    await db.query(`insert into tesco_hold_reentry_revocations(review_id,revoked_by,reason)
      values($1,'safety-reviewer','Additional identity concern')`,[review]);
    expect((await collect(review,live)).fetchPage).not.toHaveBeenCalled();
    const other = await approve(page);
    const run = randomUUID(); await db.query(`insert into scrape_runs(id,store) values($1,'tesco')`,[run]);
    await db.query(`insert into tesco_direct_collection_pages(run_id,egress_key,requested_url,mode,outcome)
      values($1,$2,$3,'products','pending')`,[run,SUPERVISED_GATE,url()]);
    expect((await collect(other,live)).fetchPage).not.toHaveBeenCalled();
  });
  it.each([
    ['brand', { brandName: 'OTHER' }],
    ['pack', { details: { packSize: [{ value: 2, units: 'l' }] } }],
    ['variant', { title: 'Tesco Whole Milk Vanilla 1L' }],
  ])('holds a changed live %s despite past approval', async (_label, changes) => {
    const { page } = await heldEvidence(); const review = await approve(page);
    const { result } = await collect(review, response(0, changes));
    expect(result).toMatchObject({ inserted: 0, reserved: 1 });
    expect(await observations()).toHaveLength(3);
  });
  it('rejects a changed live barcode even when the old deterministic validator accepts the page', async () => {
    const { page } = await heldEvidence({ gtin:'05012345678901' });
    const review = await approve(page);
    const changed = response(0, { gtin:'05012345678999' });
    const parsed = parseTescoCollectedPage(changed.html, url()).products[0];
    expect(validateTescoCollectedIdentity({storeProductId:ids[0],canonicalName:'Whole Milk 1L',
      canonicalBrand:null,storeProductName:'Tesco Whole Milk 1L',storeBrand:'TESCO',isOwnBrand:true,
      storeSku:sku(),storeUrl:url(),duplicateSkuCount:1,duplicateCanonicalNames:['Whole Milk 1L'],
      isFresh:false},parsed)).toEqual([]);
    const { result } = await collect(review, changed);
    expect(result).toMatchObject({ result:'complete', inserted:0, held:1 });
    expect(await observations()).toHaveLength(3);
  });
  it('rejects a duplicate approval for the same URL and preserves the append-only audit',async()=>{
    const { page }=await heldEvidence();const review=await approve(page), second=await approve(page);
    await expect(selectReviewedCandidates(execute,[review,second])).rejects.toThrow('Overlapping reviewed approvals');
    await expect(db.query(`update tesco_hold_reentry_reviews set independent_reason='rewritten approval'
      where id=$1`,[review])).rejects.toThrow('reentry_audit_append_only');
  });
  it('a changed canonical identity after selection prevents reservation and consumes no approval', async () => {
    const { page, live } = await heldEvidence(); const review = await approve(page);
    const fetchPage = vi.fn().mockResolvedValue(live);
    const sql: ExecuteSql = async q => {
      const rows = await execute(q);
      if (q.startsWith('select v.*,exists(select 1 from tesco_hold_reentry_revocations'))
        await db.query(`update products set canonical_name='Whole Milk 2L' where id=$1`,[products[0]]);
      return rows;
    };
    const selected = await collectTescoSupervised({ mode:'expansion', reviewedCandidates:[review] },
      { execute: sql, sleep, fetchPage });
    expect(selected).toMatchObject({ result: 'interrupted', inserted: 0, unresolved: [] });
    expect(fetchPage).not.toHaveBeenCalled();
    expect((await db.query('select * from tesco_hold_reentry_uses')).rows).toHaveLength(0);
  });
  it('rechecks fresh retailer peers before finalisation after a new live Tesco fetch', async () => {
    const { page, live } = await heldEvidence(); const review = await approve(page);
    const before = await observations();
    const fetchPage = vi.fn(async () => {
      const peer = (await db.query<{id:string}>(`select id from store_products where store='dunnes'`)).rows[0].id;
      await db.query(`insert into price_observations(store_product_id,price,observed_at,source)
        values($1,3.42,now(),'tesco_direct')`,[peer]);
      return live;
    });
    const result = await collectTescoSupervised({ mode:'expansion', reviewedCandidates:[review] },
      { execute, sleep, fetchPage });
    expect(result).toMatchObject({ result:'interrupted', inserted:0, unresolved:[url()] });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    // Only the deliberately added Dunnes observation exists, no Tesco price.
    expect(await observations()).toHaveLength(before.length + 1);
    expect((await db.query('select * from tesco_hold_reentry_uses')).rows).toHaveLength(1);
  });
  it('forbids mixing reviewed approvals with renewal, acquisition or resume', async () => {
    const { page } = await heldEvidence();const review=await approve(page);
    await expect(collectTescoSupervised({mode:'renewal',reviewedCandidates:[review]},{execute}))
      .rejects.toThrow('separate new bounded expansion');
    await expect(collectTescoSupervised({mode:'expansion',reviewedCandidates:[review],acquisitionPages:[page]},{execute}))
      .rejects.toThrow('separate new bounded expansion');
  });
});

describe('explicit acquisition handoff with PostgreSQL finalisation', () => {
  async function acquisition() {
    await seed(0, '8 days');
    await db.exec(`update products set canonical_name='Avonmore Protein Milk Vanilla 1L',brand='Avonmore';
      update store_products set store_product_name='Avonmore Protein Milk Vanilla 1 Litre',brand='Avonmore',is_own_brand=false;`);
    const r = randomUUID(), page = randomUUID();
    const live = response(0, { title: 'Avonmore Protein Milk Vanilla 1 Litre', brandName: 'Avonmore', price: { actual: 3.39 } });
    await db.query(`insert into scrape_runs(id,store,status,finished_at,error_summary) values($1,'tesco','degraded',now(),$2)`,
      [r, JSON.stringify({ protocol: 'tesco-supervised-discovery-v1', pricesAllowed: false, activeSupervisor: null })]);
    await db.query(`insert into tesco_direct_collection_pages(id,run_id,egress_key,requested_url,final_url,mode,outcome,http_status,body_sha256,parsed,identity_results,detail,created_at)
      values($1,$2,$3,$4,$4,'products','ok',200,$5,$6,$7,
        jsonb_build_object('acquisitionOnly',true,'pricesInserted',0,'observedAt',now()-interval '1 second')::text,now()-interval '2 seconds')`,
      [page,r,SUPERVISED_GATE,url(),'a'.repeat(64),JSON.stringify(parseTescoCollectedPage(live.html,url())),JSON.stringify([{storeProductId:ids[0],sku:sku(),reasons:[]}])]);
    return { page, r, live };
  }
  async function handoff(page: string, live: TescoPageResponse, sql = execute) {
    const fetchPage = vi.fn().mockResolvedValue(live);
    const result = await collectTescoSupervised({ mode: 'expansion', limit: 1, acquisitionPages: [page] }, { execute: sql, sleep, fetchPage });
    return { result, fetchPage };
  }
  it('dry-runs a completed source without fetching or changing any evidence', async () => {
    const {page} = await acquisition(); const before = await db.query('select * from tesco_direct_collection_pages');
    const fetchPage = vi.fn();
    const result = await collectTescoSupervised({mode:'expansion',limit:1,acquisitionPages:[page],dryRun:true},{execute,fetchPage});
    expect(result.selected).toHaveLength(1); expect(fetchPage).not.toHaveBeenCalled();
    expect(await db.query('select * from tesco_direct_collection_pages')).toEqual(before);
  });
  it('retains acquisition and old observation, reserves one new price request, and finalises once', async () => {
    const {page,live}=await acquisition(); const before=await observations();
    const source=(await db.query('select * from tesco_direct_collection_pages where id=$1',[page])).rows;
    const {result,fetchPage}=await handoff(page,live);
    expect(result).toMatchObject({result:'complete',reserved:1,completed:1,inserted:1}); expect(fetchPage).toHaveBeenCalledTimes(1);
    expect((await observations())[0]).toEqual(before[0]); expect(await observations()).toHaveLength(2);
    expect((await observations())[1].price).toBe('3.39');
    expect((await db.query('select * from tesco_direct_collection_pages where id=$1',[page])).rows).toEqual(source);
    const newPage=(await db.query<{detail:string}>('select detail from tesco_direct_collection_pages where run_id=$1',[result.id])).rows[0];
    expect(JSON.parse(newPage.detail)).toMatchObject({purpose:'price_verification',sourceAcquisitionPageId:page});
    expect(await selectAcquisitionCandidates(execute,[page])).toEqual([]);
    await db.query(`select finalize_store_scrape_product(p_run_uuid=>$1,p_store=>'tesco',p_store_product_id=>$2,p_success=>true,p_price=>99)`,[result.id,ids[0]]);
    expect(await observations()).toHaveLength(2);
  });
  it.each(['pending','network_error'] as const)('never exempts a separate %s request',async outcome=>{
    const {page,live,r}=await acquisition();
    const other=randomUUID();await db.query(`insert into scrape_runs(id,store) values($1,'tesco')`,[other]);
    await db.query(`insert into tesco_direct_collection_pages(run_id,egress_key,requested_url,mode,outcome) values($1,$2,$3,'products',$4)`,[other,SUPERVISED_GATE,url(),outcome]);
    const {fetchPage,result}=await handoff(page,live);expect(fetchPage).not.toHaveBeenCalled();expect(result.result).toBe('no_due_products');
    expect((await db.query<{n:number}>('select count(*)::int n from tesco_direct_collection_pages where run_id=$1',[r])).rows[0].n).toBe(1);
  });
  it('leaves an interrupted new price request held across restart and reselection',async()=>{
    const {page}=await acquisition();
    const first=await collectTescoSupervised({mode:'expansion',acquisitionPages:[page]},{execute,sleep,fetchPage:vi.fn().mockRejectedValue(new Error('lost'))});
    expect(first).toMatchObject({result:'interrupted',inserted:0,unresolved:[url()]});
    expect(await selectAcquisitionCandidates(execute,[page])).toEqual([]);
    expect(await collectTescoSupervised({mode:'expansion',resume:String(first.id)},{execute})).toMatchObject({result:'unresolved_attempts'});
  });
  it('reconciles lost finalisation acknowledgement without a second fetch or duplicate',async()=>{
    const {page,live}=await acquisition();let lost=false;
    const flaky:ExecuteSql=async sql=>{const rows=await execute(sql);if(!lost&&sql.endsWith('select 1 checkpointed')){lost=true;throw new Error('lost ack');}return rows;};
    const {result}=await handoff(page,live,flaky);expect(result).toMatchObject({inserted:1,unresolved:[]});
    const before=await observations(),fetchPage=vi.fn();
    await collectTescoSupervised({mode:'expansion',resume:String(result.id)},{execute,sleep,fetchPage});
    expect(fetchPage).not.toHaveBeenCalled();expect(await observations()).toEqual(before);
  });
  it('rechecks source evidence before reservation after selection',async()=>{
    const {page,live}=await acquisition();
    const sql:ExecuteSql=async q=>{const rows=await execute(q);if(q.endsWith(' snapshot'))await db.query('update tesco_direct_collection_pages set body_sha256=$1 where id=$2',['b'.repeat(64),page]);return rows;};
    const {result,fetchPage}=await handoff(page,live,sql);expect(result.result).toBe('interrupted');expect(fetchPage).not.toHaveBeenCalled();
  });
  it('rejects a changed live flavour instead of accepting the acquisition price',async()=>{
    const {page}=await acquisition();const live=response(0,{title:'Avonmore Protein Milk Chocolate 1 Litre',brandName:'Avonmore'});
    const {result}=await handoff(page,live);expect(result).toMatchObject({result:'identity_validation_anomaly',inserted:0});expect(await observations()).toHaveLength(1);
  });
  it('retains access restriction cooldowns on the new price request',async()=>{
    const {page,live}=await acquisition();const {result}=await handoff(page,{...live,outcome:'access_block',status:403,html:'Denied'});
    expect(result).toMatchObject({result:'access_block',inserted:0});expect(Date.parse(String((await gate()).cooldown_until))).toBeGreaterThan(Date.now());
    expect(await selectAcquisitionCandidates(execute,[page])).toEqual([]);
  });
  it('requires the prior-success policy and forbids mixing acquisition with renewal',async()=>{
    const {page,live}=await acquisition();await db.query('delete from scrape_product_receipts where store_product_id=$1',[ids[0]]);
    expect((await handoff(page,live)).fetchPage).not.toHaveBeenCalled();
    await expect(collectTescoSupervised({mode:'renewal',acquisitionPages:[page]},{execute})).rejects.toThrow('new bounded expansion');
  });
  it.each(['pending_source','active_source','missing_acquisition_purpose','invalid_timestamp','bad_hash'])(
    'fails closed on %s',async issue=>{
      const {page,r,live}=await acquisition();
      if(issue==='pending_source')await db.query("update tesco_direct_collection_pages set outcome='pending' where id=$1",[page]);
      if(issue==='active_source')await db.query("update scrape_runs set status='running',finished_at=null where id=$1",[r]);
      if(issue==='missing_acquisition_purpose')await db.query("update tesco_direct_collection_pages set detail='{}' where id=$1",[page]);
      if(issue==='invalid_timestamp')await db.query("update tesco_direct_collection_pages set detail=(detail::jsonb||jsonb_build_object('observedAt','invalid'))::text where id=$1",[page]);
      if(issue==='bad_hash')await db.query("update tesco_direct_collection_pages set body_sha256='invalid' where id=$1",[page]);
      expect((await handoff(page,live)).fetchPage).not.toHaveBeenCalled();
    });
  it('fails finalisation if a peer changes while the new live request is in flight',async()=>{
    const {page,live}=await acquisition(),before=await observations();
    const fetchPage=vi.fn(async()=>{
      await db.query(`insert into store_products(id,product_id,store,store_product_name,brand) values($1,$2,'dunnes','Avonmore Protein Milk Vanilla 2L','Avonmore')`,[randomUUID(),products[0]]);
      return live;
    });
    const result=await collectTescoSupervised({mode:'expansion',acquisitionPages:[page]},{execute,sleep,fetchPage});
    expect(result).toMatchObject({result:'interrupted',inserted:0,unresolved:[url()]});expect(await observations()).toEqual(before);
  });
  it.each(['leased_until','cooldown_until'])('preserves the %s collection gate',async field=>{
    const {page,live}=await acquisition();await db.exec(`update tesco_egress_pool set ${field}=now()+interval '10 minutes'`);
    await expect(handoff(page,live)).rejects.toThrow('gate_unavailable');expect(await observations()).toHaveLength(1);
  });
});

describe('ordinary mapping selection only narrows eligibility', () => {
  it('filters before the limit and fetches only the selected eligible mapping', async () => {
    await seed(0,'8 days'); await seed(1,'8 days');
    const target=ids[0]>ids[1]?0:1;
    expect((await selectSupervisedCandidates(execute,'expansion',1,{mappingIds:[ids[target].toUpperCase()]})).map(x=>x.id))
      .toEqual([ids[target]]);
    const fetchPage=vi.fn().mockResolvedValue(response(target));
    const result=await collectTescoSupervised({mode:'expansion',limit:1,mappingIds:[ids[target]],excludeSharedSku:true},
      {execute,sleep,fetchPage});
    expect(result).toMatchObject({result:'complete',reserved:1,completed:1,inserted:1});
    expect(fetchPage.mock.calls.map(x=>x[0])).toEqual([url(target)]);
    expect((await db.query<{store_product_id:string}>('select store_product_id from scrape_product_receipts where run_id=$1',[result.id])).rows)
      .toEqual([{store_product_id:ids[target]}]);
  });
  it.each(['pending','recent','failed','unproven','shared','fresh'])('does not override an ordinary %s exclusion',async kind=>{
    await seed(0,kind==='fresh'?'1 day':'8 days'); await seed(1,'8 days');
    if(kind==='pending'||kind==='recent')await db.query(`insert into tesco_direct_collection_pages(run_id,egress_key,requested_url,mode,outcome,created_at)
      values($1,$2,$3,'products',$4,now()-$5::interval)`,[historic,SUPERVISED_GATE,url(),kind==='pending'?'pending':'ok',kind==='pending'?'2 days':'1 hour']);
    if(kind==='failed')await db.query("update store_products set url_status='failed' where id=$1",[ids[0]]);
    if(kind==='unproven')await db.query('delete from scrape_product_receipts where store_product_id=$1',[ids[0]]);
    if(kind==='shared')await db.query('update store_products set store_sku=$1,store_url=$2 where id=$3',[sku(),url(),ids[1]]);
    const fetchPage=vi.fn();
    expect(await collectTescoSupervised({mode:'expansion',limit:1,mappingIds:[ids[0]],excludeSharedSku:true},
      {execute,sleep,fetchPage})).toMatchObject({result:'no_due_products'});
    expect(fetchPage).not.toHaveBeenCalled();
    expect((await gate()).leased_until).toBeNull();
  });
  it('rejects invalid selections and mixing collection lanes before any SQL',async()=>{
    const sql=vi.fn(),fetchPage=vi.fn();
    for(const mappingIds of [[],[ids[0],ids[0]],[ids[0],ids[0].toUpperCase()],['invalid'],[ids[0],ids[1]]])
      await expect(collectTescoSupervised({mode:'expansion',limit:1,mappingIds},{execute:sql,fetchPage})).rejects.toThrow();
    await expect(selectSupervisedCandidates(sql,'expansion',100,{mappingIds:Array.from({length:11},()=>randomUUID())})).rejects.toThrow();
    for(const lane of [{resume:historic},{reviewedCandidates:[historic]},{acquisitionPages:[historic]},
      {evidenceOnly:true,evidenceIds:[ids[0]]},{evidenceIds:[ids[0]]}])
      await expect(collectTescoSupervised({mode:'expansion',limit:1,mappingIds:[ids[0]],...lane},{execute:sql,fetchPage})).rejects.toThrow('cannot be mixed');
    expect(sql).not.toHaveBeenCalled(); expect(fetchPage).not.toHaveBeenCalled();
  });
});

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
    // A measure mismatch is now an ORDINARY product-level hold: the product is
    // held (no observation, prior row unchanged) and the batch CONTINUES to the
    // next eligible product, which renews normally.
    await seed(0, '6 days'); await seed(1); const before = await observations();
    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(
      u === url(0)
        ? response(0, { title: 'Tesco Whole Milk 2L', details: { packSize: [{ value: 2, units: 'l' }] } })
        : response(1)));
    expect(await run(fetcher)).toMatchObject({ result: 'complete', inserted: 1, completed: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    // Held product 0 kept its earlier observation; product 1 gained a new one.
    const after = await observations();
    expect(after.filter(o => o.store_product_id === ids[0])).toEqual(before.filter(o => o.store_product_id === ids[0]));
    expect(after.filter(o => o.store_product_id === ids[1]).length).toBe(2);
    // The held product's page records the identity reasons and no price write.
    const heldPage = (await db.query<Record<string, unknown>>(
      `select outcome, identity_results from tesco_direct_collection_pages where requested_url=$1`, [url(0)])).rows[0];
    expect(heldPage.outcome).toBe('ok');
    expect(JSON.stringify(heldPage.identity_results)).toContain('measure');
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

// ---------------------------------------------------------------------------
// Batch continuation on ordinary identity mismatches (hold-and-continue).
// Exercises the REAL collector + PGlite finaliser/evidence schema.
// ---------------------------------------------------------------------------
describe('hold-and-continue batch policy (PostgreSQL)', () => {
  // Seed N expansion candidates: proven (success receipt) + NO fresh price so
  // expansion mode selects them (observed_at IS NULL).
  async function seedExpansion(n: number) {
    for (let i = 0; i < n; i++) {
      const pid = randomUUID(); const sid = randomUUID();
      await db.query(`insert into products values($1,'Whole Milk 1L',null)`, [pid]);
      await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
        values($1,$2,'tesco',$3,$4,'Tesco Whole Milk 1L','TESCO',true,'resolved')`,
        [sid, pid, String(900000 + i), `https://www.tesco.ie/shop/en-IE/products/${900000 + i}`]);
      // proven, but NO price_observations row -> expansion-eligible, not renewal.
      await db.query(`insert into scrape_runs(id,store,run_id,status) values($1,'tesco',$2,'success')`,
        [randomUUID(), `legacy_${i}`]);
      await db.query(`insert into scrape_product_receipts(run_id,store_product_id,outcome)
        select id,$1,'success' from scrape_runs where run_id=$2`, [sid, `legacy_${i}`]);
    }
  }
  const eurl = (i: number) => `https://www.tesco.ie/shop/en-IE/products/${900000 + i}`;
  const esku = (i: number) => String(900000 + i);
  // A valid (accepting) response for expansion product i.
  function eok(i: number): TescoPageResponse {
    const product = { id: esku(i), tpnc: esku(i), title: 'Tesco Whole Milk 1L', brandName: 'TESCO',
      price: { actual: 1.29 }, isForSale: true, status: 'AvailableForSale',
      details: { packSize: [{ value: 1, units: 'l' }] } };
    return { outcome: 'ok', status: 200, finalUrl: eurl(i), retryAfter: null, elapsedMs: 400,
      html: `<p>€1.29</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': {
        props: { config: { global: { locale: 'en-IE' } }, apolloCache: {
          ROOT_QUERY: { [`product({"tpnc":"${esku(i)}"})`]: { __ref: 'p' } }, p: product } } } })}</script>` };
  }
  // A measure-mismatch (ordinary hold) response for product i: 2L vs 1L canonical.
  function emeasure(i: number): TescoPageResponse {
    const r = eok(i); return { ...r, html: r.html.replace('"value":1,"units":"l"', '"value":2,"units":"l"')
      .replace('Whole Milk 1L', 'Whole Milk 2L') };
  }
  async function runExp(fetchPage: Mock<(u: string) => Promise<TescoPageResponse>>, limit = 25) {
    return collectTescoSupervised({ mode: 'expansion', limit }, { execute, sleep, fetchPage });
  }
  async function summary(runId: string) {
    const r = (await db.query<Record<string, unknown>>(`select error_summary from scrape_runs where id=$1`, [runId])).rows[0];
    return JSON.parse(String(r.error_summary));
  }

  it('holds ordinary mismatches and still finalises the accepted products (interspersed)', async () => {
    await seedExpansion(4);
    // products are selected by overlap/id; drive per-URL: 0 accept, 1 hold, 2 accept, 3 hold.
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const i = Number(u.split('/').pop()) - 900000;
      return Promise.resolve(i === 1 || i === 3 ? emeasure(i) : eok(i));
    });
    const result = await runExp(fetcher);
    expect(result).toMatchObject({ result: 'complete' });
    // 2 accepted observations; 2 held with no observation.
    const obs = await db.query(`select store_product_id from price_observations`);
    expect(obs.rows.length).toBe(2);
    const held = await db.query(`select requested_url from tesco_direct_collection_pages where outcome='ok'
      and identity_results::text like '%measure%'`);
    expect(held.rows.length).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('never writes an observation for a held (failed-identity) product', async () => {
    await seedExpansion(1);
    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(emeasure(Number(u.split('/').pop()) - 900000)));
    await runExp(fetcher);
    expect((await db.query(`select count(*)::int n from price_observations`)).rows[0]).toEqual({ n: 0 });
    // The page is checkpointed with the rejection (durable), not left pending.
    const page = (await db.query<Record<string, unknown>>(`select outcome from tesco_direct_collection_pages`)).rows[0];
    expect(page.outcome).toBe('ok');
  });

  it('tolerates 3 consecutive ordinary holds and continues (below the raised threshold)', async () => {
    // 3 holds then 2 accepts: with MAX_CONSECUTIVE_HOLDS=5 this no longer trips the
    // consecutive breaker, and 3/5=60% hold rate is NOT evaluated (below 10 attempts)
    // -> the batch COMPLETES. (Under the old limit of 3 this would have stopped.)
    await seedExpansion(5);
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const n = fetcher.mock.calls.length - 1; // 0-based position
      const i = Number(u.split('/').pop()) - 900000;
      return Promise.resolve(n < 3 ? emeasure(i) : eok(i));
    });
    const result = await runExp(fetcher);
    expect(result).toMatchObject({ result: 'complete' });
    expect(fetcher).toHaveBeenCalledTimes(5);
    const s = await summary(String((result as Record<string, unknown>).id));
    expect(s.totalHolds).toBe(3);
  });

  it('tolerates 4 consecutive ordinary holds and continues (below the raised threshold)', async () => {
    // 4 holds then 2 accepts: still below MAX_CONSECUTIVE_HOLDS=5, and 4/6=67% hold
    // rate is NOT evaluated (6 < 10 attempts) -> COMPLETES.
    await seedExpansion(6);
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const n = fetcher.mock.calls.length - 1;
      const i = Number(u.split('/').pop()) - 900000;
      return Promise.resolve(n < 4 ? emeasure(i) : eok(i));
    });
    const result = await runExp(fetcher);
    expect(result).toMatchObject({ result: 'complete' });
    expect(fetcher).toHaveBeenCalledTimes(6);
    const s = await summary(String((result as Record<string, unknown>).id));
    expect(s.totalHolds).toBe(4);
  });

  it('trips the CONSECUTIVE breaker after 5 holds and stops', async () => {
    await seedExpansion(8);
    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(emeasure(Number(u.split('/').pop()) - 900000)));
    const result = await runExp(fetcher);
    expect(result).toMatchObject({ result: 'identity_hold_consecutive_exceeded' });
    // Exactly 5 attempts before the breaker stops the batch (rate breaker needs
    // >=10 attempts, so consecutive fires first).
    expect(fetcher).toHaveBeenCalledTimes(5);
    const runId = String((result as Record<string, unknown>).id);
    const s = await summary(runId);
    expect(s.consecutiveHolds).toBe(5);
    expect(s.stopReason).toBe('identity_hold_consecutive_exceeded');
  });

  it('resets the consecutive counter on an acceptance (accept between holds)', async () => {
    await seedExpansion(9);
    // Pattern keyed by fetch order: hold,hold,hold,hold,accept,hold,... -> an accept
    // at position 5 resets the run of 4 holds, so 5 consecutive is never reached and
    // the hold rate stays below 10 attempts -> COMPLETES.
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const n = fetcher.mock.calls.length - 1;
      const i = Number(u.split('/').pop()) - 900000;
      const hold = n !== 4 && n !== 8; // accept only at positions 4 and 8
      return Promise.resolve(hold ? emeasure(i) : eok(i));
    });
    const result = await runExp(fetcher);
    expect(result).toMatchObject({ result: 'complete' });
    expect(fetcher).toHaveBeenCalledTimes(9);
  });

  it('trips the RATE breaker above 40% holds after at least 10 attempts', async () => {
    await seedExpansion(14);
    // Deterministic on FETCH ORDER (not product index, whose selection order can
    // vary): pattern hold,hold,accept repeating = 2/3 holds, consecutive max 2 so
    // the consecutive breaker (3) never fires; the rate breaker (>40% after >=10)
    // trips instead. Keyed by call count for a stable sequence.
    const pattern = [true, true, false]; // hold, hold, accept
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const i = Number(u.split('/').pop()) - 900000;
      const n = fetcher.mock.calls.length - 1; // 0-based position in this batch
      return Promise.resolve(pattern[n % 3] ? emeasure(i) : eok(i));
    });
    const result = await runExp(fetcher);
    expect((result as Record<string, unknown>).result).toBe('identity_hold_rate_exceeded');
    const s = await summary(String((result as Record<string, unknown>).id));
    expect(s.attempts).toBeGreaterThanOrEqual(10);
    expect(s.totalHolds / s.attempts).toBeGreaterThan(0.4);
  });

  it('stops the batch on a SYSTEMIC identity reason (requested SKU absent -> missing_exact_product)', async () => {
    // The first-selected product's page parses to a VALID but DIFFERENT product
    // (its structured SKU matches the page URL, but that URL is not the target's).
    // Served via the target URL, the target SKU is absent from the parsed set ->
    // 'missing_exact_product' -> systemic stop (fail-closed), NOT an ordinary hold.
    await seedExpansion(3);
    let firstUrl = '';
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const i = Number(u.split('/').pop()) - 900000;
      if (!firstUrl) firstUrl = u;
      if (u === firstUrl) {
        // A page whose finalUrl is for a DIFFERENT sku than requested: parser keys
        // off finalUrl's sku, returns that product; target sku not found.
        const other = 920000 + i;
        const product = { id: String(other), tpnc: String(other), title: 'Tesco Whole Milk 1L', brandName: 'TESCO',
          price: { actual: 1.29 }, isForSale: true, status: 'AvailableForSale',
          details: { packSize: [{ value: 1, units: 'l' }] } };
        return Promise.resolve({ outcome: 'ok', status: 200,
          finalUrl: `https://www.tesco.ie/shop/en-IE/products/${other}`, retryAfter: null, elapsedMs: 400,
          html: `<p>€1.29</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': {
            props: { config: { global: { locale: 'en-IE' } }, apolloCache: {
              ROOT_QUERY: { [`product({"tpnc":"${other}"})`]: { __ref: 'p' } }, p: product } } } })}</script>` } as TescoPageResponse);
      }
      return Promise.resolve(eok(i));
    });
    const result = await runExp(fetcher);
    expect((result as Record<string, unknown>).result).toBe('identity_validation_anomaly');
    expect(fetcher).toHaveBeenCalledTimes(1); // stopped on the first product
    expect((await db.query(`select count(*)::int n from price_observations`)).rows[0]).toEqual({ n: 0 });
  });

  it('persists breaker counters so resume cannot reset or bypass them', async () => {
    await seedExpansion(6);
    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(emeasure(Number(u.split('/').pop()) - 900000)));
    const first = await runExp(fetcher);
    expect(first).toMatchObject({ result: 'identity_hold_consecutive_exceeded' });
    const runId = String((first as Record<string, unknown>).id);
    // A terminal (non-interrupted) run cannot be resumed.
    const resume = await collectTescoSupervised({ mode: 'expansion', resume: runId }, { execute, sleep, fetchPage: fetcher });
    expect(resume).toMatchObject({ result: 'terminal_run' });
  });

  // --- Material duplicate-canonical conflict must HARD STOP (masking bug) ------
  // Seed a same-SKU group: several DISTINCT canonical products share one SKU, so
  // target.peers has >1 non-equivalent name. The fetched live product differs in
  // measure/variant from the selected mapping, so the ordinary validator returns
  // an attribute conflict FIRST; the independent duplicate-group check must still
  // force a stop.
  async function seedDupGroup(sku: string, canonicalNames: string[], storeName: string, liveTitle: string) {
    for (const name of canonicalNames) {
      const pid = randomUUID(); const sid = randomUUID();
      await db.query(`insert into products values($1,$2,null)`, [pid, name]);
      await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
        values($1,$2,'tesco',$3,$4,$5,'TESCO',true,'resolved')`,
        [sid, pid, sku, `https://www.tesco.ie/shop/en-IE/products/${sku}`, storeName]);
      await db.query(`insert into scrape_runs(id,store,run_id,status) values($1,'tesco',$2,'success')`, [randomUUID(), `leg_${sid}`]);
      await db.query(`insert into scrape_product_receipts(run_id,store_product_id,outcome) select id,$1,'success' from scrape_runs where run_id=$2`, [sid, `leg_${sid}`]);
    }
    const u = `https://www.tesco.ie/shop/en-IE/products/${sku}`;
    const product = { id: sku, tpnc: sku, title: liveTitle, brandName: 'TESCO',
      price: { actual: 1.29 }, isForSale: true, status: 'AvailableForSale',
      details: { packSize: [{ value: 1, units: 'l' }] } };
    const page: TescoPageResponse = { outcome: 'ok', status: 200, finalUrl: u, retryAfter: null, elapsedMs: 400,
      html: `<p>€1.29</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': {
        props: { config: { global: { locale: 'en-IE' } }, apolloCache: {
          ROOT_QUERY: { [`product({"tpnc":"${sku}"})`]: { __ref: 'p' } }, p: product } } } })}</script>` };
    return { page };
  }

  it('REAL SKU 308828886: distinct flavours on one SKU STOP, not hold-and-continue', async () => {
    const { page } = await seedDupGroup('308828886',
      ['Yogurt Rice Cakes 100g', 'Mixed Berry Yogurt Rice Cakes 96g', 'Sweet Chilli Rice Cakes'],
      'Tesco Yogurt Coated Rice Cakes', 'Tesco Yogurt Coated Rice Cakes 1L');
    const fetcher = vi.fn().mockResolvedValue(page);
    const result = await runExp(fetcher);
    // Material duplicate-canonical conflict -> hard stop (NOT a hold-continue),
    // even though ordinary measure/variant conflicts are present.
    expect((result as Record<string, unknown>).result).toBe('identity_validation_anomaly');
    expect((await db.query(`select count(*)::int n from price_observations`)).rows[0]).toEqual({ n: 0 });
  });

  it('REAL SKU 306647106: distinct Lenor scents on one SKU STOP, not hold-and-continue', async () => {
    const { page } = await seedDupGroup('306647106',
      ['Lenor Spring Awakening Tumble Dryer 34 Sheets 110g', 'Lenor Summer Breeze Tumble Dryer 34 Sheets 110g'],
      'Lenor Tumbler Dryer Sheets Spring Awakening', 'Lenor Tumbler Dryer Sheets Spring Awakening 1L');
    const fetcher = vi.fn().mockResolvedValue(page);
    const result = await runExp(fetcher);
    expect((result as Record<string, unknown>).result).toBe('identity_validation_anomaly');
    expect((await db.query(`select count(*)::int n from price_observations`)).rows[0]).toEqual({ n: 0 });
  });

  // (Genuine-synonym preservation is covered at unit level in
  // tesco-material-duplicate.test.ts and tesco-identity-disposition.test.ts:
  // equivalent-term-set groups are NOT flagged as material conflicts, so an
  // ordinary mismatch on them remains hold_continue. The integration harness
  // cannot cleanly seed two distinct canonical mappings on ONE SKU/URL without
  // the same-URL reservation guard interfering, so the distinction is asserted
  // in the pure unit tests rather than duplicated fragilely here.)

  // --- Strengthened breaker persistence + lost-ack ----------------------------
  it('resumes after an interruption past acknowledged holds without resetting counters', async () => {
    await seedExpansion(6);
    // Hold product 1 and 2 (acknowledged), then throw on the 3rd checkpoint so the
    // run interrupts AFTER two durable holds.
    let checkpoints = 0;
    const flaky: ExecuteSql = async (sql) => {
      if (sql.endsWith('select 1 checkpointed')) {
        checkpoints += 1;
        if (checkpoints === 3) { await execute(sql); throw new Error('ack lost after 3rd hold'); }
      }
      return execute(sql);
    };
    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(emeasure(Number(u.split('/').pop()) - 900000)));
    const first = await collectTescoSupervised({ mode: 'expansion', limit: 25 }, { execute: flaky, sleep, fetchPage: fetcher });
    expect((first as Record<string, unknown>).result).toBe('interrupted');
    const runId = String((first as Record<string, unknown>).id);
    const s1 = await summary(runId);
    // Two holds were durably acknowledged (3rd ack lost but checkpoint committed).
    expect(s1.totalHolds).toBeGreaterThanOrEqual(2);
    const priorTotal = s1.totalHolds;
    const priorConsecutive = s1.consecutiveHolds;
    // Resume: counters must be SEEDED from prior state, not reset. One more hold
    // should trip the consecutive breaker (prior consecutive + continued holds).
    const resumed = await collectTescoSupervised({ mode: 'expansion', resume: runId }, { execute, sleep, fetchPage: fetcher });
    const s2 = await summary(runId);
    expect(s2.totalHolds).toBeGreaterThanOrEqual(priorTotal); // cumulative, never reset
    expect(s2.consecutiveHolds).toBeGreaterThanOrEqual(priorConsecutive);
    expect(['identity_hold_consecutive_exceeded', 'identity_hold_rate_exceeded', 'complete', 'unresolved_attempts'])
      .toContain((resumed as Record<string, unknown>).result);
  });

  it('a lost hold-checkpoint acknowledgement stops collection (interrupted)', async () => {
    await seedExpansion(4);
    // Throw on the FIRST hold checkpoint's acknowledgement.
    let done = false;
    const flaky: ExecuteSql = async (sql) => {
      const r = await execute(sql);
      if (!done && sql.endsWith('select 1 checkpointed')) { done = true; throw new Error('hold ack lost'); }
      return r;
    };
    const fetcher = vi.fn().mockImplementation((u: string) => Promise.resolve(emeasure(Number(u.split('/').pop()) - 900000)));
    const result = await collectTescoSupervised({ mode: 'expansion', limit: 25 }, { execute: flaky, sleep, fetchPage: fetcher });
    // Lost ack -> interrupted; it did NOT continue to further products on an
    // unacknowledged checkpoint.
    expect((result as Record<string, unknown>).result).toBe('interrupted');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await db.query(`select count(*)::int n from price_observations`)).rows[0]).toEqual({ n: 0 });
  });
});

// ---------------------------------------------------------------------------
// Batch URL/SKU uniqueness: two canonical mappings sharing one SKU/URL must
// never both be selected (which would cause a second request or an
// attempt_already_recorded interruption). Dedup happens BEFORE the limit.
// ---------------------------------------------------------------------------
describe('selectSupervisedCandidates — one request per URL per batch', () => {
  // Seed `n` renewal-due products, each a DISTINCT unique SKU.
  async function seedUnique(n: number, age = '6 days') {
    for (let i = 0; i < n; i++) {
      const pid = randomUUID(); const sid = randomUUID();
      await db.query(`insert into products values($1,$2,null)`, [pid, `Product ${i}`]);
      await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
        values($1,$2,'tesco',$3,$4,$5,'TESCO',true,'resolved')`,
        [sid, pid, String(500000 + i), `https://www.tesco.ie/shop/en-IE/products/${500000 + i}`, `Product ${i}`]);
      await db.query(`insert into price_observations(store_product_id,price,observed_at,source)
        values($1,1.15,now()-$2::interval,'tesco_direct')`, [sid, age]);
      await db.query(`insert into scrape_runs(id,store,run_id,status) values($1,'tesco',$2,'success')`, [randomUUID(), `u_${i}`]);
      await db.query(`insert into scrape_product_receipts(run_id,store_product_id,outcome) select id,$1,'success' from scrape_runs where run_id=$2`, [sid, `u_${i}`]);
    }
  }
  // Add M EXTRA canonical mappings all sharing SKU `sku` (same URL), each
  // renewal-due + proven -> without dedup they would all be selected.
  async function addSharedSku(sku: number, m: number, age = '6 days') {
    for (let k = 0; k < m; k++) {
      const pid = randomUUID(); const sid = randomUUID();
      await db.query(`insert into products values($1,$2,null)`, [pid, `Shared ${sku} v${k}`]);
      await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
        values($1,$2,'tesco',$3,$4,$5,'TESCO',true,'resolved')`,
        [sid, pid, String(sku), `https://www.tesco.ie/shop/en-IE/products/${sku}`, `Shared ${sku}`]);
      await db.query(`insert into price_observations(store_product_id,price,observed_at,source)
        values($1,1.15,now()-$2::interval,'tesco_direct')`, [sid, age]);
      await db.query(`insert into scrape_runs(id,store,run_id,status) values($1,'tesco',$2,'success')`, [randomUUID(), `s_${sku}_${k}`]);
      await db.query(`insert into scrape_product_receipts(run_id,store_product_id,outcome) select id,$1,'success' from scrape_runs where run_id=$2`, [sid, `s_${sku}_${k}`]);
    }
  }

  it('returns exactly one candidate per URL even when 3 mappings share a SKU', async () => {
    await seedUnique(2);              // 2 unique products
    await addSharedSku(500000, 2);    // 2 EXTRA mappings sharing product 0's SKU/URL
    const sel = await selectSupervisedCandidates(execute, 'renewal', 100);
    const urls = sel.map(c => c.store_url);
    expect(new Set(urls).size).toBe(urls.length); // all URLs distinct
    // product 0's URL appears exactly once despite 3 mappings on it.
    expect(urls.filter(u => u.endsWith('/500000')).length).toBe(1);
    expect(urls.length).toBe(2);
  });

  it('dedups BEFORE the limit so the batch is filled with distinct URLs', async () => {
    // 3 shared mappings on one URL + 3 unique URLs; a limit of 3 must return 3
    // DISTINCT URLs, not be partly consumed by duplicates of a single URL.
    await addSharedSku(500000, 3);
    await seedUnique(3);
    const sel = await selectSupervisedCandidates(execute, 'renewal', 3);
    expect(sel.length).toBe(3);
    expect(new Set(sel.map(c => c.store_url)).size).toBe(3);
  });

  it('preserves renewal ordering (oldest observed_at first) after dedup', async () => {
    async function one(sku: number, age: string) {
      const pid = randomUUID(); const sid = randomUUID();
      await db.query(`insert into products values($1,$2,null)`, [pid, `P${sku}`]);
      await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
        values($1,$2,'tesco',$3,$4,$5,'TESCO',true,'resolved')`, [sid, pid, String(sku), `https://www.tesco.ie/shop/en-IE/products/${sku}`, `P${sku}`]);
      await db.query(`insert into price_observations(store_product_id,price,observed_at,source) values($1,1.15,now()-$2::interval,'tesco_direct')`, [sid, age]);
      await db.query(`insert into scrape_runs(id,store,run_id,status) values($1,'tesco',$2,'success')`, [randomUUID(), `o_${sku}`]);
      await db.query(`insert into scrape_product_receipts(run_id,store_product_id,outcome) select id,$1,'success' from scrape_runs where run_id=$2`, [sid, `o_${sku}`]);
      return sid;
    }
    await one(510001, '6 days'); // older, still within the 7-day fresh window + due
    await one(510002, '5 days'); // newer
    const sel = await selectSupervisedCandidates(execute, 'renewal', 100);
    // oldest observed_at first; ordering preserved through the dedup CTE.
    expect(sel.length).toBe(2);
    expect(sel[0].store_url.endsWith('/510001')).toBe(true);
    expect(sel[1].store_url.endsWith('/510002')).toBe(true);
    const t0 = Date.parse(String(sel[0].observed_at));
    const t1 = Date.parse(String(sel[1].observed_at));
    expect(t0).toBeLessThan(t1);
  });

  it('a full batch over a shared-SKU group makes ONE request per URL (no attempt_already_recorded)', async () => {
    // Two mappings share one SKU/URL + one unique product. A live run must request
    // each URL once and finalise the valid ones, with NO interruption.
    await addSharedSku(520000, 2);   // shared URL /520000 (two canonical mappings)
    await seedUnique(1);             // unique URL /500000
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const skuStr = u.split('/').pop()!;
      const product = { id: skuStr, tpnc: skuStr, title: skuStr.startsWith('52') ? 'Shared 520000' : 'Product 0',
        brandName: 'TESCO', price: { actual: 1.29 }, isForSale: true, status: 'AvailableForSale',
        details: { packSize: [{ value: 1, units: 'l' }] } };
      return Promise.resolve({ outcome: 'ok', status: 200, finalUrl: u, retryAfter: null, elapsedMs: 400,
        html: `<p>€1.29</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': {
          props: { config: { global: { locale: 'en-IE' } }, apolloCache: {
            ROOT_QUERY: { [`product({"tpnc":"${skuStr}"})`]: { __ref: 'p' } }, p: product } } } })}</script>` } as TescoPageResponse);
    });
    const result = await collectTescoSupervised({ mode: 'renewal', limit: 25 }, { execute, sleep, fetchPage: fetcher });
    // No attempt_already_recorded interruption: result is a clean terminal state.
    expect((result as Record<string, unknown>).result).not.toBe('interrupted');
    // Each distinct URL requested at most once.
    const requested = fetcher.mock.calls.map(c => c[0]);
    expect(new Set(requested).size).toBe(requested.length);
    expect(requested.filter(u => u.endsWith('/520000')).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Quarantine-and-continue: an isolated, product-confined canonical-identity
// rejection (the Heinz case) is durably rejected/held and skipped, and the next
// eligible product is still requested. Systemic anomalies must still hard-stop.
// ---------------------------------------------------------------------------
describe('quarantine-and-continue (PostgreSQL, Heinz case)', () => {
  // Seed an expansion-eligible product with an arbitrary canonical name + sku.
  async function seedProduct(sku: number, canonicalName: string) {
    const pid = randomUUID(); const sid = randomUUID();
    await db.query(`insert into products values($1,$2,null)`, [pid, canonicalName]);
    await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
      values($1,$2,'tesco',$3,$4,$5,'TESCO',false,'resolved')`,
      [sid, pid, String(sku), `https://www.tesco.ie/shop/en-IE/products/${sku}`, canonicalName]);
    await db.query(`insert into scrape_runs(id,store,run_id,status) values($1,'tesco',$2,'success')`, [randomUUID(), `q_${sku}`]);
    await db.query(`insert into scrape_product_receipts(run_id,store_product_id,outcome) select id,$1,'success' from scrape_runs where run_id=$2`, [sid, `q_${sku}`]);
    return sid;
  }
  // A clean ok page whose live title is a DIFFERENT product than the canonical,
  // so the live title does not cover the canonical terms -> ambiguous canonical
  // identity ('candidate does not establish full exact canonical identity').
  function pageWithTitle(sku: number, title: string): TescoPageResponse {
    const s = String(sku);
    const product = { id: s, tpnc: s, title, brandName: 'Heinz', price: { actual: 1.89 },
      isForSale: true, status: 'AvailableForSale', details: { packSize: [{ value: 200, units: 'g' }] } };
    return { outcome: 'ok', status: 200, finalUrl: `https://www.tesco.ie/shop/en-IE/products/${sku}`, retryAfter: null, elapsedMs: 400,
      html: `<p>€1.89</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': {
        props: { config: { global: { locale: 'en-IE' } }, apolloCache: {
          ROOT_QUERY: { [`product({"tpnc":"${s}"})`]: { __ref: 'p' } }, p: product } } } })}</script>` };
  }
  function cleanMilk(sku: number): TescoPageResponse {
    const s = String(sku);
    const product = { id: s, tpnc: s, title: 'Tesco Whole Milk 1L', brandName: 'TESCO', price: { actual: 1.29 },
      isForSale: true, status: 'AvailableForSale', details: { packSize: [{ value: 1, units: 'l' }] } };
    return { outcome: 'ok', status: 200, finalUrl: `https://www.tesco.ie/shop/en-IE/products/${sku}`, retryAfter: null, elapsedMs: 400,
      html: `<p>€1.29</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': {
        props: { config: { global: { locale: 'en-IE' } }, apolloCache: {
          ROOT_QUERY: { [`product({"tpnc":"${s}"})`]: { __ref: 'p' } }, p: product } } } })}</script>` };
  }
  const run = (f: Mock<(u: string) => Promise<TescoPageResponse>>, limit = 25) =>
    collectTescoSupervised({ mode: 'expansion', limit }, { execute, sleep, fetchPage: f });

  it('quarantines the Heinz product (durably held, never accepted) and continues to the next', async () => {
    // Heinz: canonical "By Nature Chicken Dinner 7+ Months" vs live "Sunday
    // Chicken Dinner" -> ambiguous canonical identity. Unique SKU (not shared).
    const heinz = await seedProduct(264880549, 'Heinz By Nature Chicken Dinner 7+ Months 200g');
    await seedProduct(264880550, 'Whole Milk 1L'); // a clean next product
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const sku = Number(u.split('/').pop());
      return Promise.resolve(sku === 264880549
        ? pageWithTitle(sku, 'Heinz Sunday Chicken Dinner Baby Food Jar 200g')
        : cleanMilk(sku));
    });
    const result = await run(fetcher);
    // Campaign-safe: the batch completed (did NOT terminate on the Heinz quarantine).
    expect((result as Record<string, unknown>).result).toBe('complete');
    // Both products were requested (Heinz quarantined, next one accepted).
    expect(fetcher).toHaveBeenCalledTimes(2);
    // The clean milk product produced a trusted observation; Heinz did NOT.
    const obs = await db.query<Record<string, unknown>>(`select store_product_id from price_observations where source='tesco_direct'`);
    expect(obs.rows.map(r => r.store_product_id)).not.toContain(heinz);
    expect(obs.rows.length).toBe(1);
    // Heinz page durably checkpointed as a quarantine with the identity reason.
    const page = (await db.query<Record<string, unknown>>(
      `select outcome, detail, identity_results from tesco_direct_collection_pages where requested_url=$1`,
      ['https://www.tesco.ie/shop/en-IE/products/264880549'])).rows[0];
    expect(page.outcome).toBe('ok');
    const detail = typeof page.detail === 'string' ? JSON.parse(page.detail) : page.detail;
    expect(detail.quarantined).toBe(true);
    expect(detail.disposition).toBe('quarantine_continue');
    expect(JSON.stringify(page.identity_results)).toContain('full exact canonical identity');
  });

  it('a long run of quarantines trips the SEPARATE quarantine breaker (not the hold breaker)', async () => {
    // 8 distinct ambiguous-canonical products -> 8 consecutive quarantines ->
    // quarantine breaker (MAX_CONSECUTIVE_QUARANTINES=8). The hold breaker (5)
    // must NOT be what stops it.
    for (let i = 0; i < 9; i++) await seedProduct(265000000 + i, `Heinz By Nature Variant ${i} 7+ Months 200g`);
    const fetcher = vi.fn().mockImplementation((u: string) => {
      const sku = Number(u.split('/').pop());
      return Promise.resolve(pageWithTitle(sku, 'Heinz Sunday Chicken Dinner Baby Food Jar 200g'));
    });
    const result = await run(fetcher);
    expect((result as Record<string, unknown>).result).toBe('identity_quarantine_consecutive_exceeded');
    expect(fetcher).toHaveBeenCalledTimes(8); // stopped at the 8th consecutive quarantine
    const s = await summaryQ(String((result as Record<string, unknown>).id));
    expect(s.consecutiveQuarantines).toBe(8);
    // No observations written for any quarantined product.
    expect((await db.query(`select count(*)::int n from price_observations where source='tesco_direct'`)).rows[0]).toEqual({ n: 0 });
  });

  it('STOPS (reconcilable) if the mapping snapshot changes after reservation, before a quarantine checkpoint', async () => {
    // A single Heinz quarantine candidate (unique SKU, ambiguous canonical
    // identity). The fetch of its URL mutates its same-SKU mapping
    // (store_product_name, part of the snapshot) AFTER reservation but BEFORE
    // checkpoint, so the checkpoint's assertSnapshot must raise mapping_changed
    // and interrupt. Seeding ONLY this product keeps the batch deterministic (a
    // second product's accept/skip ordering is irrelevant to what this proves).
    const heinz = await seedProduct(264880549, 'Heinz By Nature Chicken Dinner 7+ Months 200g');
    const fetcher = vi.fn().mockImplementation(async (u: string) => {
      const sku = Number(u.split('/').pop());
      // Change the mapping evidence mid-flight (part of the snapshot).
      await db.query(`update store_products set store_product_name='Changed After Reservation' where id=$1`, [heinz]);
      return pageWithTitle(sku, 'Heinz Sunday Chicken Dinner Baby Food Jar 200g');
    });
    const result = await run(fetcher) as Record<string, unknown>;
    // The run INTERRUPTS instead of quarantining-and-continuing.
    expect(result.result).toBe('interrupted');
    // The Heinz request remains reconcilable: its page row is still 'pending'
    // (the aborted checkpoint rolled back) -> an unknown-outcome request, not a
    // silently-skipped quarantine.
    const page = (await db.query<Record<string, unknown>>(
      `select outcome from tesco_direct_collection_pages where requested_url=$1`,
      ['https://www.tesco.ie/shop/en-IE/products/264880549'])).rows[0];
    expect(page.outcome).toBe('pending');
    expect(result.unresolved).toContain('https://www.tesco.ie/shop/en-IE/products/264880549');
    // No price written: the checkpoint aborted before any finalisation.
    expect((await db.query(`select count(*)::int n from price_observations where source='tesco_direct'`)).rows[0]).toEqual({ n: 0 });
    // Resume returns unresolved_attempts and performs no request (reconcilable).
    const resume = await collectTescoSupervised({ mode: 'expansion', resume: String(result.id) }, { execute, sleep, fetchPage: vi.fn() });
    expect((resume as Record<string, unknown>).result).toBe('unresolved_attempts');
  });

  it('a SYSTEMIC reason alongside the ambiguous one still hard-stops (fail-closed)', async () => {
    // A shared-SKU group (material duplicate-canonical) with distinct identities
    // -> material conflict forces stop even though each is also ambiguous.
    const pid1 = randomUUID(), pid2 = randomUUID(), s1 = randomUUID(), s2 = randomUUID();
    await db.query(`insert into products values($1,'Heinz By Nature Chicken Dinner 7+ Months 200g',null)`, [pid1]);
    await db.query(`insert into products values($1,'Heinz Sunday Beef Dinner 7+ Months 200g',null)`, [pid2]);
    for (const [sid, pid] of [[s1, pid1], [s2, pid2]] as const) {
      await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,is_own_brand,url_status)
        values($1,$2,'tesco','265999999',$3,'Heinz Dinner','Heinz',false,'resolved')`,
        [sid, pid, 'https://www.tesco.ie/shop/en-IE/products/265999999']);
      await db.query(`insert into scrape_runs(id,store,run_id,status) values($1,'tesco',$2,'success')`, [randomUUID(), `qs_${sid}`]);
      await db.query(`insert into scrape_product_receipts(run_id,store_product_id,outcome) select id,$1,'success' from scrape_runs where run_id=$2`, [sid, `qs_${sid}`]);
    }
    const fetcher = vi.fn().mockResolvedValue(pageWithTitle(265999999, 'Heinz Sunday Chicken Dinner Baby Food Jar 200g'));
    const result = await run(fetcher);
    // Material duplicate-canonical conflict -> hard stop, NOT a quarantine.
    expect((result as Record<string, unknown>).result).toBe('identity_validation_anomaly');
    expect((await db.query(`select count(*)::int n from price_observations where source='tesco_direct'`)).rows[0]).toEqual({ n: 0 });
  });

  async function summaryQ(runId: string) {
    const r = (await db.query<Record<string, unknown>>(`select error_summary from scrape_runs where id=$1`, [runId])).rows[0];
    return JSON.parse(String(r.error_summary));
  }
});

describe('supervised evidence-only acquisition', () => {
  it('captures fresh source evidence without a price receipt or observation', async () => {
    await seed(0,'8 days');
    const before=await observations();
    const queries:string[]=[];
    const sql:ExecuteSql=async q=>{queries.push(q);return execute(q);};
    const result=await collectTescoSupervised({mode:'expansion',limit:1,evidenceOnly:true,evidenceIds:[ids[0]]},
      {execute:sql,sleep,fetchPage:vi.fn().mockResolvedValue(response())});
    expect(result).toMatchObject({result:'complete',completed:1,inserted:0,unresolved:[]});
    expect(await observations()).toEqual(before);
    expect(queries.some(q=>q.includes('perform finalize_store_scrape_product'))).toBe(false);
    await expect(db.query(`select finalize_store_scrape_product(p_run_uuid=>$1,p_store=>'tesco',p_store_product_id=>$2,
      p_success=>true,p_price=>99)`,[result.id,ids[0]])).rejects.toThrow('evidence_only_price_forbidden');
    expect(await observations()).toEqual(before);
    const [page]=(await db.query<{body_sha256:string;detail:string}>('select body_sha256,detail from tesco_direct_collection_pages where run_id=$1',[result.id])).rows;
    expect(page.body_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(page.detail)).toMatchObject({acquisitionOnly:true,pricesInserted:0,purpose:'identity_evidence'});
    expect((result.summary as {evidenceOnly:boolean}).evidenceOnly).toBe(true);
    await expect(collectTescoSupervised({mode:'expansion',resume:String(result.id)},{execute,sleep})).rejects.toThrow('protocol or mode differs');
    const fetchPage=vi.fn();
    expect(await collectTescoSupervised({mode:'expansion',limit:1},{execute,sleep,fetchPage})).toMatchObject({result:'no_due_products'});
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it('captures a failed mapping for review without repairing its status or writing a price', async () => {
    await seed(0,'8 days');
    await db.query("update store_products set url_status='failed' where id=$1",[ids[0]]);
    const before=await observations();
    const result=await collectTescoSupervised({mode:'expansion',limit:1,evidenceOnly:true,evidenceIds:[ids[0]]},
      {execute,sleep,fetchPage:vi.fn().mockResolvedValue(response())});
    expect(result).toMatchObject({result:'complete',completed:1,inserted:0});
    expect((await db.query<{url_status:string}>('select url_status from store_products where id=$1',[ids[0]])).rows[0].url_status).toBe('failed');
    expect(await observations()).toEqual(before);
  });
  it.each(['pending','network_error'])('excludes protected pending and recent requests (%s)', async outcome => {
    await seed(0,'8 days');
    await db.query(`insert into tesco_direct_collection_pages(run_id,egress_key,requested_url,mode,outcome,created_at)
      values($1,$2,$3,'products',$4,now()-$5::interval)`,[historic,SUPERVISED_GATE,url(),outcome,outcome==='pending'?'2 days':'1 hour']);
    const fetchPage=vi.fn();
    expect(await collectTescoSupervised({mode:'expansion',limit:1,evidenceOnly:true,evidenceIds:[ids[0]]},{execute,sleep,fetchPage})).toMatchObject({result:'no_due_products'});
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it('excludes shared SKUs and mappings without prior successful receipts', async () => {
    await seed(0,'8 days');await seed(1,'8 days');
    await db.query('update store_products set store_sku=$1,store_url=$2 where id=$3',[sku(),url(),ids[1]]);
    const fetchPage=vi.fn();
    expect(await collectTescoSupervised({mode:'expansion',limit:2,evidenceOnly:true,evidenceIds:[ids[0],ids[1]]},{execute,sleep,fetchPage})).toMatchObject({result:'no_due_products'});
    await db.query('update store_products set store_sku=$1,store_url=$2 where id=$3',[sku(1),url(1),ids[1]]);
    await db.query('delete from scrape_product_receipts where store_product_id=$1',[ids[0]]);
    expect(await collectTescoSupervised({mode:'expansion',limit:1,evidenceOnly:true,evidenceIds:[ids[0]]},{execute,sleep,fetchPage})).toMatchObject({result:'no_due_products'});
    expect(fetchPage).not.toHaveBeenCalled();
  });
  it('preserves an unknown evidence request across resume and forbids a purpose switch', async () => {
    await seed(0,'8 days');
    const result=await collectTescoSupervised({mode:'expansion',limit:1,evidenceOnly:true,evidenceIds:[ids[0]]},
      {execute,sleep,fetchPage:vi.fn().mockRejectedValue(new Error('lost response'))});
    expect(result).toMatchObject({result:'interrupted',unresolved:[url()],inserted:0});
    expect(await collectTescoSupervised({mode:'expansion',evidenceOnly:true,limit:1,resume:String(result.id)},{execute,sleep})).toMatchObject({result:'unresolved_attempts'});
    await expect(collectTescoSupervised({mode:'expansion',resume:String(result.id)},{execute,sleep})).rejects.toThrow('protocol or mode differs');
  });
  it('requires explicit bounded mappings and prevents approval mixing', async () => {
    for (const options of [
      {mode:'renewal' as const,evidenceOnly:true,evidenceIds:[ids[0]]},
      {mode:'expansion' as const,evidenceOnly:true,limit:11,evidenceIds:[ids[0]]},
      {mode:'expansion' as const,evidenceOnly:true,limit:1},
      {mode:'expansion' as const,evidenceOnly:true,limit:1,evidenceIds:[ids[0]],reviewedCandidates:[randomUUID()]},
    ]) await expect(collectTescoSupervised(options,{execute})).rejects.toThrow('Evidence acquisition requires');
  });
});
