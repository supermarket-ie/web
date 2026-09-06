import { supabaseAdmin } from '@/lib/supabase';
import { createPepestoRun, getPepestoCreditsCents, PEPESTO_BATCH_SIZE, submitPepestoSearch } from '@/lib/pepesto-tesco';

export const dynamic='force-dynamic'; export const maxDuration=120;
function authorized(r:Request){const s=process.env.CRON_SECRET;return Boolean(s&&r.headers.get('authorization')===`Bearer ${s}`)}
function int(v:string|null,f:number,m:number){const n=Number(v);return Number.isFinite(n)&&n>0?Math.min(Math.floor(n),m):f}

export async function GET(request:Request){
 if(!authorized(request)) return Response.json({error:'Unauthorized'},{status:401});
 const u=new URL(request.url), limit=int(u.searchParams.get('limit'),100,500), query=u.searchParams.get('q')?.trim()||undefined;
 const dailyCap=int(process.env.PEPESTO_TESCO_DAILY_CAP_CENTS??null,1000,10000);
 const since=new Date(); since.setUTCHours(0,0,0,0);
 const {data:costRows,error:costError}=await supabaseAdmin.from('scrape_runs').select('pepesto_actual_cost_cents').eq('store','tesco').eq('retrieval_method','pepesto_search').gte('started_at',since.toISOString());
 if(costError) return Response.json({error:`Unable to verify today's Pepesto spend: ${costError.message}`},{status:500});
 const spent=(costRows??[]).reduce((sum,row)=>sum+Number(row.pepesto_actual_cost_cents||0),0);
 if(spent>=dailyCap) return Response.json({error:'Daily Pepesto spend cap reached',spent_cents:spent,cap_cents:dailyCap},{status:429});
 const creditsBefore=await getPepestoCreditsCents();
 if(creditsBefore<=0) return Response.json({error:'No Pepesto credits available',credits_before_cents:creditsBefore},{status:402});
 const run=await createPepestoRun(limit,query); if(!run) return Response.json({status:'no_products',submitted:0});
 const batches:string[]=[]; const observedBatchCosts:number[]=[]; let submitted=0,creditsAfter=creditsBefore,actualCost=0;
 try{
   for(let i=0;i<run.products.length;i+=PEPESTO_BATCH_SIZE){
     if(creditsAfter<=0) throw new Error('Pepesto balance exhausted before all batches were submitted');
     const products=run.products.slice(i,i+PEPESTO_BATCH_SIZE),batchCreditsBefore=creditsAfter;
     const sid=await submitPepestoSearch(products);
     creditsAfter=await getPepestoCreditsCents();
     const batchCost=Math.max(0,batchCreditsBefore-creditsAfter); actualCost+=batchCost; observedBatchCosts.push(batchCost);
     const {error}=await supabaseAdmin.from('pepesto_tesco_sessions').insert({run_uuid:run.runUuid,search_session_id:sid,batch_index:i/PEPESTO_BATCH_SIZE,products,status:'submitted'}); if(error) throw new Error(error.message);
     submitted+=products.length; batches.push(sid);
     await supabaseAdmin.from('scrape_runs').update({pepesto_credits_before_cents:creditsBefore,pepesto_credits_after_cents:creditsAfter,pepesto_actual_cost_cents:actualCost}).eq('id',run.runUuid);
     if(spent+actualCost>=dailyCap && submitted<run.products.length) throw new Error(`Daily Pepesto spend cap reached after ${submitted} products`);
   }
   return Response.json({status:'submitted',run_id:run.runId,run_uuid:run.runUuid,target:run.products.length,submitted,sessions:batches,credits_before_cents:creditsBefore,credits_after_cents:creditsAfter,actual_cost_cents:actualCost,observed_batch_costs_cents:observedBatchCosts});
 }catch(e){const msg=e instanceof Error?e.message:String(e);await supabaseAdmin.from('scrape_runs').update({status:'failed',finished_at:new Date().toISOString(),error_summary:msg.slice(0,500),pepesto_credits_before_cents:creditsBefore,pepesto_credits_after_cents:creditsAfter,pepesto_actual_cost_cents:actualCost}).eq('id',run.runUuid);return Response.json({error:msg,submitted,credits_before_cents:creditsBefore,credits_after_cents:creditsAfter,actual_cost_cents:actualCost},{status:500});}
}
