import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyTescoReplacement } from './tesco-mapping-audit';
import { independentExactIdentity, reviewedCanonicalEvidenceGap, type ReentryEvidence } from './tesco-hold-reentry';

let db: PGlite;
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec('create schema tesco_internal');
  await db.exec(readFileSync('supabase/migrations/20261104121700_tesco_explicit_food_counts.sql', 'utf8'));
});
afterAll(async () => { await db.close(); });

function evidence(canonical: string, source: string, peer: string, grams: number): ReentryEvidence {
  const url = 'https://www.tesco.ie/shop/en-IE/products/123456789';
  return {
    mapping: { id:'mapping',product_id:'product',canonical_name:canonical,canonical_brand:'Example',canonical_ean:null,
      store_product_name:source,store_brand:'Example',is_own_brand:false,store_sku:'123456789',store_url:url,url_status:'resolved',gtin:null },
    sameSkuCount:1,proven:true,freshTesco:false,pending:false,recentAttempt:false,
    sourceRun:{status:'success',finished_at:'2026-11-01T12:00:00Z'},
    page:{id:'page',requested_url:url,final_url:url,outcome:'ok',http_status:200,body_sha256:'a'.repeat(64),mode:'products',
      parsed:{listing:null,products:[{sku:'123456789',url,name:source,brand:'Example',gtin:null,price:2,currency:'EUR',available:true,quantity:{grams}}]}},
    peers:['dunnes','supervalu'].map(store=>({id:store,store,store_product_name:peer,brand:'Example',gtin:null,store_sku:'peer',observed_at:'2026-11-01T12:00:00Z',price:2})),
  };
}

describe('explicit food counts across the independent and database gates', () => {
  const cases = [
    { canonical:'Example Reduced Salt Beef Stock 12 Cubes 71g', source:'Example Reduced Salt Beef Stock Cubes 12 Pack 71g', peer:'Example 12 Reduced Salt Beef Stock Cubes 71g', grams:71 },
    { canonical:'Example Be Good Wholemeal Bagels 6 Pack', source:'Example 6 Be Good Wholemeal Bagels 270g', peer:'Example 6 Be Good Wholemeal Bagels 270g', grams:270 },
  ];
  for (const row of cases) {
    it(`accepts the explicit matching count in ${row.canonical}`, async () => {
      const e = evidence(row.canonical,row.source,row.peer,row.grams);
      expect(independentExactIdentity(e)).toBe(true);
      const legacy = classifyTescoReplacement({ storeProductId:'mapping',canonicalName:row.canonical,canonicalBrand:'Example',
        storeProductName:row.source,storeBrand:'Example',storeSku:'123456789',storeUrl:e.mapping.store_url,duplicateSkuCount:1 },
        { sku:'123456789',url:e.mapping.store_url,name:row.source,structuredQuantity:{grams:row.grams},evidenceSource:'tesco_direct_structured' });
      expect(legacy.classification === 'exact_replacement_candidate'
        || reviewedCanonicalEvidenceGap(e, e.page.parsed.products[0], legacy.reasons)).toBe(true);
      const result = await db.query<{conflict:boolean}>('select tesco_internal.material_title_conflict($1,$2,$3::jsonb) conflict', [row.canonical,row.source,JSON.stringify({grams:row.grams})]);
      expect(result.rows[0].conflict).toBe(false);
    });
    it(`rejects a different count despite equal total weight in ${row.canonical}`, async () => {
      const wrong = row.source.replace(/\b12\b/,'24').replace(/\b6\b/,'5');
      expect(independentExactIdentity(evidence(row.canonical,wrong,row.peer,row.grams))).toBe(false);
      const result = await db.query<{conflict:boolean}>('select tesco_internal.material_title_conflict($1,$2,$3::jsonb) conflict', [row.canonical,wrong,JSON.stringify({grams:row.grams})]);
      expect(result.rows[0].conflict).toBe(true);
    });
  }
  it('rejects a conflicting peer count', () => {
    expect(independentExactIdentity(evidence(cases[0].canonical,cases[0].source,cases[0].peer.replace('12','24'),71))).toBe(false);
  });
  it('retains the database single-versus-multipack rejection', async () => {
    const result = await db.query<{conflict:boolean}>("select tesco_internal.material_title_conflict('Example Milk 1L','Example Milk 6x1L','{\"millilitres\":6000}') conflict");
    expect(result.rows[0].conflict).toBe(true);
  });
});
