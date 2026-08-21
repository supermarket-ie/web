import { supabaseAdmin } from '@/lib/supabase';
import { choosePepestoCandidate, extractPepestoItems, finalizePepestoProduct, retrievePepestoSearch } from '@/lib/pepesto-tesco';
import type { TescoQueueProduct } from '@/lib/tesco-queue-worker';

export const dynamic='force-dynamic'; export const maxDuration=120;
function authorized(r:Request){const s=process.env.CRON_SECRET;return Boolean(s&&r.headers.get('authorization')===`Bearer ${s}`)}

export async function GET(request:Request){
 if(process.env.PEPESTO_TESCO_ENABLED!=='true') return Response.json({error:'Pepesto Tesco adapter disabled'},{status:503});
 if(!authorized(request)) return Response.json({error:'Unauthorized'},{status:401});
 const {data:sessions,error}=await supabaseAdmin.from('pepesto_tesco_sessions').select('id,run_uuid,search_session_id,products,status,submitted_at').in('status',['submitted','in_progress']).order('submitted_at',{ascending:true}).limit(20);
 if(error) return Response.json({error:error.message},{status:500});
 let completed=0,pending=0,matched=0,failed=0;
 for(const session of sessions??[]){
   try{
     const payload=await retrievePepestoSearch(session.search_session_id); const state=String(payload?.status||payload?.state||'').toLowerCase();
     if(state && !['done','complete','completed'].includes(state)){
       await supabaseAdmin.from('pepesto_tesco_sessions').update({status:'in_progress',result_summary:{state},last_error:null}).eq('id',session.id); pending++; continue;
     }
     const products=(session.products||[]) as TescoQueueProduct[]; const items=extractPepestoItems(payload); let batchMatched=0,batchFailed=0;
     for(let i=0;i<products.length;i++){
       const product=products[i]; const target=String(product.storeProductName||product.canonicalName).toLowerCase();
       const exact=items.find((x:any)=>String(x?.item_name||'').toLowerCase()===target); const item=exact||items[i]||{};
       const candidate=choosePepestoCandidate(product,item); const ok=await finalizePepestoProduct(session.run_uuid,product,candidate);
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
