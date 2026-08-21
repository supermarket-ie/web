import { supabaseAdmin } from '@/lib/supabase';
import { choosePepestoCandidate, extractPepestoItems, getPepestoCreditsCents, retrievePepestoSearch, selectPepestoTescoProducts, submitPepestoSearch } from '@/lib/pepesto-tesco';
import type { TescoQueueProduct } from '@/lib/tesco-queue-worker';

export const dynamic='force-dynamic'; export const maxDuration=120;
const RUN_ID='pepesto_tesco_canary_20260821';
function authorized(r:Request){const s=process.env.CRON_SECRET;return Boolean(s&&r.headers.get('authorization')===`Bearer ${s}`)}

export async function GET(request:Request){
  if(!authorized(request)) return Response.json({error:'Unauthorized'},{status:401});
  const mode=new URL(request.url).searchParams.get('mode')||'submit';
  if(mode==='submit'){
    const {data:existing}=await supabaseAdmin.from('scrape_runs').select('id,status').eq('run_id',RUN_ID).maybeSingle();
    if(existing) return Response.json({status:'already_created',run_uuid:existing.id,run_status:existing.status});
    const products=await selectPepestoTescoProducts(20);
    if(products.length!==20) return Response.json({error:`Expected 20 products, got ${products.length}`},{status:500});
    const credits=await getPepestoCreditsCents(); if(credits<64) return Response.json({error:'Insufficient credits',credits_cents:credits},{status:402});
    const {data:run,error}=await supabaseAdmin.from('scrape_runs').insert({run_id:RUN_ID,store:'tesco',retrieval_method:'pepesto_search_dry_run',started_at:new Date().toISOString(),status:'running',target_count:20,threshold_pct:70,attempted_count:0,fetched:0,extracted:0,inserted:0,unchanged_count:0,failed:0,silently_skipped_count:0,threshold_breached:false,scrapingbee_requests:0,scrapingbee_credits:0}).select('id').single();
    if(error||!run?.id) return Response.json({error:error?.message||'run insert failed'},{status:500});
    const sessions:string[]=[];
    for(let i=0;i<products.length;i+=10){
      const batch=products.slice(i,i+10); const sid=await submitPepestoSearch(batch); sessions.push(sid);
      const {error:sessionError}=await supabaseAdmin.from('pepesto_tesco_sessions').insert({run_uuid:run.id,search_session_id:sid,batch_index:i/10,products:batch,status:'submitted'});
      if(sessionError) return Response.json({error:sessionError.message,sessions},{status:500});
    }
    return Response.json({status:'submitted_dry_run',run_uuid:run.id,sessions,cost_cents:64,credits_before_cents:credits});
  }

  if(mode==='retrieve'){
    const {data:run}=await supabaseAdmin.from('scrape_runs').select('id,status').eq('run_id',RUN_ID).maybeSingle(); if(!run) return Response.json({error:'Canary run not found'},{status:404});
    const {data:sessions,error}=await supabaseAdmin.from('pepesto_tesco_sessions').select('id,search_session_id,products,status').eq('run_uuid',run.id).order('batch_index'); if(error) return Response.json({error:error.message},{status:500});
    let matched=0,failed=0,pending=0,totalCandidates=0;
    for(const session of sessions??[]){
      if(session.status==='done') { const s=session as any; matched+=Number(s.result_summary?.matched||0); failed+=Number(s.result_summary?.failed||0); totalCandidates+=Number(s.result_summary?.candidates||0); continue; }
      const payload=await retrievePepestoSearch(session.search_session_id); const state=String(payload?.status||payload?.state||'').toLowerCase();
      if(state && !['done','complete','completed'].includes(state)){ pending++; await supabaseAdmin.from('pepesto_tesco_sessions').update({status:'in_progress',result_summary:{state}}).eq('id',session.id); continue; }
      const products=(session.products||[]) as TescoQueueProduct[]; const items=extractPepestoItems(payload); let batchMatched=0,batchFailed=0,batchCandidates=0;
      for(let i=0;i<products.length;i++){ const p=products[i]; const target=String(p.storeProductName||p.canonicalName).toLowerCase(); const item=items.find((x:any)=>String(x?.item_name||'').toLowerCase()===target)||items[i]||{}; const candidates=(item as any).candidates||(item as any).products||(item as any).results||[]; batchCandidates+=Array.isArray(candidates)?candidates.length:0; if(choosePepestoCandidate(p,item)) batchMatched++; else batchFailed++; }
      matched+=batchMatched; failed+=batchFailed; totalCandidates+=batchCandidates;
      await supabaseAdmin.from('pepesto_tesco_sessions').update({status:'done',retrieved_at:new Date().toISOString(),result_summary:{matched:batchMatched,failed:batchFailed,candidates:batchCandidates,dry_run:true}}).eq('id',session.id);
    }
    if(pending===0){ const coverage=Number(((matched/20)*100).toFixed(2)); await supabaseAdmin.from('scrape_runs').update({status:coverage>=70?'success':'degraded',finished_at:new Date().toISOString(),attempted_count:20,fetched:totalCandidates,extracted:matched,failed,coverage_pct:coverage,error_summary:JSON.stringify({dry_run:true,matched,failed,total_candidates:totalCandidates,coverage_pct:coverage})}).eq('id',run.id); return Response.json({status:'complete_dry_run',matched,failed,total_candidates:totalCandidates,coverage_pct:coverage}); }
    return Response.json({status:'pending',matched,failed,pending,total_candidates:totalCandidates});
  }
  return Response.json({error:'Invalid mode'},{status:400});
}
