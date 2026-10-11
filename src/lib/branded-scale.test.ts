import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { brandClaimSchema, rulesFromClaims, eligibleBrand, brandReviewQueue } from './branded-brand-claims';
import { BRAND_RULES } from './branded-brand-registry';
import { brandFor, compare, parsePack, type Evidence } from './branded-product-identity';
import { gateInference, inferenceSchema, type InferenceResult } from './branded-inference';
import { captureIdentityResponse } from './retailer-identity-response';
const now='2026-10-11T09:00:00.000Z',at='2026-10-11T08:00:00.000Z';
function evidence(title:string,store:'supervalu'|'dunnes'='supervalu'):Evidence {
 const sku=store==='supervalu'?'1234567001':'123456700';
 const url=store==='supervalu'?`https://shop.supervalu.ie/sm/delivery/rsid/5550/product/sauce-id-${sku}`:`https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/sauce/${sku}`;
 return {id:store,store,sku,url,title,brand:null,gtin:null,source:{kind:'refresh_attested',at,ref:'old:'+store,url},mappingIds:[],canonicalIds:[],conflicts:[],lastLiveVerifiedAt:null};
}
const claim=brandClaimSchema.parse({id:'test',name:'Independent Dairy',aliases:['Ind Dairy'],owner:'Example Manufacturer',kind:'manufacturer_brand',source:'https://manufacturer.example/brands',sourceSummary:'Independent manufacturer identifies its branded dairy range.',sourceKind:'manufacturer_portfolio',checkedAt:'2026-10-11',reviewedBy:'fixture-reviewer',status:'approved'});
describe('data-driven brand classification',()=>{
 it('accepts reviewed claims; metadata and model proposals alone remain unresolved',()=>{
  const e=evidence('Independent Dairy Milk 1L');
  expect(brandFor(e,BRAND_RULES).rule).toBeUndefined();
  expect(eligibleBrand(brandFor(e,rulesFromClaims(BRAND_RULES,[claim],now)).rule)).toBe(true);
  expect(brandFor(e,rulesFromClaims(BRAND_RULES,[{...claim,status:'proposed'}],now)).rule).toBeUndefined();
  expect(brandReviewQueue([e],BRAND_RULES)[0].classification).toBe('unresolved');
 });
 it('keeps retailer-exclusive manufacturers distinct from private labels',()=>{
  const rules=rulesFromClaims(BRAND_RULES,[{...claim,kind:'retailer_exclusive_manufacturer'}],now);
  expect(eligibleBrand(brandFor(evidence('Ind Dairy Milk 1L'),rules).rule)).toBe(true);
  expect(eligibleBrand(brandFor(evidence('Tesco Milk 1L'),rules).rule)).toBe(false);
 });
 it('holds expired, future, contradictory ownership and ambiguous aliases',()=>{
  for(const changes of [{checkedAt:'2027-01-01'},{checkedAt:'2020-01-01'},{owner:null}])expect(rulesFromClaims([],[{...claim,...changes}],now)).toHaveLength(0);
  expect(rulesFromClaims([],[claim,{...claim,id:'conflict',owner:'Other'}],now)).toHaveLength(0);
  const rules=rulesFromClaims([],[claim,{...claim,id:'other',name:'Other',aliases:['Ind Dairy']}],now);
  expect(brandFor(evidence('Ind Dairy Milk 1L'),rules).rule).toBeUndefined();
 });
});
describe('pack and language controls',()=>{
 it('normalises marrow fat without deleting product qualifiers',()=>{
  expect(compare(evidence('Batchelors Marrow Fat Peas 420g'),evidence('Batchelors Marrowfat Peas 420g','dunnes'),BRAND_RULES,now).decision).toBe('exact_match');
  expect(compare(evidence('Batchelors Marrow Fat Peas 420g'),evidence('Batchelors No Soak Marrowfat Peas 420g','dunnes'),BRAND_RULES,now).decision).not.toBe('exact_match');
 });
 it('holds a retained single-pack title whose SKU URL identifies a multipack',()=>{
  const a=evidence('Batchelors Mushy Peas 225g'),b=evidence('Batchelors Mushy Peas 225g','dunnes');
  b.url=b.url.replace('/sauce/','/batchelors-mushy-peas-3-x-225g/');
  const r=compare(a,b,BRAND_RULES,now);expect(r.decision).toBe('insufficient_evidence');expect(r.missing).toContain('url_title_pack_conflict_requires_review');
 });
 it('checks explicit per-item/total arithmetic and retains count identity',()=>{
  expect(parsePack('Brand Yogurt 4x90g (360g)')).toEqual(parsePack('Brand Yogurt 4x90g'));
  expect(parsePack('Brand Yogurt 4x90g (350g)').issues).toContain('multiple_explicit_measures');
  expect(parsePack('Brand Yogurt 4x90g (360ml)').issues).toContain('multiple_explicit_measures');
  expect(compare(evidence('Heinz Sauce 2x500g (1kg)'),evidence('Heinz Sauce 1kg','dunnes'),BRAND_RULES,now).decision).toBe('not_exact_match');
 });
});
describe('four-way inference and independent non-GTIN corroboration',()=>{
 const a=evidence('Heinz Tomato Ketchup 500g'),b=evidence('Heinz Tomato Ketchup Squeezy 500g','dunnes');
 const result:InferenceResult={decision:'exact_match',supportingAttributes:[{attribute:'brand',value:'Heinz',evidenceIds:[a.id,b.id]}],contradictions:[],missingEvidence:[],rationale:'Fixture only',confidence:1};
 const proof=(e:Evidence)=>{const body=JSON.stringify({sku:e.sku,name:e.title,manufacturer:'Kraft Heinz',mpn:'TOMATO-500-SQ'});
  const row={...captureIdentityResponse({store:e.store as 'supervalu'|'dunnes',sku:e.sku,title:e.title,productUrl:e.url,requestedUrl:e.url,finalUrl:e.url,contentType:'application/json',body,retrievedAt:at})!,id:'new:'+e.store};
  return {store:e.store,sku:e.sku,sourceRef:row.id,bodySha256:row.body_sha256,observedAt:at,originalResponse:row};};
 it('allows genuinely separate SKU-bound manufacturer codes with original bodies',()=>{
  expect(gateInference(a,b,result,BRAND_RULES,now,[proof(a),proof(b)]).accepted).toBe(true);
  const forged=proof(b);forged.originalResponse.identity.manufacturerProductCode='invented';
  expect(gateInference(a,b,result,BRAND_RULES,now,[proof(a),forged]).accepted).toBe(false);
 });
 it('cannot use a manufacturer code to override flavour, size or an unconfirmed formulation',()=>{
  for(const title of ['Heinz Tomato Ketchup Squeezy 400g','Heinz No Added Sugar Tomato Ketchup 500g']){
   const different=evidence(title,'dunnes');expect(gateInference(a,different,result,BRAND_RULES,now,[proof(a),proof(different)]).accepted).toBe(false);
  }
 });
 it('represents different retail packs without accepting them',()=>{
  expect(inferenceSchema.parse({...result,decision:'related_different_pack'}).decision).toBe('related_different_pack');
  expect(gateInference(a,evidence('Heinz Tomato Ketchup 400g','dunnes'),result,BRAND_RULES,now).decision).toBe('related_different_pack');
 });
});

