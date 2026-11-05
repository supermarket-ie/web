import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite;
const evidence=()=>({mapping:{canonical_name:'Example Pepperoni Pizza Pockets 250g',canonical_brand:'Example',
  store_product_name:'Example Pizza Pockets Pepperoni 2 Pack',store_brand:'Example',is_own_brand:false},
  page:{parsed:{products:[{name:'Example Pizza Pockets Pepperoni 2 Pack 250g',brand:'Example',gtin:'05000000000001',quantity:{grams:250}}]}},
  peers:[{store:'dunnes',store_product_name:'Example 2 Pepperoni and Cheese Pizza Pockets 250g',brand:'Example',gtin:null,price:3,observed_at:'2026-11-05'}]});
async function conflict(e:unknown){return (await db.query<{conflict:boolean}>('select tesco_internal.reviewed_plural_pack_conflict($1::jsonb) conflict',[JSON.stringify(e)])).rows[0].conflict;}
beforeAll(async()=>{
  db=new PGlite();await db.exec('create schema tesco_internal;create role anon;create role authenticated;create role service_role');
  await db.exec(readFileSync('supabase/migrations/20261104134000_tesco_evidence_pack_totals.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261105114138_tesco_reviewed_plural_pack_counts.sql','utf8').split('-- Preserve the invoker function')[0]);
});
afterAll(async()=>{await db.close();});
describe('server-side positive whole-pack count proof',()=>{
  it('requires count proof without altering the ordinary material conflict helper',async()=>{
    expect(await conflict(evidence())).toBe(false);
    expect((await db.query<{conflict:boolean}>("select tesco_internal.material_title_conflict('Example Pepperoni Pizza Pockets 250g','Example Pizza Pockets Pepperoni 2 Pack 250g','{\"grams\":250}') conflict")).rows[0].conflict).toBe(true);
  });
  it.each(['missing_count','wrong_count','wrong_brand','wrong_barcode','missing_measure','wrong_measure','missing_freshness','wrong_recipe','explicit_single','explicit_multi_single','singular','own_label','missing_quantity','wrong_quantity','missing_original_anchor','null_original_anchor','missing_peer_store'])('retains conflict for %s',async kind=>{
    const e=evidence(),p=e.peers[0];
    if(kind==='missing_count')p.store_product_name='Example Pepperoni Pizza Pockets 250g';
    if(kind==='wrong_count')p.store_product_name='Example 3 Pepperoni Pizza Pockets 250g';
    if(kind==='wrong_brand')p.brand='Other';
    if(kind==='wrong_barcode')Object.assign(p,{gtin:'05999999999999'});
    if(kind==='missing_measure')p.store_product_name='Example 2 Pepperoni Pizza Pockets';
    if(kind==='wrong_measure')p.store_product_name='Example 2 Pepperoni Pizza Pockets 500g';
    if(kind==='missing_freshness')Object.assign(p,{observed_at:null});
    if(kind==='wrong_recipe')e.page.parsed.products[0].name='Example Pizza Pockets Triple Cheese 2 Pack 250g';
    if(kind==='explicit_single')e.mapping.canonical_name='Example Pepperoni Pizza Pockets 1 Pack 250g';
    if(kind==='explicit_multi_single')e.mapping.canonical_name='Example Pepperoni Pizza Pockets 1x250g';
    if(kind==='singular')e.mapping.canonical_name='Example Pepperoni Pizza Pocket 250g';
    if(kind==='own_label')e.mapping.is_own_brand=true;
    if(kind==='missing_quantity')Object.assign(e.page.parsed.products[0],{quantity:null});
    if(kind==='wrong_quantity')e.page.parsed.products[0].quantity={grams:125};
    if(kind==='missing_original_anchor')Object.assign(e.mapping,{store_brand:null,store_product_name:'Unbranded pockets'});
    if(kind==='null_original_anchor')Object.assign(e.mapping,{store_brand:null,store_product_name:null});
    if(kind==='missing_peer_store')Object.assign(p,{store:null});
    expect(await conflict(e)).toBe(true);
  });
  it('keeps the proof helper private and invoker-only',async()=>{
    const rows=(await db.query<{role:string;allowed:boolean}>("select r role,has_function_privilege(r,'tesco_internal.reviewed_plural_pack_conflict(jsonb)','execute') allowed from unnest(array['anon','authenticated','service_role']) r")).rows;
    expect(rows.every(r=>!r.allowed)).toBe(true);
    expect((await db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where oid='tesco_internal.reviewed_plural_pack_conflict(jsonb)'::regprocedure")).rows[0].prosecdef).toBe(false);
  });
});
