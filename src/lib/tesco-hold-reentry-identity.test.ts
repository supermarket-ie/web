import { describe, expect, it } from 'vitest';
import { independentExactIdentity, type ReentryEvidence } from './tesco-hold-reentry';

function evidence(canonical: string, source: string, peer: string, quantity = { grams: 100 }, brand = 'Example'): ReentryEvidence {
  const url='https://www.tesco.ie/shop/en-IE/products/123456789';
  return {
    mapping:{id:'mapping',product_id:'product',canonical_name:canonical,canonical_brand:brand,
      canonical_ean:null,store_product_name:source,store_brand:brand,is_own_brand:false,
      store_sku:'123456789',store_url:url,url_status:'resolved',gtin:null},
    sameSkuCount:1,proven:true,freshTesco:false,pending:false,recentAttempt:false,
    page:{id:'page',requested_url:url,final_url:url,outcome:'ok',http_status:200,
      body_sha256:'a'.repeat(64),mode:'products',parsed:{listing:null,products:[{
        sku:'123456789',url,name:source,brand,gtin:'05012345678901',quantity,available:true,currency:'EUR',price:2}]}},
    sourceRun:{status:'success',finished_at:'2026-01-01'},
    peers:[{id:'peer',store:'supervalu',store_product_name:peer,brand,gtin:null,
      store_sku:'peer-sku',observed_at:'2026-01-01',price:2}],
  };
}
describe('independent Tesco naming and pack evidence',()=>{
  it('does not convert an explicit item count into a canonical mass',()=>{
    const e=evidence('Example Fruit 1kg','Example Fruit Each','Example Fruit Each');
    e.page.parsed.products[0].quantity={pieces:1};
    expect(independentExactIdentity(e)).toBe(false);
  });
  it('revalidates retained formulation details without depending on JSON key order',()=>{
    const e=evidence('Example Butter 100g','Example Butter 100g','Example Butter 100g');
    const source=e.page.parsed.products[0];
    source.identityDetails={ingredients:['Cream'],manufacturer:'Example'};
    expect(independentExactIdentity(e,{...source,identityDetails:{manufacturer:'Example',ingredients:['Cream']}})).toBe(true);
    expect(independentExactIdentity(e,{...source,identityDetails:{ingredients:['Cream','Salt'],manufacturer:'Example'}})).toBe(false);
  });
  it.each([
    ["Jacob's Yogurt Rice Cakes 100g",'Jacobs Rice Cakes With Yoghurt 100G',"Jacob's Yogurt Rice Cakes (100 g)","Jacob's"],
    ['Example Butter Stick 100g','Example Butter Sticks 100G','Example Irish Creamery Butter Stick (100 g)','Example'],
    ["Flahavan's Pinhead Oatmeal 100g",'Flahavans Pinhead Oats 100G',"Flahavan's Pinhead Oatmeal (100 g)","Flahavan's"],
  ])('accepts supported spelling and presentation for %s',(c,s,p,b)=>{
    expect(independentExactIdentity(evidence(c,s,p,{grams:100},b))).toBe(true);
  });
  it.each([
    ['Example Protein Plant Powered Stirfry 450g','Example Protein Stir Fry 450G','Example Protein Plant Powered Stirfry (450 g)',{grams:450},'Example'],
    ['Example Bleach Multipurpose Cleaning Spray 700ml','Example Bleach Spray All Purpose Multi Surface Cleaner 700ml','Example Bleach Multipurpose Cleaning Spray (700 ml)',{millilitres:700},'Example'],
  ])('recognises bounded product wording for %s',(c,s,p,q,b)=>{
    const e=evidence(c,s,p,q,b);
    expect(independentExactIdentity(e)).toBe(true);
    e.peers[0].brand='Different';
    expect(independentExactIdentity(e)).toBe(false);
    e.peers[0].brand=b;
    e.page.parsed.products[0].quantity={grams:200};
    expect(independentExactIdentity(e)).toBe(false);
  });
  it('retains variant rejection when product wording is equivalent',()=>{
    expect(independentExactIdentity(evidence('Example Lemon Multipurpose Cleaning Spray 100g',
      'Example Lime All Purpose Cleaner Spray 100g','Example Lemon Multipurpose Cleaning Spray 100g'))).toBe(false);
  });
  it('keeps attached pack counts subject to the canonical count guard',()=>{
    const e=evidence('Example Dental Sticks 5Pack','Example Dental Sticks 28 Pack 100g',
      'Example Dental Sticks 28 Pack 100g');
    e.mapping.canonical_ean=e.page.parsed.products[0].gtin!;
    expect(independentExactIdentity(e)).toBe(false);
    e.mapping.canonical_name='Example Dental Sticks 28pk';
    expect(independentExactIdentity(e)).toBe(true);
  });
  it('compares explicit multipacks against their total quantity',()=>{
    expect(independentExactIdentity(evidence('Example Apricot Yogurt 4 Pack','Example Apricot Yogurt 4x90g',
      'Example Apricot Yogurt 4 Pack (360 g)',{grams:360}))).toBe(true);
  });
  it('requires independent positive brand support for a missing canonical brand',()=>{
    const e=evidence('Unsmoked Streaky Bacon 100g','Example 12 Unsmoked Streaky Bacon 100g',
      'Example 12 Unsmoked Streaky Bacon 100g');
    e.mapping.canonical_brand=null;
    expect(independentExactIdentity(e)).toBe(true);
    e.peers[0].brand='Different';
    expect(independentExactIdentity(e)).toBe(false);
  });
  it.each([
    ['Example French Onion Soup 100g','Example Vegetable Soup 100g','Example French Onion Soup (100 g)'],
    ['Example Butter 100g','Example Butter 100g','Example Butter 200g'],
    ['Example Yogurt 4 Pack','Example Yogurt 4x90g','Example Yogurt 4 Pack (90 g)'],
    ['Example Yogurt 1 Pack','Example Yogurt 4x90g','Example Yogurt 4 Pack (360 g)'],
  ])('rejects contradictory identity or pack %s',(c,s,p)=>{
    expect(independentExactIdentity(evidence(c,s,p))).toBe(false);
  });
  it('checks structured weight when a product title glues the weight to a word',()=>{
    const e=evidence('Example Cheese Crisps','Example Cheese Crisps100g','Example Cheese Crisps 45g');
    expect(independentExactIdentity(e)).toBe(false);
  });
  it('keeps Tesco identity independent of a conflicting peer with positive canonical barcode evidence',()=>{
    const e=evidence('Example Butter 100g','Example Butter 100g','Example Vanilla Butter 200g');
    e.mapping.canonical_ean=e.page.parsed.products[0].gtin!;
    expect(independentExactIdentity(e)).toBe(true);
    e.mapping.gtin='05000000000000';
    expect(independentExactIdentity(e)).toBe(false);
    e.mapping.gtin=null;e.mapping.canonical_name='Example Butter 200g';
    expect(independentExactIdentity(e)).toBe(false);
  });
});
