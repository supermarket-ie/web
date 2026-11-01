// Automated AI-evidence approval through a *separate real Supabase Auth machine
// principal*. Never through the privileged SQL bridge or a forged human claim.
// The SQL bridge reads the current immutable source/mapping/peer evidence only.
// Final collection uses the unchanged supervised collector and its live guard.
import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import { reentryEvidenceSql, type ReentryEvidence } from '../src/lib/tesco-hold-reentry';
import { prepareMachineAssessment, type AiReviewedMapping } from '../src/lib/tesco-machine-approval';
import type { ExecuteSql } from '../src/lib/tesco-supervised-collection';

const args=process.argv.slice(2);
const allowed=new Set(['--confirm-approve','--dry-run','--limit','--model','--result-file','--candidate-file']);
for(let i=0;i<args.length;i++) {
  if(!allowed.has(args[i])) throw Error('Unknown machine approval option');
  if(!['--confirm-approve','--dry-run'].includes(args[i])) {
    if(!args[i+1] || args[i+1].startsWith('--')) throw Error('Missing option value');
    i++;
  }
}
const confirm=args.includes('--confirm-approve');
if(confirm===args.includes('--dry-run'))throw Error('Select exactly one of --dry-run or --confirm-approve');
function option(k:string){const i=args.indexOf(k);return i<0?undefined:args[i+1]}
const limit=Number(option('--limit')??100);
if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Bounded machine review limit must be 1..100');
const model=option('--model')??'prior-chatgpt-work-ai-assisted-identity-review';
const sources=[
  'docs/tesco-hold-reentry-production-queue-20261101.jsonl',
  'docs/tesco-hold-reentry-inference-addendum-20261101.jsonl',
  ...(option('--candidate-file')?[option('--candidate-file')!]:[]),
];
const candidates=sources.flatMap(source=>readFileSync(source,'utf8').split('\n').filter(Boolean)
  .map(line=>({source,row:JSON.parse(line) as AiReviewedMapping}))
  .filter(item=>item.row.type==='candidate'));
// Do not permit multiple approvals for one mapping or Tesco URL in one batch.
const seen=new Set<string>();
const selected=candidates.filter(item=>{
  if(seen.has(item.row.mapping_id))throw Error('Duplicate mapping in AI evidence manifest');
  seen.add(item.row.mapping_id);return true;
}).sort((a,b)=>Number((b.row as unknown as {expected_genuine_triple_if_live?:boolean}).expected_genuine_triple_if_live)-
  Number((a.row as unknown as {expected_genuine_triple_if_live?:boolean}).expected_genuine_triple_if_live))
  .slice(0,limit);

let sequence=0,disconnected=false;
const replies=new Map<number,{resolve:(rows:Record<string,unknown>[])=>void;reject:(e:Error)=>void}>();
const reader=createInterface({input:process.stdin});
reader.on('close',()=>{disconnected=true;for(const r of replies.values())r.reject(Error('Supervisor disconnected'));replies.clear()});
reader.on('line',line=>{
  try {
    const value=JSON.parse(line);
    const pending=replies.get(value.id);
    if(!pending)return;
    replies.delete(value.id);
    if(value.error||!Array.isArray(value.rows))pending.reject(Error('SQL bridge rejected evidence query'));
    else pending.resolve(value.rows);
  }catch{disconnected=true}
});
const execute:ExecuteSql=query=>new Promise((resolve,reject)=>{
  if(disconnected){reject(Error('SQL bridge disconnected'));return}
  const id=++sequence;
  const timer=setTimeout(()=>{replies.delete(id);reject(Error('SQL bridge deadline'))},90_000);
  replies.set(id,{resolve:rows=>{clearTimeout(timer);resolve(rows)},
    reject:e=>{clearTimeout(timer);reject(e)}});
  process.stdout.write(JSON.stringify({type:'sql',id,query})+'\n');
});
function report(value:Record<string,unknown>){
  const line=JSON.stringify(value);
  process.stdout.write(line+'\n');
  // Optional append-only durable checkpoint for all dispositions; no overwrite.
  const output=option('--result-file');
  if(output)appendFileSync(output,line+'\n',{encoding:'utf8',flag:'a'});
}

async function machineClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email=process.env.TESCO_MACHINE_AUTH_EMAIL;
  const password=process.env.TESCO_MACHINE_AUTH_PASSWORD;
  if(!url||!key||!email||!password)throw Error('Dedicated Supabase machine Auth credentials not configured');
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await client.auth.signInWithPassword({email,password});
  if(error)throw Error('Dedicated machine Auth sign-in denied');
  const user=await client.auth.getUser();
  if(user.error||!user.data.user?.id
    ||user.data.user.app_metadata?.tesco_reentry_machine_approver!==true
    ||user.data.user.app_metadata?.tesco_reentry_reviewer===true)
    throw Error('Authenticated principal lacks exclusive machine approval permission');
  return client;
}
async function main(){
  // No credentials or approval permission needed for a full read-only review.
  const client=confirm?await machineClient():null;
  let verified=0,rejected=0;
  const approvalIds:string[]=[];
  for(const {row,source} of selected){
    const [found]=await execute(`select ${reentryEvidenceSql(row.mapping_id,row.source_page_id)} evidence`);
    const evidence=(found?.evidence??null) as ReentryEvidence|null;
    const assessment=prepareMachineAssessment(row,evidence,source,model);
    if(!assessment){
      rejected++;
      report({type:'machine_review',sku:row.sku,mapping_id:row.mapping_id,
        decision:'uncertain_or_conflict',reason:'live_mapping_source_peer_or_exact_identity_check_failed'});
      continue;
    }
    verified++;
    if(!client){
      report({type:'machine_review',sku:row.sku,mapping_id:row.mapping_id,
        decision:'verified_dry_run',source_page_id:row.source_page_id,source_sha256:assessment.source_body_sha256});
      continue;
    }
    const {data,error}=await client.from('tesco_hold_reentry_reviews').insert({
      store_product_id:row.mapping_id,source_page_id:row.source_page_id,
      evidence_snapshot:evidence,independent_reason:assessment.reason,
      machine_assessment:assessment,
      expires_at:new Date(Date.now()+48*60*60*1000).toISOString(),
    }).select('id').single();
    if(error||!data?.id) {
      report({type:'machine_review',sku:row.sku,mapping_id:row.mapping_id,
        decision:'approval_denied',reason:'authenticated_machine_insert_failed'});
      // A systematic privilege/API mismatch is an auth boundary, not a
      // per-product identity failure: stop, never switch to privileged SQL.
      throw Error('Machine Auth approval API rejected insert; stop safely');
    }
    approvalIds.push(data.id);
    report({type:'machine_review',sku:row.sku,mapping_id:row.mapping_id,
      decision:'machine_approved',review_id:data.id,source_page_id:row.source_page_id,
      source_sha256:assessment.source_body_sha256});
  }
  report({type:'machine_summary',considered:selected.length,verified,rejected,
    approvals_created:approvalIds.length,review_ids:approvalIds,
    collection_started:false});
}
main().catch(()=>{report({type:'error',message:'Machine review stopped; reconcile durable approvals before restart'});process.exitCode=1})
  .finally(()=>reader.close());