it('applies the versioned claims migration without touching catalogue tables',async()=>{
 const db=await PGlite.create();try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  await db.exec(readFileSync('supabase/migrations/20261011120000_retailer_identity_responses.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261011123000_manufacturer_brand_claims.sql','utf8'));
  const rows=(await db.query<{claim:unknown}>('select claim from manufacturer_brand_claims')).rows;
  expect(rows).toHaveLength(22);for(const r of rows)expect(brandClaimSchema.safeParse(r.claim).success).toBe(true);
  await expect(db.exec('delete from manufacturer_brand_claims')).rejects.toThrow('append-only');
  await db.exec('set role authenticated');await expect(db.exec('select * from manufacturer_brand_claims')).rejects.toThrow('permission denied');
 }finally{await db.close();}
},15000);

it('starts the real inference CLI and fails before reading input or making calls without a provider credential',()=>{
 const env={...process.env};delete env.ANTHROPIC_API_KEY;
 const r=spawnSync(process.execPath,['--import','tsx','scripts/branded-intersection-infer.ts','missing-report.json','unused-output','missing-budget.json','--confirm-bounded-inference'],{env,encoding:'utf8'});
 expect(r.status).toBe(1);expect(r.stderr).toContain('Approved Anthropic provider credential unavailable; no calls made');
 expect(r.stderr).not.toContain('Transform failed');
});
