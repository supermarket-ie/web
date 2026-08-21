import { supabaseAdmin } from '@/lib/supabase';
import { selectTescoProducts, type TescoQueueProduct } from '@/lib/tesco-queue-worker';

const BASE = 'https://s.pepesto.com/api';
export const PEPESTO_SEARCH_COST_CENTS = 32;
export const PEPESTO_BATCH_SIZE = 10;

type PepestoCandidate = { product_name?: string; name?: string; price_cents?: number; price?: number; product_id?: string; url?: string };
type PepestoItem = { item_name?: string; candidates?: PepestoCandidate[]; products?: PepestoCandidate[]; results?: PepestoCandidate[] };

function norm(v: string) { return v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function size(v: string) { const m=norm(v).match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|pack|pk)\b/); if(!m) return null; let q=Number(m[1]); let u=m[2]; if(u==='kg'){q*=1000;u='g';} if(u==='l'){q*=1000;u='ml';} if(u==='pk')u='pack'; return {q,u}; }
function compatible(a:string,b:string){ const x=size(a),y=size(b); if(!x||!y) return true; return x.u===y.u && Math.max(x.q,y.q)/Math.min(x.q,y.q)<=1.1; }
function score(a:string,b:string){ const aa=norm(a).split(' ').filter(x=>x.length>2), bb=new Set(norm(b).split(' ').filter(x=>x.length>2)); if(!aa.length) return 0; return aa.filter(x=>bb.has(x)).length/aa.length; }
function candidateName(c:PepestoCandidate){ return c.product_name || c.name || ''; }
function candidateUrl(c:PepestoCandidate){ return c.product_id || c.url || ''; }
function skuFromUrl(v:string){ return v.match(/\/products\/(\d+)/)?.[1] || null; }

async function key(){ const {data,error}=await supabaseAdmin.rpc('get_pepesto_api_key'); if(error||typeof data!=='string'||!data) throw new Error('Pepesto API key unavailable'); return data; }
async function post(path:string,body:unknown){ const k=await key(); const r=await fetch(`${BASE}${path}`,{method:'POST',headers:{authorization:`Bearer ${k}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body),cache:'no-store'}); const text=await r.text(); if(!r.ok) throw new Error(`Pepesto ${path} failed (${r.status}): ${text.slice(0,180)}`); return JSON.parse(text); }

export async function getPepestoCreditsCents(){ const j=await post('/credits',{}); return Number(j?.euro_cents ?? j?.credits_remaining ?? 0); }
export async function submitPepestoSearch(products:TescoQueueProduct[]){ if(products.length<1||products.length>10) throw new Error('Pepesto search batch must contain 1-10 products'); const j=await post('/search',{products:products.map(p=>p.storeProductName||p.canonicalName),supermarket_domain:'tesco.ie'}); if(!j?.search_session_id) throw new Error('Pepesto search did not return search_session_id'); return String(j.search_session_id); }
export async function retrievePepestoSearch(sessionId:string){ return post('/retrieve',{search_session_id:sessionId}); }

export async function createPepestoRun(limit:number,query?:string){ const products=await selectTescoProducts(limit,query); if(!products.length) return null; const runId=`pepesto_tesco_${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`; const {data,error}=await supabaseAdmin.from('scrape_runs').insert({run_id:runId,store:'tesco',retrieval_method:'pepesto_search',started_at:new Date().toISOString(),status:'running',target_count:products.length,threshold_pct:70,attempted_count:0,fetched:0,extracted:0,inserted:0,unchanged_count:0,failed:0,silently_skipped_count:0,threshold_breached:false,scrapingbee_requests:0,scrapingbee_credits:0}).select('id').single(); if(error||!data?.id) throw new Error(`Failed opening Pepesto Tesco run: ${error?.message||'missing id'}`); return {runUuid:String(data.id),runId,products}; }

export function choosePepestoCandidate(product:TescoQueueProduct,item:PepestoItem){ const candidates=(item.candidates||item.products||item.results||[]).filter(c=>candidateName(c)&&Number(c.price_cents ?? (Number(c.price||0)*100))>0); const exactSku=candidates.find(c=>product.storeSku && skuFromUrl(candidateUrl(c))===product.storeSku); if(exactSku) return exactSku; let best:PepestoCandidate|null=null,bestScore=0; for(const c of candidates){ const n=candidateName(c); if(!compatible(product.storeProductName||product.canonicalName,n)) continue; const s=Math.max(score(product.storeProductName,n),score(product.canonicalName,n)); if(s>bestScore){bestScore=s;best=c;} } return bestScore>=0.72?best:null; }

export async function finalizePepestoProduct(runUuid:string,product:TescoQueueProduct,candidate:PepestoCandidate|null){ if(!candidate){ await supabaseAdmin.rpc('finalize_tesco_scrape_product',{p_run_uuid:runUuid,p_store_product_id:product.storeProductId,p_success:false,p_price:null,p_previous_price:product.previousPrice,p_store_url:product.storeUrl,p_store_sku:product.storeSku,p_store_product_name:product.storeProductName,p_fetched:1,p_extracted:0,p_scrapingbee_requests:0,p_scrapingbee_credits:0,p_failure_stage:'parsing',p_failure_reason:'pepesto_no_confident_match',p_canonical_name:product.canonicalName,p_raw_error:null}); return false; }
 const url=candidateUrl(candidate)||product.storeUrl, sku=skuFromUrl(url)||product.storeSku, name=candidateName(candidate), cents=Number(candidate.price_cents ?? Math.round(Number(candidate.price||0)*100)); const {error}=await supabaseAdmin.rpc('finalize_tesco_scrape_product',{p_run_uuid:runUuid,p_store_product_id:product.storeProductId,p_success:true,p_price:cents/100,p_previous_price:product.previousPrice,p_store_url:url,p_store_sku:sku,p_store_product_name:name,p_fetched:1,p_extracted:1,p_scrapingbee_requests:0,p_scrapingbee_credits:0,p_failure_stage:null,p_failure_reason:null,p_canonical_name:product.canonicalName,p_raw_error:null}); if(error) throw new Error(`Pepesto finalization failed: ${error.message}`); return true; }

export function extractPepestoItems(payload:any):PepestoItem[]{ if(Array.isArray(payload?.items)) return payload.items; if(Array.isArray(payload?.results)) return payload.results; return []; }
