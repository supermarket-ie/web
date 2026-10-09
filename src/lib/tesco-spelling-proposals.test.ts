import {describe,it,expect,vi} from 'vitest';
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{}}));
import {validateTescoCollectedIdentity as check,type TescoCollectedProduct} from './tesco-direct-collection-core';
import {isDirectMappingCompatible} from './supervalu-direct-worker-base';
import {directResolvedCandidate} from './dunnes-queue-worker-base';
// Public catalogue fixtures for review only. No mutation or network access.
const fixtures = [
  {
    "oldName": "Batchelors Marrowfat Peas 420g",
    "name": "Batchelors Marrow Fat Peas 420g",
    "product": {
      "sku": "250817417",
      "url": "https://www.tesco.ie/shop/en-IE/products/250817417",
      "gtin": "05011001100649",
      "name": "Batchelors Marrow Fat Peas 420G",
      "brand": "BATCHELORS",
      "price": 1.9,
      "currency": "EUR",
      "quantity": null,
      "available": true
    },
    "brand": "Batchelors",
    "peers": [
      {
        "store": "dunnes",
        "name": "Batchelors Marrowfat Peas 420g",
        "sku": "100110053",
        "url": "https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/batchelors-marrowfat-peas-420g/100110053",
        "price": 1.5
      },
      {
        "store": "supervalu",
        "name": "Batchelors Marrowfat Peas (420 g)",
        "sku": "1008113000",
        "url": "https://shop.supervalu.ie/sm/delivery/rsid/5550/product/product-id-1008113000",
        "price": 1.99
      }
    ]
  },
  {
    "oldName": "Airwick Pure Cherry Blossom Aerosol 250ml",
    "name": "Air Wick Pure Cherry Blossom Aerosol 250ml",
    "product": {
      "sku": "289879442",
      "url": "https://www.tesco.ie/shop/en-IE/products/289879442",
      "gtin": "05011417563892",
      "name": "Air Wick Pure Aerosol Cherry Blossom Air Freshener 250ml",
      "brand": "AIR WICK",
      "price": 5,
      "currency": "EUR",
      "quantity": null,
      "available": true
    },
    "brand": "Air Wick",
    "peers": [
      {
        "store": "dunnes",
        "name": "Air Wick Pure Aerosol, Cherry Blossom Air Freshener, 250ml",
        "sku": "100832139",
        "url": "https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/air-wick-pure-aerosol-cherry-blossom-air-freshener-250ml/100832139",
        "price": 4.0
      },
      {
        "store": "supervalu",
        "name": "Airwick Pure Cherry Blossom Aerosol  (250 ml)",
        "sku": "1457073000",
        "url": "https://shop.supervalu.ie/sm/delivery/rsid/5550/product/product-id-1457073000",
        "price": 4.0
      }
    ]
  },
  {
    "oldName": "Airwick Pure Spring Delight Aerosol 250ml",
    "name": "Air Wick Pure Spring Delight Aerosol 250ml",
    "product": {
      "sku": "289879669",
      "url": "https://www.tesco.ie/shop/en-IE/products/289879669",
      "gtin": "05011417563878",
      "name": "Air Wick Pure Aerosol Spring Delight Air Freshener 250ml",
      "brand": "AIR WICK",
      "price": 5,
      "currency": "EUR",
      "quantity": null,
      "available": true
    },
    "brand": "Air Wick",
    "peers": [
      {
        "store": "supervalu",
        "name": "Airwick Pure Spring Delight Aerosol (250 ml)",
        "sku": "1457076000",
        "url": "https://shop.supervalu.ie/sm/delivery/rsid/5550/product/product-id-1457076000",
        "price": 4.0
      },
      {
        "store": "dunnes",
        "name": "Air Wick Pure Aerosol, Spring Delight Air Freshener, 250ml",
        "sku": "100832142",
        "url": "https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/air-wick-pure-aerosol-spring-delight-air-freshener-250ml/100832142",
        "price": 4.0
      }
    ]
  },
  {
    "oldName": "Brennans Bakehouse Multiseed 500g",
    "name": "Brennans Bakehouse Multi Seed 500g",
    "product": {
      "sku": "310099748",
      "url": "https://www.tesco.ie/shop/en-IE/products/310099748",
      "gtin": "05011059002148",
      "name": "Brennans Bakehouse Multi Seed 500G",
      "brand": "Brennans",
      "price": 2.75,
      "currency": "EUR",
      "quantity": null,
      "available": true
    },
    "brand": "Brennans",
    "peers": [
      {
        "store": "dunnes",
        "name": "Brennans Bakehouse Multiseed 500g",
        "sku": "100229900",
        "url": "https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/brennans-bakehouse-multiseed-500g/100229900",
        "price": 2.75
      },
      {
        "store": "supervalu",
        "name": "Brennans Bakehouse Multiseed (500 g)",
        "sku": "1767390001",
        "url": "https://shop.supervalu.ie/sm/delivery/rsid/5550/product/product-id-1767390001",
        "price": 2.75
      }
    ]
  },
  {
    "oldName": "Airwick Pure Soft Cotton Aerosol 250ml",
    "name": "Air Wick Pure Soft Cotton Aerosol 250ml",
    "product": {
      "sku": "295496617",
      "url": "https://www.tesco.ie/shop/en-IE/products/295496617",
      "gtin": "05011417565421",
      "name": "Air Wick Pure Aerosol Soft Cotton Air Freshener 250ml",
      "brand": "AIR WICK",
      "price": 5,
      "currency": "EUR",
      "quantity": null,
      "available": true
    },
    "brand": "Air Wick",
    "peers": [
      {
        "store": "supervalu",
        "name": "Airwick Pure Soft Cotton Aerosol  (250 ml)",
        "sku": "1550253000",
        "url": "https://shop.supervalu.ie/sm/delivery/rsid/5550/product/product-id-1550253000",
        "price": 1.0
      },
      {
        "store": "dunnes",
        "name": "Air Wick Pure Aerosol, Soft Cotton Air Freshener, 250ml",
        "sku": "100841530",
        "url": "https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/air-wick-pure-aerosol-soft-cotton-air-freshener-250ml/100841530",
        "price": 4.0
      }
    ]
  }
] ;
describe('proposed Tesco spelling repairs (not applied)',()=>{
for(const f of fixtures){const p=f.product as TescoCollectedProduct;const mapping={storeProductId:'fixture',canonicalName:f.name,canonicalBrand:f.brand,storeProductName:p.name,storeBrand:p.brand,isOwnBrand:false,storeSku:p.sku,storeUrl:p.url,duplicateSkuCount:1,duplicateCanonicalNames:[f.name],isFresh:false};
it(f.oldName+' establishes the same identity only with the proposed spelling',()=>{expect(check({...mapping,canonicalName:f.oldName},p).length).toBeGreaterThan(0);expect(check(mapping,p)).toEqual([]);});
it(f.name+' preserves peer compatibility',()=>{for(const peer of f.peers){const m={storeProductId:'peer',canonicalName:f.name,storeProductName:peer.name,storeSku:peer.sku,storeUrl:peer.url,previousPrice:peer.price};const c={name:peer.name,sku:peer.sku,url:peer.url,price:peer.price,wasPrice:null,onPromotion:false};if(peer.store==='supervalu')expect(isDirectMappingCompatible(m,c)).toBe(true);if(peer.store==='dunnes')expect(directResolvedCandidate(m,[c])).not.toBeNull();}});
it(f.name+' rejects negative controls',()=>{const brandPattern=new RegExp(f.brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig');const badBrand={...p,name:p.name.replace(brandPattern,'OtherBrand'),brand:'OtherBrand'};const variant=p.name.replace(/Marrow Fat Peas/i,'Mushy Peas').replace(/Multi Seed/i,'White').replace(/Cherry Blossom|Spring Delight|Soft Cotton/i,'Fresh Linen');for(const bad of [{...p,sku:'999999999'},{...p,available:false},{...p,price:null},{...p,name:p.name.replace(/\d+(?:\.\d+)?\s*(?:g|ml)\b/ig,'9999g'),quantity:{grams:9999}},badBrand,{...p,name:variant}])expect(check(mapping,bad).length).toBeGreaterThan(0);});
}
});
