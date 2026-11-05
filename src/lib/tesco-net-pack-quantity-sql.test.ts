import{describe,it,expect,beforeAll,afterAll}from'vitest';
import{PGlite}from'@electric-sql/pglite';
import{readFileSync}from'node:fs';
import{normaliseNetPackQuantity}from'./tesco-net-pack-quantity';
let db:PGlite;
const source=()=>({name:'Example Tuna 4x145g',quantity:{grams:408},identityDetails:{packSize:[{value:'408',units:'G'}],netContents:'4x145g ℮',drainedWeight:'4x102g'}});
beforeAll(async()=>{db=new PGlite();await db.exec('create schema tesco_internal;create role anon;create role authenticated;create role service_role');
  await db.exec(readFileSync('supabase/migrations/20261105162825_tesco_explicit_net_pack_quantity.sql','utf8').split('-- Preserve the existing approval identity')[0]);});
afterAll(async()=>{await db.close();});
describe('private server net/drained projection parity',()=>{
  it.each(['valid','single','net','drained','structured','raw','title','count','duplicate title','multiple sizes','missing quantity','invalid pack'])
    ('matches the positive Node proof for %s',async kind=>{
      const p=source();
      if(kind==='single'){p.name='Example Tomatoes 400g';p.quantity.grams=250;p.identityDetails={packSize:[{value:'250',units:'G'}],netContents:'400g e',drainedWeight:'250g'};}
      if(kind==='net')p.identityDetails.netContents='4x140g';
      if(kind==='drained')p.identityDetails.drainedWeight='4x100g';
      if(kind==='structured')p.identityDetails.packSize[0].value='400';
      if(kind==='raw')p.quantity.grams=400;
      if(kind==='title')p.name='Example Tuna';
      if(kind==='count')p.name='Example Tuna 580g';
      if(kind==='duplicate title')p.name+=' 580g';
      if(kind==='multiple sizes')p.identityDetails.packSize.push({value:'408',units:'G'});
      if(kind==='missing quantity')Object.assign(p,{quantity:null});
      if(kind==='invalid pack')p.identityDetails.packSize[0].value='NaN';
      const row=(await db.query<{p:unknown}>('select tesco_internal.normalise_net_pack_product($1::jsonb) p',[JSON.stringify(p)])).rows[0];
      expect(row.p).toEqual(normaliseNetPackQuantity(p));
    });
  it('is private and invoker-only for every API role',async()=>{
    const rows=(await db.query<{allowed:boolean}>("select has_function_privilege(r,'tesco_internal.normalise_net_pack_product(jsonb)','execute') allowed from unnest(array['anon','authenticated','service_role']) r")).rows;
    expect(rows.every(x=>!x.allowed)).toBe(true);
    expect((await db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where oid='tesco_internal.normalise_net_pack_product(jsonb)'::regprocedure")).rows[0].prosecdef).toBe(false);
  });
});
