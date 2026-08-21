import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BASE = 'https://s.pepesto.com/api';
const RUN_ID = 'pepesto_checkout_fresh_record_20260821';
const PRODUCTS = [
  { name: 'Tesco Crunchy Peanut Butter', url: 'https://www.tesco.ie/shop/en-IE/products/264769567' },
  { name: 'Tesco Chicken Legs', url: 'https://www.tesco.ie/shop/en-IE/products/302515004' },
  { name: 'Tesco Baby Irish Rooster Potatoes', url: 'https://www.tesco.ie/shop/en-IE/products/288406575' },
];

function authorized(r: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && r.headers.get('authorization') === `Bearer ${secret}`);
}
async function apiKey() {
  const { data, error } = await supabaseAdmin.rpc('get_pepesto_api_key');
  if (error || typeof data !== 'string' || !data) throw new Error('Pepesto API key unavailable');
  return data;
}
async function post(path: string, body: unknown) {
  const key = await apiKey();
  const r = await fetch(`${BASE}${path}`, { method:'POST', headers:{authorization:`Bearer ${key}`,'content-type':'application/json',accept:'application/json'}, body:JSON.stringify(body), cache:'no-store' });
  const text = await r.text();
  let json:any=null; try { json=text?JSON.parse(text):null; } catch { json={raw:text.slice(0,4000)}; }
  if(!r.ok) throw new Error(`Pepesto ${path} failed (${r.status}): ${text.slice(0,500)}`);
  return { json, charged:Number(r.headers.get('Pepesto-Eurocents-Charged')||0) };
}
function flattenProducts(payload:any){
  const out:any[]=[];
  for(const item of payload?.items??[]) for(const wrapper of item?.products??[]){ const product=wrapper?.product??wrapper; const session_token=wrapper?.session_token??product?.session_token; if(product) out.push({item_name:item?.item_name,product,session_token}); }
  return out;
}
export async function GET(request:Request){
  if(!authorized(request)) return Response.json({error:'Unauthorized'},{status:401});
  const {data:existing}=await supabaseAdmin.from('scrape_runs').select('id,status,error_summary').eq('run_id',RUN_ID).maybeSingle();
  if(existing?.id) return Response.json({status:'already_ran',run_id:RUN_ID,existing_status:existing.status,summary:existing.error_summary});
  const {data:run,error:runError}=await supabaseAdmin.from('scrape_runs').insert({run_id:RUN_ID,store:'tesco',retrieval_method:'pepesto_checkout_protocol',started_at:new Date().toISOString(),status:'running',target_count:3,threshold_pct:100,attempted_count:0,fetched:0,extracted:0,inserted:0,unchanged_count:0,failed:0,silently_skipped_count:0,threshold_breached:false,scrapingbee_requests:0,scrapingbee_credits:0}).select('id').single();
  if(runError||!run?.id) return Response.json({error:runError?.message||'failed to open run'},{status:500});
  try{
    const credits=await post('/credits',{}); const creditsBefore=Number(credits.json?.euro_cents??0); if(creditsBefore<124) throw new Error(`Insufficient credits: ${creditsBefore}`);
    const prod=await post('/products',{recipe_kg_tokens:[],manual_shopping_list:PRODUCTS.map(p=>p.name).join('\n'),supermarket_domain:'tesco.ie',preferred_product_urls:PRODUCTS.map(p=>p.url),item_names_locale:'en-IE'});
    const flat=flattenProducts(prod.json); const selected=PRODUCTS.map(t=>{const m=flat.find((x:any)=>String(x?.product?.product_id||'')===t.url); return m?{target:t,match:m}:null;}).filter(Boolean) as any[];
    if(selected.length<3) throw new Error(`Only ${selected.length}/3 exact URL matches`);
    const skus=selected.map(x=>({session_token:x.match.session_token,num_units_to_buy:1})); if(skus.some(x=>!x.session_token)) throw new Error('Missing Pepesto session token');
    const sess=await post('/session',{supermarket_domain:'tesco.ie',user_locale:'en-IE',skus}); const sessionId=String(sess.json?.session_id||''); if(!sessionId) throw new Error('No session_id');
    const checkout=await post('/checkout',{continue_session_id:sessionId});
    const summary={credits_before_cents:creditsBefore,charged_cents:{products:prod.charged,session:sess.charged,checkout_turn_1:checkout.charged,total:prod.charged+sess.charged+checkout.charged},matched_products:selected.map(x=>({requested_name:x.target.name,requested_url:x.target.url,returned_name:x.match?.product?.product_name??null,returned_url:x.match?.product?.product_id??null})),session_id:sessionId,checkout_response:checkout.json};
    await supabaseAdmin.from('scrape_runs').update({status:'success',finished_at:new Date().toISOString(),target_count:3,attempted_count:3,fetched:3,extracted:3,inserted:0,unchanged_count:3,failed:0,coverage_pct:100,error_summary:JSON.stringify(summary)}).eq('id',run.id);
    return Response.json({status:'success',run_id:RUN_ID,session_id:sessionId,charged_cents:summary.charged_cents});
  }catch(e){ const message=e instanceof Error?e.message:String(e); await supabaseAdmin.from('scrape_runs').update({status:'failed',finished_at:new Date().toISOString(),failed:3,error_summary:message.slice(0,1000)}).eq('id',run.id); return Response.json({error:message},{status:500}); }
}
