import { describe, expect, it } from 'vitest';
import { planTescoCoverage } from './tesco-coverage-plan';
import type { DiscoveryInput } from './tesco-discovery';
function fixture(): DiscoveryInput {
  return { asOf:'2026-10-11T07:15:00.000Z', mappings:[0,1,2].map(i=>({id:`mapping-${i}`,product_id:`product-${i}`,
    canonical_name:`Brand Vanilla Yogurt ${100+i*100}g`,canonical_brand:'Brand',store_product_name:null,store_brand:null,
    store_sku:null,store_url:null,url_status:null,gtin:null,is_own_brand:false,observed_at:null,proven:false})),
    peers:[0,1,2].flatMap(i=>['supervalu','dunnes'].map(store=>({id:`${store}-${i}`,product_id:`product-${i}`,
      store:store as 'supervalu'|'dunnes',store_product_name:`Brand Vanilla Yogurt ${100+i*100}g`,brand:'Brand',
      gtin:null,store_sku:`peer-${i}`,observed_at:'2026-10-10T07:00:00Z'}))),evidence:[],attempts:[],rejections:[],demand:[] };
}
describe('read-only Tesco coverage acquisition planner',()=>{
  it('groups multiple exact-peer targets into a bounded query without accepting mappings',()=>{
    const r=planTescoCoverage(fixture(),{requests:[],queryBudget:1});
    expect(r.metrics).toMatchObject({acquisitionTargets:3,queries:1,queryTargetCoverage:3,collectionReady:0});
    expect(r.queries[0].expectedMatches).toBeNull();expect(r.requestsExecuted).toBe(0);expect(r.observationsInserted).toBe(0);
    expect(r.rows.every(r=>!r.liveVerifiedThisRun&&r.exactSku===null)).toBe(true);
  });
  it.each(['other_brand','other_size','other_variant','incomplete_canonical','compound'])('excludes %s from exact-peer acquisition targets',issue=>{
    const x=fixture();if(issue==='other_brand')x.peers[0].brand='Other';
    if(issue==='other_size')x.peers[0].store_product_name='Brand Vanilla Yogurt 500g';
    if(issue==='other_variant')x.peers[0].store_product_name='Brand Strawberry Yogurt 100g';
    if(issue==='incomplete_canonical')x.mappings[0].canonical_brand=null;
    if(issue==='compound')x.mappings[0].canonical_name+=' + 50g';
    const r=planTescoCoverage(x,{requests:[]});expect(r.rows.find(r=>r.canonicalProductId==='product-0')?.acquisitionEligible).toBe(false);
  });
  it('does not evade an unknown brand query with a new keyword or pagination',()=>{
    const r=planTescoCoverage(fixture(),{requests:[{requested_url:'https://www.tesco.ie/shop/en-IE/search?query=Brand&page=2',outcome:'pending',mode:'listings'}]});
    expect(r.queries).toEqual([]);expect(r.rows.every(r=>r.operationalHolds.includes('unresolved_listing_scope'))).toBe(true);
  });
  it('does not propose a previously completed query again',()=>{
    const r=planTescoCoverage(fixture(),{requests:[{requested_url:'https://www.tesco.ie/shop/en-IE/search?query=Brand',outcome:'ok',mode:'listings'}]});
    expect(r.queries.every(q=>q.query!=='brand')).toBe(true);
  });
  it('excludes unresolved direct products',()=>{
    const x=fixture();x.mappings[0].store_url='https://www.tesco.ie/shop/en-IE/products/123456789';
    const r=planTescoCoverage(x,{requests:[{requested_url:x.mappings[0].store_url!,outcome:'pending',mode:'products'}]});
    expect(r.metrics.acquisitionTargets).toBe(2);
  });
  it('ranks current comparison targets first and distinguishes stale peer prices',()=>{
    const x=fixture();for(const p of x.peers.filter(p=>p.product_id==='product-0'))p.observed_at='2026-09-01T00:00:00Z';
    const r=planTescoCoverage(x,{requests:[]});expect(r.rows[0].comparison).toBe(true);expect(r.rows.at(-1)?.comparison).toBe(false);
    expect(r.metrics.queryComparisonTargets).toBe(2);
  });
  it('keeps inputs immutable and deterministic; root categories reconcile exactly',()=>{
    const x=fixture(),before=JSON.stringify(x),a=planTescoCoverage(x,{requests:[]});
    expect(planTescoCoverage(x,{requests:[]})).toEqual(a);expect(JSON.stringify(x)).toBe(before);
    expect(Object.values(a.counts).reduce((a,b)=>a+b,0)).toBe(3);
  });
  it.each([0,101,1.5])('rejects invalid query budget %s',queryBudget=>expect(()=>planTescoCoverage(fixture(),{requests:[],queryBudget})).toThrow());
});
