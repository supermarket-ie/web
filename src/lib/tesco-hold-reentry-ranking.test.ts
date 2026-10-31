import { describe, expect, it } from 'vitest';
import { rankHeldReviewEvidence, type HeldReviewRow } from './tesco-hold-reentry-ranking';

function sample(): HeldReviewRow {
  return { id:'a',store_sku:'251698077',canonical_name:'Dolmio Stir In Sweet Pepper Pasta Sauce 150g',
    canonical_brand:'Dolmio',store_product_name:'Dolmio Stir In Sweet Pepper Pasta Sauce 150g',
    store_brand:'Dolmio',gtin:null,proven:true,historical_observations:13,
    peers:[{store:'dunnes',name:'Dolmio Stir In Sweet Pepper Pasta Sauce 150g',brand:'Dolmio',gtin:null},
      {store:'supervalu',name:'Dolmio Stir In Sweet Pepper Pasta Sauce 150g',brand:'Dolmio',gtin:null}],
    source:{page_id:'evidence-page',body_sha256:'a'.repeat(64),
      name:'Dolmio Stir In Sweet Pepper Pasta Sauce 150g',brand:'Dolmio',gtin:null,
      quantity:{grams:150},identity_results:[]} };
}
describe('read-only AI-assisted hold-reentry triage',()=>{
  it('ranks convincing historical/peer evidence without ever approving a price',()=>{
    const r=rankHeldReviewEvidence([sample()])[0];
    expect(r).toMatchObject({ hypothesis:'likely_exact', approval:'independent_review_required' });
    expect(r.evidenceFor).toContain('both_fresh_retailer_peers');
  });
  it('flags a 4-roll mapping tied to 24-roll Tesco evidence despite overlapping tokens',()=>{
    const x=sample();x.canonical_name='Andrex Complete Clean Toilet Tissue 4 Roll';
    x.source!.name='Andrex Complete Clean Toilet Tissue 24 Standard Rolls';
    x.source!.quantity={pieces:24};
    x.peers=x.peers.map(p=>({...p,name:'Andrex Complete Clean Toilet Tissue 4 Roll'}));
    const r=rankHeldReviewEvidence([x])[0];
    expect(r.hypothesis).toBe('conflict');
    expect(r.concerns).toContain('canonical_tesco_pack_or_measure_conflict');
  });
  it('flags unadvertised flavour and brand mismatch',()=>{
    const x=sample();x.canonical_name='Flash Kitchen Spray 800ml';x.canonical_brand='Flash';
    x.source!.name='Flash Kitchen Cleaning Spray Citrus 800ml';x.source!.brand='Other';
    x.peers=x.peers.map(p=>({...p,name:'Flash Kitchen Spray 800ml'}));
    const r=rankHeldReviewEvidence([x])[0];
    expect(r.hypothesis).toBe('conflict');
    expect(r.concerns).toContain('formulation_or_variant_discrepancy:citrus');
  });
  it('requires source page, historical provenance, and both peers before strong inference',()=>{
    const x=sample();x.source=null;x.proven=false;x.peers=[];
    const r=rankHeldReviewEvidence([x])[0];
    expect(r.hypothesis).toBe('needs_evidence');
    expect(r.concerns).toContain('no_retained_hashed_tesco_product_page');
    expect(r.approval).toBe('independent_review_required');
  });
});
