import { send } from '@vercel/queue';
import { createPepestoProductsRun, getPepestoCreditsCents, selectUntouchedPepestoTescoProducts } from '@/lib/pepesto-tesco';
import { supabaseAdmin } from '@/lib/supabase';
import { selectProvenPepestoTescoProducts } from '@/lib/tesco-proven-refresh';

const TOPIC='pepesto-tesco-products-batches';

function authorized(request:Request){const secret=process.env.CRON_SECRET;return Boolean(secret&&request.headers.get('authorization')===`Bearer ${secret}`);}

export async function GET(request:Request){
  if(!authorized(request)) return Response.json({error:'Unauthorized'},{status:401});
  const url=new URL(request.url);
  const cohort=url.searchParams.get('cohort')||'untouched';
  if(cohort==='proven_search_success'&&url.searchParams.get('confirm')!=='proven-products-canary') return Response.json({error:'Explicit proven-products-canary confirmation is required'},{status:400});
  if(!['untouched','proven_search_success'].includes(cohort)) return Response.json({error:'Unsupported Tesco products cohort'},{status:400});
  const requested=Number(url.searchParams.get('limit')||50);
  const limit=Math.max(1,Math.min(Number.isFinite(requested)?Math.floor(requested):50,50));
  const since=new Date(); since.setUTCHours(0,0,0,0);
  const {data:costRows,error:costError}=await supabaseAdmin.from('scrape_runs').select('pepesto_actual_cost_cents').eq('store','tesco').gte('started_at',since.toISOString());
  if(costError) return Response.json({error:`Unable to verify today's Pepesto spend: ${costError.message}`},{status:500});
  const spent=(costRows??[]).reduce((sum,row)=>sum+Number(row.pepesto_actual_cost_cents||0),0);
  const cap=Math.min(Math.max(Number(process.env.PEPESTO_TESCO_DAILY_CAP_CENTS||1000),1),10000);
  if(spent>=cap) return Response.json({error:'Daily Pepesto spend cap reached',spent_cents:spent,cap_cents:cap},{status:429});
  const products=cohort==='proven_search_success'
    ? await selectProvenPepestoTescoProducts(limit)
    : await selectUntouchedPepestoTescoProducts(limit);
  if(url.searchParams.get('dry_run')==='true') {
    const dryRunResult={
      status:'dry_run',
      cohort:cohort==='proven_search_success'?'previously_successful_identity_audited':'never_attempted_products_endpoint',
      selected_count:products.length,
      products:products.map(product=>({
        store_product_id:product.storeProductId,
        canonical_name:product.canonicalName,
        store_product_name:product.storeProductName,
        store_sku:product.storeSku,
      })),
      pepesto_credit_spent_cents:0,
    };
    console.log('[pepesto-tesco-products-canary] dry run',dryRunResult);
    return Response.json(dryRunResult);
  }
  const run=await createPepestoProductsRun(products);
  if(!run) return Response.json({status:'no_products',queued:0});
  const creditsBefore=await getPepestoCreditsCents();
  await supabaseAdmin.from('scrape_runs').update({pepesto_credits_before_cents:creditsBefore}).eq('id',run.runUuid);
  try{
    await send(TOPIC,{runUuid:run.runUuid,runId:run.runId,batchIndex:0,products:run.products},{idempotencyKey:`${run.runUuid}:0`,retentionSeconds:86400});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await supabaseAdmin.from('scrape_runs').update({status:'failed',finished_at:new Date().toISOString(),error_summary:`Queue publish failed: ${message}`.slice(0,500)}).eq('id',run.runUuid);
    return Response.json({error:'Queue publish failed',run_id:run.runId},{status:502});
  }
  return Response.json({status:'queued',transport:'pepesto_products_preferred',cohort:cohort==='proven_search_success'?'previously_successful_identity_audited':'never_attempted_products_endpoint',run_id:run.runId,run_uuid:run.runUuid,target_count:run.products.length,queued:run.products.length,credits_before_cents:creditsBefore},{status:202});
}
