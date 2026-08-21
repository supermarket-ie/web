import { supabaseAdmin } from '@/lib/supabase';
import { choosePepestoCandidate, extractPepestoItems, finalizePepestoProduct, retrievePepestoSearch } from '@/lib/pepesto-tesco';
import type { TescoQueueProduct } from '@/lib/tesco-queue-worker';

export const dynamic='force-dynamic'; export const maxDuration=120;
function authorized(r:Request){const s=process.env.CRON_SECRET;return Boolean(s&&r.headers.get('authorization')===`Bearer ${s}`)}

export async function GET(request:Request){
 if(process.env.PEPESTO_TESCO_ENABLED!=='true') return Response.json({error:'Pepesto Tesco adapter disabled'},{status:503});
 if(!authorized(request)) return Response.json({error:'Unauthorized'},{status:401});
 const {data:sessions,error}=await supabaseAdmin.from('pepesto_tesco_sessions').select('id,run_uuid,search_session_id,products,status').in('status',['submitted','in_progress']).order('submitted_at',{ascending:true}).limit(20);
 if(error) return Response.json({error:error.message},{status:500});
 let completed=0,pending=0,matched=0,failed=0;
 for(const session of sessions??[]){
   try{
     const payload=await retrievePepestoSearch(session.search_session_id); const state=String(payload?.status||payload?.state||'').toLowerCase();
     if(state && state!=='done' && state!=='complete' && state!=='completed'){
       await supabaseAdmin.from('pepesto_tesco_sessions').update({status:'in_progress',result_summary:{state}}).eq('id',session.id); pending++; continue;
     }
     const products=(session.products||[]) as TescoQueueProduct[]; const items=extractPepestoItems(payload);
     for(let i=0;i<products.length;i++){ const product=products[i]; const exact=items.find((x:any)=>String(x?.item_name||'').toLowerCase()===String(product.storeProductName||product.canonicalName).toLowerCase()); const item=exact||items[i]||{}; const candidate=choosePepestoCandidate(product,item); const ok=await finalizePepestoProduct(session.run_uuid,product,candidate); if(ok) matched++; else failed++; }
     await supabaseAdmin.from('pepesto_tesco_sessions').update({status:'done',retrieved_at:new Date().toISOString(),result_summary:{items:items.length,matched:products.length-failed}}).eq('id',session.id); completed++;
   }catch(e){const msg=e instanceof Error?e.message:String(e);await supabaseAdmin.from('pepesto_tesco_sessions').update({status:'failed',retrieved_at:new Date().toISOString(),last_error:msg.slice(0,500)}).eq('id',session.id); failed++;}
 }
 return Response.json({status:'ok',sessions_checked:(sessions??[]).length,completed,pending,matched,failed});
}
