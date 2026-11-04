import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { repairContextSql, activationContextSql, supportedRepairHint, supportedRepairActivation,
  stageRepairSql, activateRepairSql, type RepairContext, type ActivationContext } from './tesco-evidence-repair';
let db:PGlite,mapping:string,canonical:string,hint:string,source:string;
const oldSku='111111111',newSku='222222222';
const url=(s:string)=>`https://www.tesco.ie/shop/en-IE/products/${s}`;
const reason='Independent manufacturer, tomato recipe and complete 100g pack agree with the retained retailer peer evidence.';
const product=()=>({sku:newSku,url:url(newSku),gtin:'05012345678901',name:'Example Tomato Soup 100g',brand:'Example',
  price:2,currency:'EUR',quantity:{grams:100},available:true});
async function execute(sql:string){return (await db.exec(sql)).at(-1)!.rows as Record<string,unknown>[];}
async function context(){return (await db.query<{context:RepairContext}>(`select ${repairContextSql(mapping,hint,newSku)} context`)).rows[0].context;}
async function activation(audit:string){return (await db.query<{context:ActivationContext}>(`select ${activationContextSql(audit,source)} context`)).rows[0].context;}
async function stage(){const c=await context();return String((await execute(stageRepairSql(c,reason)))[0].audit_id);}
async function currentSource(changes:Record<string,unknown>={}){
  const run=randomUUID();source=randomUUID();
  await db.query(`insert into scrape_runs(id,store,run_id,status,started_at,finished_at,error_summary)
    values($1,'tesco',$2,'running',now()-interval '2 minutes',null,$3)`,
  [run,`tesco_supervised_evidence_${run}`,JSON.stringify({evidenceOnly:true,activeSupervisor:null})]);
  await db.query(`insert into tesco_direct_collection_pages(id,run_id,requested_url,final_url,mode,outcome,http_status,
    body_sha256,parsed,detail,created_at) values($1,$2,$3,$3,'products','ok',200,$4,$5,$6,now())`,
  [source,run,url(newSku),'b'.repeat(64),JSON.stringify({listing:null,products:[{...product(),...changes}]}),
    JSON.stringify({acquisitionOnly:true,pricesInserted:0})]);
  await db.query("update scrape_runs set status='success',finished_at=now() where id=$1",[run]);
}
beforeEach(async()=>{
  db=new PGlite();mapping=randomUUID();canonical=randomUUID();hint=randomUUID();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema tesco_internal;
    create table products(id uuid primary key,canonical_name text,brand text,ean text);
    create table store_products(id uuid primary key,product_id uuid,store text,store_sku text,store_url text,
      store_product_name text,brand text,gtin text,url_status text,is_own_brand boolean default false);
    create table price_observations(id uuid default gen_random_uuid(),store_product_id uuid,price numeric,observed_at timestamptz);
    create view latest_prices as select store_product_id,price,observed_at from price_observations where observed_at>now()-interval '7 days';
    create table scrape_product_receipts(run_id uuid,store_product_id uuid,outcome text);
    create table scrape_runs(id uuid primary key,store text,run_id text,status text,started_at timestamptz,finished_at timestamptz,error_summary text);
    create table tesco_egress_pool(egress_key text,enabled boolean,leased_until timestamptz,cooldown_until timestamptz);
    insert into tesco_egress_pool values('workspace-supervised-20260929',false,null,null);
    create table tesco_direct_collection_pages(id uuid primary key,run_id uuid,requested_url text,final_url text,
      mode text,outcome text,http_status int,body_sha256 text,parsed jsonb,detail text,created_at timestamptz default now());`);
  const ddl=readFileSync('supabase/migrations/20260920152656_audit_and_invalidate_tesco_mappings.sql','utf8').split('with targets')[0];
  await db.exec(ddl);
  await db.exec(readFileSync('supabase/migrations/20261104134000_tesco_evidence_pack_totals.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261104123500_tesco_reviewed_evidence_followup.sql','utf8')
    .split('create or replace function tesco_internal.record_verified_hold_reentry')[0]);
  await db.query('insert into products values($1,$2,$3,null)',[canonical,'Example Tomato Soup 100g','Example']);
  await db.query(`insert into store_products(id,product_id,store,store_sku,store_url,store_product_name,brand,gtin,url_status)
    values($1,$2,'tesco',$3,$4,'Example Pea Soup 100g','Example','05000000000000','resolved')`,[mapping,canonical,oldSku,url(oldSku)]);
  const peer=randomUUID();
  await db.query(`insert into store_products(id,product_id,store,store_sku,store_product_name,brand,url_status)
    values($1,$2,'dunnes','12345','Example Tomato Soup 100g','Example','resolved')`,[peer,canonical]);
  await db.query('insert into price_observations values(default,$1,2,now())',[peer]);
  await db.query("insert into price_observations values(default,$1,1,now()-interval '10 days')",[mapping]);
  await db.query("insert into scrape_product_receipts values($1,$2,'success')",[randomUUID(),mapping]);
  await db.query(`insert into tesco_direct_collection_pages(id,requested_url,final_url,mode,outcome,http_status,body_sha256,parsed,created_at)
    values($1,$2,$2,'listings','ok',200,$3,$4,now()-interval '30 days')`,
  [hint,'https://www.tesco.ie/shop/en-IE/search?query=Example','a'.repeat(64),JSON.stringify({listing:{page:1},products:[{...product(),quantity:null}]})]);
});
afterEach(async()=>{await db.close();});
describe('evidence-first Tesco mapping repair transactions',()=>{
  it('stages an unverified target as failed with zero price writes, then activates only a fresh verified source',async()=>{
    const before=await db.query('select * from price_observations order by id');
    const audit=await stage();
    expect((await db.query<{url_status:string}>('select url_status from store_products where id=$1',[mapping])).rows[0].url_status).toBe('failed');
    expect((await db.query('select * from price_observations order by id')).rows).toEqual(before.rows);
    await currentSource();const c=await activation(audit);
    expect(supportedRepairActivation(c)).toBe(true);
    await execute(activateRepairSql(c,reason));
    expect((await db.query<{url_status:string;gtin:string}>('select url_status,gtin from store_products where id=$1',[mapping])).rows[0])
      .toEqual({url_status:'resolved',gtin:product().gtin});
    expect((await db.query('select * from price_observations order by id')).rows).toEqual(before.rows);
    const audits=(await db.query<{prior_mapping:Record<string,unknown>}>('select prior_mapping from retailer_mapping_audit_decisions order by decided_at')).rows;
    expect(audits).toHaveLength(2);
    expect((audits[0].prior_mapping.original as RepairContext).offer.store_sku).toBe(oldSku);
    expect((await db.query('select * from scrape_product_receipts')).rows).toHaveLength(1);
  });
  it.each(['old_pending','new_pending','old_shared','destination_owned','fresh_price','canonical_barcode','different_recipe'])
    ('rejects an unsafe provisional target: %s',async(which)=>{
      if(which.endsWith('pending'))await db.query("insert into tesco_direct_collection_pages(id,requested_url,outcome) values($1,$2,'pending')",[randomUUID(),url(which==='old_pending'?oldSku:newSku)]);
      if(which==='old_shared'||which==='destination_owned')await db.query("insert into store_products(id,product_id,store,store_sku) values($1,$2,'tesco',$3)",[randomUUID(),randomUUID(),which==='old_shared'?oldSku:newSku]);
      if(which==='fresh_price')await db.query('insert into price_observations values(default,$1,2,now())',[mapping]);
      if(which==='canonical_barcode')await db.query("update products set ean='05999999999999'");
      if(which==='different_recipe')await db.query("update tesco_direct_collection_pages set parsed=jsonb_set(parsed,'{products,0,name}','\"Example Pea Soup 100g\"'::jsonb) where id=$1",[hint]);
      const c=await context();expect(supportedRepairHint(c)).toBe(false);
      expect(()=>stageRepairSql(c,reason)).toThrow();
      expect((await db.query('select * from retailer_mapping_audit_decisions')).rows).toHaveLength(0);
    });
  it('rejects retailer own-label repair hints',async()=>{
    const c=await context();
    expect(supportedRepairHint({...c,offer:{...c.offer,is_own_brand:true}})).toBe(false);
    expect(supportedRepairHint({...c,canonical:{...c.canonical,brand:'Tesco'}})).toBe(false);
  });
  it('requires the corroborating peer to agree on an explicit packing medium',async()=>{
    const c=await context();
    c.canonical.canonical_name='Example Tuna Steak In Springwater 100g';
    c.hint.product!.name='Example Tuna Steak In Spring Water 100g';
    c.peers[0].store_product_name='Example Tuna Steak In Brine 100g';
    expect(supportedRepairHint(c)).toBe(false);
  });
  it('rejects a destination acquired after preflight atomically',async()=>{
    const c=await context(),sql=stageRepairSql(c,reason);
    await db.query("insert into store_products(id,product_id,store,store_sku) values($1,$2,'tesco',$3)",[randomUUID(),randomUUID(),newSku]);
    await expect(execute(sql)).rejects.toThrow('repair_snapshot_changed');
    expect((await db.query<{store_sku:string}>('select store_sku from store_products where id=$1',[mapping])).rows[0].store_sku).toBe(oldSku);
  });
  it.each([{available:false},{quantity:null},{quantity:{grams:200}},{brand:'Different'},
    {gtin:'05999999999999'},{name:'Example Pea Soup 100g'}])('does not activate conflicting or incomplete fresh evidence %j',async(changes)=>{
      const audit=await stage();await currentSource(changes);const c=await activation(audit);
      expect(supportedRepairActivation(c)).toBe(false);expect(()=>activateRepairSql(c,reason)).toThrow();
      expect((await db.query<{url_status:string}>('select url_status from store_products where id=$1',[mapping])).rows[0].url_status).toBe('failed');
    });
  it('preserves a separate historical pending request and refuses activation',async()=>{
    const audit=await stage();await currentSource();
    await db.query("insert into tesco_direct_collection_pages(id,requested_url,outcome,created_at) values($1,$2,'pending',now()-interval '2 days')",[randomUUID(),url(oldSku)]);
    expect(supportedRepairActivation(await activation(audit))).toBe(false);
    expect((await db.query("select * from tesco_direct_collection_pages where outcome='pending'")).rows).toHaveLength(1);
  });
  it('does not activate an unfinished or failed acquisition run',async()=>{
    const audit=await stage();await currentSource();
    await db.exec("update scrape_runs set status='degraded'");
    expect(supportedRepairActivation(await activation(audit))).toBe(false);
  });
  it('refuses activation when the staged mapping or canonical identity has changed',async()=>{
    const audit=await stage();await currentSource();const c=await activation(audit),sql=activateRepairSql(c,reason);
    await db.exec("update products set canonical_name='Example Different Soup 100g'");
    await expect(execute(sql)).rejects.toThrow('repair_snapshot_changed');
    expect(supportedRepairActivation(await activation(audit))).toBe(false);
  });
  it('respects active leases and cooldowns without changing them',async()=>{
    const c=await context(),sql=stageRepairSql(c,reason);
    await db.exec("update tesco_egress_pool set cooldown_until=now()+interval '1 hour'");
    await expect(execute(sql)).rejects.toThrow('repair_gate_busy');
    expect((await db.query<{paused:boolean}>('select cooldown_until>now() paused from tesco_egress_pool')).rows[0].paused).toBe(true);
  });
  it('does not repeat a target attempt made after the retained hint',async()=>{
    await db.query("insert into tesco_direct_collection_pages(id,requested_url,outcome,created_at) values($1,$2,'http_error',now()-interval '2 days')",[randomUUID(),url(newSku)]);
    const c=await context();expect(c.recent).toBe(false);expect(c.target_stopped).toBe(true);
    expect(supportedRepairHint(c)).toBe(false);
  });
  it('does not treat a pre-staging source as a new acquisition',async()=>{
    const audit=await stage();await currentSource();
    await db.exec("update scrape_runs set started_at=now()-interval '2 days';update tesco_direct_collection_pages set created_at=now()-interval '1 day' where mode='products'");
    const c=await activation(audit);expect(c.completed_source).toBe(true);
    expect(supportedRepairActivation(c)).toBe(false);
  });
  it('protects a SKU-less mapping linked to a pending supervised run',async()=>{
    await db.query("update store_products set store_sku=null,store_url=null,url_status='failed' where id=$1",[mapping]);
    const run=randomUUID();
    await db.query("insert into scrape_runs(id,store,run_id,status,error_summary) values($1,'tesco',$2,'degraded',$3)",
      [run,`tesco_supervised_expansion_${run}`,JSON.stringify({selected:[{id:mapping,store_url:url(oldSku)}]})]);
    await db.query("insert into tesco_direct_collection_pages(id,run_id,requested_url,outcome,created_at) values($1,$2,$3,'pending',now()-interval '2 days')",[randomUUID(),run,url(oldSku)]);
    expect((await context()).pending).toBe(true);expect(supportedRepairHint(await context())).toBe(false);
  });
  it('retains the actual staged snapshot when an update trigger changes timestamps',async()=>{
    await db.exec(`alter table store_products add updated_at timestamptz default now();
      create function touch_offer() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp();return new;end $$;
      create trigger touch_offer before update on store_products for each row execute function touch_offer();`);
    const audit=await stage();await currentSource();expect(supportedRepairActivation(await activation(audit))).toBe(true);
  });
});
