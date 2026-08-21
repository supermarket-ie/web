import { supabaseAdmin } from '@/lib/supabase';
import { createPepestoRun, getPepestoCreditsCents, PEPESTO_BATCH_SIZE, PEPESTO_SEARCH_COST_CENTS, submitPepestoSearch } from '@/lib/pepesto-tesco';

export const dynamic='force-dynamic'; export const maxDuration=120;
function authorized(r:Request){const s=process.env.CRON_SECRET;return Boolean(s&&r.headers.get('authorization')===`Bearer ${s}`)}
function int(v:string|null,f:number,m:number){const n=Number(v);return Number.isFinite(n)&&n>0?Math.min(Math.floor(n),m):f}

export async function GET(request:Request){
 if(process.env.PEPESTO_TESCO_ENABLED!=='true') return Response.json({error:'Pepesto Tesco adapter disabled'},{status:503});
 if(!authorized(request)) return Response.json({error:'Unauthorized'},{status:401});
 const u=new URL(request.url), limit=int(u.searchParams.get('limit'),100,500), query=u.searchParams.get('q')?.trim()||undefined;
 const dailyCap=int(process.env.PEPESTO_TESCO_DAILY_CAP_CENTS??null,1000,10000);
 const since=new Date(); since.setUTCHours(0,0,0,0);
 const {count}=await supabaseAdmin.from('pepesto_tesco_sessions').select('id',{count:'exact',head:true}).gte('submitted_at',since.toISOString());
 const spent=(count||0)*PEPESTO_SEARCH_COST_CENTS;
 if(spent>=dailyCap) return Response.json({error:'Daily Pepesto spend cap reached',spent_cents:spent,cap_cents:dailyCap},{status:429});
 const run=await createPepestoRun(limit,query); if(!run) return Response.json({status:'no_products',submitted:0});
 const batches=[] as any[]; let submitted=0;
 try{
   const needed=Math.ceil(run.products.length/PEPESTO_BATCH_SIZE)*PEPESTO_SEARCH_COST_CENTS;
   if(spent+needed>dailyCap) throw new Error(`Run would exceed daily Pepesto cap (${spent}+${needed}>${dailyCap})`);
   const credits=await getPepestoCreditsCents(); if(credits<needed) throw new Error(`Insufficient Pepesto credits (${credits} cents; need ${needed})`);
   for(let i=0;i<run.products.length;i+=PEPESTO_BATCH_SIZE){ const products=run.products.slice(i,i+PEPESTO_BATCH_SIZE); const sid=await submitPepestoSearch(products); const {error}=await supabaseAdmin.from('pepesto_tesco_sessions').insert({run_uuid:run.runUuid,search_session_id:sid,batch_index:i/PEPESTO_BATCH_SIZE,products,status:'submitted'}); if(error) throw new Error(error.message); submitted+=products.length; batches.push(sid); }
   return Response.json({status:'submitted',run_id:run.runId,run_uuid:run.runUuid,target:run.products.length,submitted,sessions:batches,estimated_cost_cents:Math.ceil(run.products.length/10)*32,credits_before_cents:credits});
 }catch(e){const msg=e instanceof Error?e.message:String(e);await supabaseAdmin.from('scrape_runs').update({status:'failed',finished_at:new Date().toISOString(),error_summary:msg.slice(0,500)}).eq('id',run.runUuid);return Response.json({error:msg,submitted},{status:500});}
}
