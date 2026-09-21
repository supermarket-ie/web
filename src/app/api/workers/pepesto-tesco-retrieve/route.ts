import { supabaseAdmin } from '@/lib/supabase';
import { choosePepestoCandidate, extractPepestoCandidates, extractPepestoItems, finalizePepestoProduct, normalizePepestoCandidate, retrievePepestoSearch } from '@/lib/pepesto-tesco';
import type { TescoQueueProduct } from '@/lib/tesco-queue-worker';
import { classifyTescoReplacement, type TescoMappingEvidence } from '@/lib/tesco-mapping-audit';

export const dynamic='force-dynamic'; export const maxDuration=300;
function authorized(r:Request){const s=process.env.CRON_SECRET;return Boolean(s&&r.headers.get('authorization')===`Bearer ${s}`)}
function responseState(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const row = payload as Record<string, unknown>;
  return String(row.status || row.state || '').toLowerCase();
}

async function finalizeCandidateDiscovery(runUuid:string,product:TescoQueueProduct,payload:unknown){
 const mapping:TescoMappingEvidence={
   storeProductId:product.storeProductId,
   canonicalName:product.canonicalName,
   canonicalBrand:product.canonicalBrand??null,
   storeProductName:product.storeProductName,
   storeBrand:product.storeBrand??null,
   isOwnBrand:product.isOwnBrand??null,
   storeSku:product.storeSku,
   storeUrl:product.storeUrl,
   duplicateSkuCount:1,
   isFresh:false,
 };
 const rows=extractPepestoCandidates(payload).map((rawCandidate,candidateIndex)=>{
   const candidate=normalizePepestoCandidate(rawCandidate);
   const classified=classifyTescoReplacement(mapping,{
     sku:candidate.sku??'',url:candidate.url,name:candidate.name,
     evidenceSource:'pepesto-search-single',
   });
   const audit=candidate.name&&candidate.priceCents>0?classified:{
     ...classified,
     classification:'insufficient_evidence' as const,
     reasons:['candidate requires a non-empty name and positive observed price'],
   };
   return {
     run_uuid:runUuid,
     store_product_id:product.storeProductId,
     candidate_index:candidateIndex,
     query_text:product.canonicalName,
     candidate_name:candidate.name||null,
     candidate_url:candidate.url||null,
     candidate_sku:candidate.sku,
     candidate_price_cents:candidate.priceCents||null,
     classification:audit.classification,
     reasons:audit.reasons,
     identity_signals:audit.signals,
     raw_candidate:rawCandidate,
   };
 });
 let persisted:Array<{id:string;candidate_sku:string|null;classification:string}>=[];
 if(rows.length){
   const {data,error}=await supabaseAdmin.from('tesco_candidate_discovery_evidence')
     .upsert(rows,{onConflict:'run_uuid,store_product_id,candidate_index'})
     .select('id,candidate_sku,classification');
   if(error) throw new Error(`Failed persisting Tesco candidate evidence: ${error.message}`);
   persisted=(data??[]) as typeof persisted;
 }
 const exact=persisted.filter(row=>row.classification==='exact_replacement_candidate'&&row.candidate_sku);
 const exactSkus=new Set(exact.map(row=>row.candidate_sku));
 if(exact.length&&exactSkus.size===1){
   const {error}=await supabaseAdmin.rpc('finalize_tesco_candidate_discovery',{
     p_run_uuid:runUuid,
     p_candidate_id:exact[0].id,
     p_previous_price:product.previousPrice,
     p_on_promotion:false,
   });
   if(error) throw new Error(`Tesco candidate finalization failed: ${error.message}`);
   return true;
 }
 await finalizePepestoProduct(runUuid,product,null);
 return false;
}

export async function GET(request:Request){
 if(!authorized(request)) return Response.json({error:'Unauthorized'},{status:401});
 const requested=Number(new URL(request.url).searchParams.get('limit')||50);
 const limit=Math.max(1,Math.min(Number.isFinite(requested)?Math.floor(requested):50,50));
 const {data:sessions,error}=await supabaseAdmin.from('pepesto_tesco_sessions').select('id,run_uuid,search_session_id,products,status,submitted_at').in('status',['submitted','in_progress']).order('submitted_at',{ascending:true}).limit(limit);
 if(error) return Response.json({error:error.message},{status:500});
 let completed=0,pending=0,matched=0,failed=0;
 for(const session of sessions??[]){
   try{
     const payload=await retrievePepestoSearch(session.search_session_id); const state=responseState(payload);
     if(state && !['done','complete','completed'].includes(state)){
       await supabaseAdmin.from('pepesto_tesco_sessions').update({status:'in_progress',result_summary:{state},last_error:null}).eq('id',session.id); pending++; continue;
     }
     const products=(session.products||[]) as TescoQueueProduct[]; const items=extractPepestoItems(payload); let batchMatched=0,batchFailed=0;
     for(let i=0;i<products.length;i++){
       const product=products[i];
       let ok=false;
       if(product.discoveryMode==='audited_candidate_discovery'){
         ok=await finalizeCandidateDiscovery(session.run_uuid,product,payload);
       }else{
         const target=String(product.storeProductName||product.canonicalName).toLowerCase();
         const exact=items.find(x=>String(x?.item_name||'').toLowerCase()===target); const item=exact||items[i]||{};
         const candidate=choosePepestoCandidate(product,item); ok=await finalizePepestoProduct(session.run_uuid,product,candidate);
       }
       if(ok){matched++;batchMatched++;} else {failed++;batchFailed++;}
     }
     await supabaseAdmin.from('pepesto_tesco_sessions').update({status:'done',retrieved_at:new Date().toISOString(),result_summary:{items:items.length,matched:batchMatched,failed:batchFailed},last_error:null}).eq('id',session.id); completed++;
   }catch(e){
     const msg=e instanceof Error?e.message:String(e); const ageMs=Date.now()-new Date(session.submitted_at).getTime();
     await supabaseAdmin.from('pepesto_tesco_sessions').update({status:ageMs>2*60*60*1000?'failed':'in_progress',retrieved_at:ageMs>2*60*60*1000?new Date().toISOString():null,last_error:msg.slice(0,500)}).eq('id',session.id);
     if(ageMs>2*60*60*1000) failed++; else pending++;
   }
 }
 return Response.json({status:'ok',sessions_checked:(sessions??[]).length,completed,pending,matched,failed});
}
