import { describe, expect, it } from 'vitest';
import { reviewedCanonicalEvidenceGap, independentExactIdentity, type ReentryEvidence } from './tesco-hold-reentry';

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
  it('binds net/drained basis reconciliation to the same complete retained facts and barcode',()=>{
    const e=evidence('Example Tuna 4 Pack 580g','Example Tuna 4x145g','Example Tuna 4x145g',{grams:408});
    const p=e.page.parsed.products[0];
    p.identityDetails={packSize:[{value:'408',units:'G'}],netContents:'4x145g',drainedWeight:'4x102g'};
    const before=JSON.stringify(p);
    expect(independentExactIdentity(e,{...p,quantity:{grams:580},quantityEvidence:'explicit_net_contents_with_drained_pack'})).toBe(true);
    expect(JSON.stringify(p)).toBe(before);
    expect(independentExactIdentity(e,{...p,quantity:{grams:600}})).toBe(false);
    expect(independentExactIdentity(e,{...p,gtin:'05999999999999',quantity:{grams:580}})).toBe(false);
    expect(independentExactIdentity(e,{...p,identityDetails:{...p.identityDetails,drainedWeight:'4x100g'},quantity:{grams:580}})).toBe(false);
  });
  function genericSoup() {
    const e=evidence('Creamy Vegetable Soup','Example Creamy Vegetable Soup 579g',
      'Example Creamy Vegetable Soup 579g',{grams:579});
    e.mapping.canonical_brand=null;
    e.peers.push({...e.peers[0],id:'other',store:'dunnes',brand:'Other',
      store_product_name:'Other Creamy Chicken Vegetable Soup 400g'});
    return e;
  }
  it('requires a complete independently matching manufacturer pack for an abbreviated generic title',()=>{
    const e=genericSoup(), before=JSON.stringify(e.peers);
    expect(independentExactIdentity(e)).toBe(true);
    expect(JSON.stringify(e.peers)).toBe(before);
    expect(reviewedCanonicalEvidenceGap(e,e.page.parsed.products[0],['measureExactnessFailed'])).toBe(true);
  });
  it.each(['manufacturer','original recipe','peer recipe','peer measure','peer count','canonical count','original count','generic category','source measure','peer barcode','missing barcode','extra product form','missing anchor'])
    ('refuses incomplete generic manufacturer proof: %s',change=>{
      const e=genericSoup();
      if(change==='manufacturer')e.peers[0].brand='Different';
      if(change==='original recipe')e.mapping.store_product_name='Example Creamy Pea Soup 579g';
      if(change==='peer recipe')e.peers[0].store_product_name='Example Creamy Tomato Soup 579g';
      if(change==='peer measure')e.peers[0].store_product_name='Example Creamy Vegetable Soup 580g';
      if(change==='peer count')e.peers[0].store_product_name='Example Creamy Vegetable Soup 2x289.5g';
      if(change==='canonical count')e.mapping.canonical_name='Creamy Vegetable Soup 2 Pack';
      if(change==='original count')e.mapping.store_product_name='Example Creamy Vegetable Soup 2 Pack 579g';
      if(change==='generic category')e.mapping.canonical_name='Soup';
      if(change==='source measure')e.page.parsed.products[0].quantity={grams:580};
      if(change==='peer barcode')e.peers[0].gtin='05999999999999';
      if(change==='missing barcode')e.page.parsed.products[0].gtin=null;
      if(change==='extra product form')e.page.parsed.products[0].name='Example Creamy Vegetable Soup Powder 579g';
      if(change==='missing anchor'){e.mapping.store_brand=null;e.mapping.store_product_name='Creamy Vegetable Soup';}
      expect(independentExactIdentity(e)).toBe(false);
    });
  it('does not grant the generic manufacturer route to retailer own labels',()=>{
    const e=genericSoup();e.mapping.is_own_brand=true;
    expect(independentExactIdentity(e)).toBe(false);
  });
  it('keeps the documented Barilla Rosso wording bounded to its recipe and maker',()=>{
    const e=evidence('Pesto Rosso','Barilla Pesto Rosso 200g',
      'Barilla Rosso Tomato Pesto Sauce 200g',{grams:200},'Barilla');
    e.mapping.canonical_brand=null;
    e.peers.push({...e.peers[0],id:'other',store:'dunnes',brand:'Other',store_product_name:'Other Pesto Rosso 190g'});
    expect(independentExactIdentity(e)).toBe(true);
    e.peers[0].store_product_name='Barilla Basil Rosso Tomato Pesto Sauce 200g';
    expect(independentExactIdentity(e)).toBe(false);
  });
  it('resolves only the positively proven inferred count on a new live request',()=>{
    const e=evidence('Example Pepperoni Pizza Pockets 250g','Example Pizza Pockets Pepperoni 2 Pack 250g',
      'Example 2 Pepperoni Pizza Pockets 250g',{grams:250});
    const live=e.page.parsed.products[0];
    expect(reviewedCanonicalEvidenceGap(e,live,['packExactnessFailed'])).toBe(true);
    expect(reviewedCanonicalEvidenceGap(e,live,['packExactnessFailed','brandConflict'])).toBe(false);
    expect(reviewedCanonicalEvidenceGap(e,{...live,available:false},['packExactnessFailed'])).toBe(false);
    e.mapping.store_product_name='Example Pizza Pockets Pepperoni 1 Pack 250g';
    expect(reviewedCanonicalEvidenceGap(e,live,['packExactnessFailed'])).toBe(false);
    e.mapping.store_product_name=live.name;e.peers[0].store_product_name='Example 3 Pepperoni Pizza Pockets 250g';
    expect(reviewedCanonicalEvidenceGap(e,live,['packExactnessFailed'])).toBe(false);
  });

  it('requires explicit independent count evidence for a plural whole-pack title',()=>{
    const e=evidence('Example Pepperoni Pizza Pockets 250g',
      'Example Pizza Pockets Pepperoni 2 Pack 250g',
      'Example 2 Pepperoni and Cheese Pizza Pockets 250g',{grams:250});
    expect(independentExactIdentity(e)).toBe(true);
    e.peers[0].store_product_name='Example Pepperoni Pizza Pockets 250g';
    expect(independentExactIdentity(e)).toBe(false);
    e.peers[0].store_product_name='Example 3 Pepperoni Pizza Pockets 250g';
    expect(independentExactIdentity(e)).toBe(false);
  });
  it.each(['Example Pepperoni Pizza Pockets 1 Pack 250g','Example Pepperoni Pizza Pockets 1x250g',
    'Example Pepperoni Pizza Pocket 250g'])('never overrides a single-item identity %s',canonical=>{
    expect(independentExactIdentity(evidence(canonical,'Example Pizza Pockets Pepperoni 2 Pack 250g',
      'Example 2 Pepperoni Pizza Pockets 250g',{grams:250}))).toBe(false);
  });
  it('retains barcode, quantity and retailer-brand constraints on whole-pack counts',()=>{
    const e=evidence('Example Cheese Pizza Pockets 250g','Example Pizza Pockets Cheese 2 Pack 250g',
      'Example 2 Cheese Pizza Pockets 250g',{grams:250});
    expect(independentExactIdentity(e)).toBe(true);
    e.peers[0].gtin='05999999999999';expect(independentExactIdentity(e)).toBe(false);
    e.peers[0].gtin=null;e.page.parsed.products[0].quantity={grams:125};
    expect(independentExactIdentity(e)).toBe(false);
    e.page.parsed.products[0].quantity={grams:250};e.mapping.is_own_brand=true;
    expect(independentExactIdentity(e)).toBe(false);
  });

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
  it('requires positive branded whole-pack evidence for an unsized generic canonical',()=>{
    const e=evidence('Blackcurrant Conserve','Example Blackcurrant Conserve 100g',
      'Example Blackcurrant Conserve 100g');
    e.mapping.canonical_brand=null;
    e.mapping.store_brand=null;
    expect(independentExactIdentity(e)).toBe(true);
    e.mapping.store_product_name='Nonexample Blackcurrant Conserve';
    expect(independentExactIdentity(e)).toBe(false);
    e.mapping.store_product_name='Blackcurrant Conserve';
    expect(independentExactIdentity(e)).toBe(false);
    e.mapping.store_product_name='Example Blackcurrant Conserve';
    e.peers[0].store_product_name='Example Blackcurrant Conserve';
    expect(independentExactIdentity(e)).toBe(false);
    e.peers[0].store_product_name='Example Blackcurrant Conserve 200g';
    expect(independentExactIdentity(e)).toBe(false);
    e.peers[0].store_product_name='Different Blackcurrant Conserve 100g';
    e.peers[0].brand='Different';
    expect(independentExactIdentity(e)).toBe(false);
  });
  it('rejects an explicit canonical pack conflict despite a corroborating original brand',()=>{
    const e=evidence('Blackcurrant Conserve 200g','Example Blackcurrant Conserve 100g',
      'Example Blackcurrant Conserve 100g');
    e.mapping.canonical_brand=null;
    expect(independentExactIdentity(e)).toBe(false);
  });
  it('uses a positively corroborating whole pack without asserting the other peer exact',()=>{
    const e=evidence('Example Deep Cheesy Pizza 100g','Example Deep Cheesy Pizza 100g',
      'Example Deep Cheesy Pizza 100g');
    e.peers.push({...e.peers[0],id:'other',store:'dunnes',brand:'Different',
      store_product_name:'Different Wooden Pizza Set 3 Pieces'});
    expect(independentExactIdentity(e)).toBe(true);
    // A second wrong association cannot stand in for positive source support.
    e.peers[0].store_product_name='Example Deep Cheesy Pizza';
    expect(independentExactIdentity(e)).toBe(false);
    e.peers[0].store_product_name='Example Deep Cheesy Pizza 200g';
    expect(independentExactIdentity(e)).toBe(false);
    e.peers[0].store_product_name='Example Deep Cheesy Pizza 100g';
    e.peers[0].gtin='05000000000000';
    expect(independentExactIdentity(e)).toBe(false);
  });
  it('does not reuse the branded corroboration path for retailer own-label offers',()=>{
    const e=evidence('Tesco Milk 100g','Tesco Milk 100g','Tesco Milk 100g',{grams:100},'Tesco');
    e.mapping.is_own_brand=true;
    e.peers.push({...e.peers[0],id:'other',store:'dunnes',brand:'Different',
      store_product_name:'Different Milk 100g'});
    expect(independentExactIdentity(e)).toBe(false);
    e.mapping.is_own_brand=false;
    expect(independentExactIdentity(e)).toBe(false);
  });
  it.each([
    ['Example Basmati Rice 100g','Example Basmati Microwave Rice 100g','Example Ready to Heat Basmati Rice 100g'],
    ['Example Mini Puddings 100g','Example Mini Puddings 100g','Example Mini Pudding 100g'],
  ])('recognises supported preparation or inflection for %s',(c,s,p)=>{
    expect(independentExactIdentity(evidence(c,s,p))).toBe(true);
  });
  it.each([
    ['Example Basmati Rice 100g','Example Pilau Microwave Rice 100g','Example Ready to Heat Basmati Rice 100g'],
    ['Example Rodeo Beef Dog Treats 100g','Example Ranchos Beef Dog Treats 100g','Example Rodeo Beef Dog Treats 100g'],
    ['Example Ranchos Chicken Treats 100g','Example Ranchos Cubes Chicken Treats 100g','Example Ranchos Originals Chicken Treats 100g'],
    ['Example Wholegrain Rice 100g','Example Long Grain Microwave Rice 100g','Example Ready to Heat Wholegrain Rice 100g'],
  ])('preserves named recipe and product-range conflicts for %s',(c,s,p)=>{
    const e=evidence(c,s,p);
    expect(independentExactIdentity(e)).toBe(false);
    e.mapping.canonical_ean=e.page.parsed.products[0].gtin!;
    expect(independentExactIdentity(e)).toBe(false);
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
