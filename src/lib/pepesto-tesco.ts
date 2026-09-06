import { supabaseAdmin } from '@/lib/supabase';
import { selectStoreProductsForRefresh } from '@/lib/store-refresh-selector';
import type { TescoQueueProduct } from '@/lib/tesco-queue-worker';

const BASE = 'https://s.pepesto.com/api';
export const PEPESTO_SEARCH_COST_CENTS = 32;
export const PEPESTO_BATCH_SIZE = 10;

type PricePromotion = { promo?: boolean; promo_percentage?: number };
type PricePerUnit = { price?: number; promotion?: PricePromotion };
type PepestoCandidate = { product_name?: string; name?: string; price?: PricePerUnit | number; price_cents?: number; product_id?: string; url?: string };
type PepestoProductWrapper = { product?: PepestoCandidate; session_token?: string; num_units_to_buy?: number };
type PepestoItem = { item_name?: string; products?: PepestoProductWrapper[]; candidates?: PepestoCandidate[]; results?: PepestoCandidate[] };
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function candidateName(c:PepestoCandidate){ return c.product_name || c.name || ''; }
function candidateUrl(c:PepestoCandidate){ return c.product_id || c.url || ''; }
function skuFromUrl(v:string){ return v.match(/\/products\/(\d+)/)?.[1] || null; }
function candidatePriceCents(c:PepestoCandidate){
  if(Number.isFinite(Number(c.price_cents)) && Number(c.price_cents)>0) return Number(c.price_cents);
  if(c.price && typeof c.price==='object' && Number.isFinite(Number(c.price.price)) && Number(c.price.price)>0) return Number(c.price.price);
  if(typeof c.price==='number' && c.price>0) return Math.round(c.price*100);
  return 0;
}
function candidatePromotion(c:PepestoCandidate){
  if(c.price && typeof c.price==='object') return { onPromotion:Boolean(c.price.promotion?.promo), promoPercentage:Number(c.price.promotion?.promo_percentage||0) };
  return { onPromotion:false, promoPercentage:0 };
}
function unwrapCandidates(item:PepestoItem):PepestoCandidate[]{
  const wrapped=(item.products||[]).map(x=>x?.product).filter((value): value is PepestoCandidate => Boolean(value));
  return [...wrapped,...(item.candidates||[]),...(item.results||[])];
}

async function key(){ const {data,error}=await supabaseAdmin.rpc('get_pepesto_api_key'); if(error||typeof data!=='string'||!data) throw new Error('Pepesto API key unavailable'); return data; }
async function post(path:string,body:unknown): Promise<unknown> { const k=await key(); const r=await fetch(`${BASE}${path}`,{method:'POST',headers:{authorization:`Bearer ${k}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body),cache:'no-store'}); const text=await r.text(); if(!r.ok) throw new Error(`Pepesto ${path} failed (${r.status}): ${text.slice(0,180)}`); return JSON.parse(text) as unknown; }

export async function getPepestoCreditsCents(){ const j=await post('/credits',{}); if(!isRecord(j)) return 0; return Number(j.euro_cents ?? j.credits_remaining ?? 0); }
export async function submitPepestoSearch(products:TescoQueueProduct[]){ if(products.length<1||products.length>10) throw new Error('Pepesto search batch must contain 1-10 products'); const j=await post('/search',{products:products.map(p=>p.storeProductName||p.canonicalName),supermarket_domain:'tesco.ie'}); if(!isRecord(j)||!j.search_session_id) throw new Error('Pepesto search did not return search_session_id'); return String(j.search_session_id); }
export async function retrievePepestoSearch(sessionId:string){ return post('/retrieve',{search_session_id:sessionId}); }

export async function selectPepestoTescoProducts(limit:number,query?:string){
  const rows=await selectStoreProductsForRefresh('tesco',limit,{query});
  return rows.map((r):TescoQueueProduct=>{
    const canonicalName=r.canonical_name||r.store_product_name||'';
    const fallbackUrl=`https://www.tesco.ie/shop/en-IE/search?query=${encodeURIComponent(canonicalName)}`;
    return {storeProductId:r.store_product_id,canonicalName,storeProductName:r.store_product_name||canonicalName,storeUrl:r.store_url||fallbackUrl,storeSku:r.store_sku||null,previousPrice:r.previous_price??null};
  });
}

export async function createPepestoRun(limit:number,query?:string){ const products=await selectPepestoTescoProducts(limit,query); if(!products.length) return null; const runId=`pepesto_tesco_${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`; const {data,error}=await supabaseAdmin.from('scrape_runs').insert({run_id:runId,store:'tesco',retrieval_method:'pepesto_search',started_at:new Date().toISOString(),status:'running',target_count:products.length,threshold_pct:70,attempted_count:0,fetched:0,extracted:0,inserted:0,unchanged_count:0,failed:0,silently_skipped_count:0,threshold_breached:false,scrapingbee_requests:0,scrapingbee_credits:0}).select('id').single(); if(error||!data?.id) throw new Error(`Failed opening Pepesto Tesco run: ${error?.message||'missing id'}`); return {runUuid:String(data.id),runId,products}; }

export function choosePepestoCandidate(product:TescoQueueProduct,item:PepestoItem){
  const candidates=unwrapCandidates(item).filter(c=>candidateName(c)&&candidatePriceCents(c)>0);
  // Pepesto search results can contain plausible but different products.
  // Tesco refreshes therefore require the retailer SKU embedded in the
  // returned product URL to match the stored mapping exactly.
  return candidates.find(c=>product.storeSku && skuFromUrl(candidateUrl(c))===product.storeSku)??null;
}

export async function finalizePepestoProduct(runUuid:string,product:TescoQueueProduct,candidate:PepestoCandidate|null){ if(!candidate){ const {error}=await supabaseAdmin.rpc('finalize_tesco_scrape_product',{p_run_uuid:runUuid,p_store_product_id:product.storeProductId,p_success:false,p_price:null,p_previous_price:product.previousPrice,p_store_url:product.storeUrl,p_store_sku:product.storeSku,p_store_product_name:product.storeProductName,p_fetched:1,p_extracted:0,p_scrapingbee_requests:0,p_scrapingbee_credits:0,p_failure_stage:'parsing',p_failure_reason:'pepesto_no_confident_match',p_canonical_name:product.canonicalName,p_raw_error:null}); if(error) throw new Error(`Pepesto failure finalization failed: ${error.message}`); return false; }
 const url=candidateUrl(candidate)||product.storeUrl, sku=skuFromUrl(url)||product.storeSku, name=candidateName(candidate), cents=candidatePriceCents(candidate), promo=candidatePromotion(candidate); const {error}=await supabaseAdmin.rpc('finalize_tesco_scrape_product_pepesto',{p_run_uuid:runUuid,p_store_product_id:product.storeProductId,p_price:cents/100,p_previous_price:product.previousPrice,p_store_url:url,p_store_sku:sku,p_store_product_name:name,p_on_promotion:promo.onPromotion,p_promo_percentage:promo.promoPercentage,p_canonical_name:product.canonicalName}); if(error) throw new Error(`Pepesto finalization failed: ${error.message}`); return true; }

export function extractPepestoItems(payload:unknown):PepestoItem[]{
  if(!isRecord(payload)) return [];
  if(Array.isArray(payload.items)) return payload.items.filter(isRecord) as PepestoItem[];
  if(Array.isArray(payload.results)) return payload.results.filter(isRecord) as PepestoItem[];
  return [];
}
