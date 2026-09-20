import { handleCallback } from '@vercel/queue';
import { choosePepestoCandidateFromItems, extractPepestoItems, finalizePepestoProduct, getPepestoCreditsCents, retrievePepestoProducts } from '@/lib/pepesto-tesco';
import { supabaseAdmin } from '@/lib/supabase';
import type { TescoQueueProduct } from '@/lib/tesco-queue-worker';

type Message={runUuid:string;runId:string;batchIndex:number;products:TescoQueueProduct[]};

async function runActive(runUuid:string){const {data,error}=await supabaseAdmin.from('scrape_runs').select('status').eq('id',runUuid).maybeSingle();if(error)throw new Error(error.message);return data?.status==='running';}
async function finalized(runUuid:string,storeProductId:string){const {data,error}=await supabaseAdmin.from('scrape_product_receipts').select('store_product_id').eq('run_id',runUuid).eq('store_product_id',storeProductId).maybeSingle();if(error)throw new Error(error.message);return Boolean(data);}

export const POST=handleCallback<Message>(async(message)=>{
  if(!message?.runUuid||!Array.isArray(message.products)||!message.products.length) throw new Error('Invalid Pepesto Tesco queue message');
  if(!(await runActive(message.runUuid))) return;
  const {data:existing,error:existingError}=await supabaseAdmin.from('pepesto_tesco_product_batches').select('response_payload,credits_before_cents,credits_after_cents,actual_cost_cents,status').eq('run_uuid',message.runUuid).eq('batch_index',message.batchIndex).maybeSingle();
  if(existingError) throw new Error(existingError.message);
  let payload:unknown=existing?.response_payload??null;
  let before=Number(existing?.credits_before_cents||0),after=Number(existing?.credits_after_cents||0),cost=Number(existing?.actual_cost_cents||0);
  if(!payload){
    before=await getPepestoCreditsCents();
    const {error:insertError}=await supabaseAdmin.from('pepesto_tesco_product_batches').upsert({run_uuid:message.runUuid,batch_index:message.batchIndex,products:message.products,status:'requesting',credits_before_cents:before},{onConflict:'run_uuid,batch_index'});
    if(insertError) throw new Error(insertError.message);
    payload=await retrievePepestoProducts(message.products);
    after=await getPepestoCreditsCents(); cost=Math.max(0,before-after);
    const items=extractPepestoItems(payload);
    const {error:saveError}=await supabaseAdmin.from('pepesto_tesco_product_batches').update({response_payload:payload,items_returned:items.length,status:'retrieved',credits_after_cents:after,actual_cost_cents:cost,retrieved_at:new Date().toISOString()}).eq('run_uuid',message.runUuid).eq('batch_index',message.batchIndex);
    if(saveError) throw new Error(saveError.message);
    await supabaseAdmin.from('scrape_runs').update({pepesto_credits_before_cents:before,pepesto_credits_after_cents:after,pepesto_actual_cost_cents:cost}).eq('id',message.runUuid);
  }
  const items=extractPepestoItems(payload);
  for(const product of message.products){
    if(await finalized(message.runUuid,product.storeProductId)) continue;
    await finalizePepestoProduct(message.runUuid,product,choosePepestoCandidateFromItems(product,items));
  }
  const {error:completeError}=await supabaseAdmin.from('pepesto_tesco_product_batches').update({status:'complete',completed_at:new Date().toISOString()}).eq('run_uuid',message.runUuid).eq('batch_index',message.batchIndex);
  if(completeError) throw new Error(completeError.message);
},{visibilityTimeoutSeconds:600,retry:(_error,metadata)=>metadata.deliveryCount>=3?{acknowledge:true}:{afterSeconds:30*Math.max(1,metadata.deliveryCount)}});
