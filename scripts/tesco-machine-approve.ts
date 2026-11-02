// Retained-source AI evidence assessment, followed by one narrowly scoped,
// database-enforced recovery decision through the EXISTING supervised SQL bridge.
// This does not require a second Supabase Auth account, grant direct INSERT,
// clear holds or write a price. Fresh Tesco identity is checked at collection.
import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { reentryEvidenceSql, reviewedUuid, type ReentryEvidence } from '../src/lib/tesco-hold-reentry';
import { prepareMachineAssessment, type AiReviewedMapping } from '../src/lib/tesco-machine-approval';
import type { ExecuteSql } from '../src/lib/tesco-supervised-collection';

const args=process.argv.slice(2);
const allowed=new Set(['--confirm-approve','--dry-run','--limit','--offset','--model','--result-file','--candidate-file','--candidate-file-only']);
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
const offset=Number(option('--offset')??0);
if(!Number.isSafeInteger(offset)||offset<0)throw Error('Machine review offset must be a nonnegative safe integer');
const model=option('--model')??'prior-chatgpt-work-ai-assisted-identity-review';
const onlySource=option('--candidate-file-only');
if(onlySource&&option('--candidate-file'))throw Error('Select only one candidate-file mode');
const sources=onlySource?[onlySource]:[
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
}).sort((a,b)=>Number(Boolean((b.row as unknown as {expected_genuine_triple_if_live?:boolean}).expected_genuine_triple_if_live))-
  Number(Boolean((a.row as unknown as {expected_genuine_triple_if_live?:boolean}).expected_genuine_triple_if_live)))
  // Explicit advancement across the same immutable, priority-sorted manifests;
  // never silently retry or skip a previously unacknowledged decision.
  .slice(offset,offset+limit);

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

function sqlJson(value:unknown){
  return `E'${JSON.stringify(value).replaceAll('\\','\\\\').replaceAll("'","''").replaceAll('$','\\044')}'::jsonb`;
}
async function main(){
  let verified=0,rejected=0;
  const approvalIds:string[]=[];
  for(const {row,source} of selected){
    const [found]=await execute(`select ${reentryEvidenceSql(row.mapping_id,row.source_page_id)} evidence`);
    const evidence=(found?.evidence??null) as ReentryEvidence|null;
    const assessment=prepareMachineAssessment(row,evidence,source,model);
    if(!assessment){
      rejected++;
      report({type:'operational_review',sku:row.sku,mapping_id:row.mapping_id,
        decision:'uncertain_or_conflict',reason:'live_mapping_source_peer_or_exact_identity_check_failed'});
      continue;
    }
    verified++;
    if(!confirm){
      report({type:'operational_review',sku:row.sku,mapping_id:row.mapping_id,
        decision:'verified_dry_run',source_page_id:row.source_page_id,source_sha256:assessment.source_body_sha256});
      continue;
    }
    // The database re-reads and locks the exact mapping, historical source
    // page, original receipt, peers and pending/fresh state before recording
    // a single immutable decision. No direct review INSERT is issued here.
    const [result]=await execute(`select tesco_internal.record_verified_hold_reentry(
      ${reviewedUuid(row.mapping_id)}::uuid,${reviewedUuid(row.source_page_id)}::uuid,
      ${sqlJson(evidence)},${sqlJson(assessment)}) review_id`);
    if(!result?.review_id || typeof result.review_id!=='string'){
      report({type:'operational_review',sku:row.sku,mapping_id:row.mapping_id,
        decision:'decision_unacknowledged',reason:'reconcile_ledger_before_restart'});
      throw Error('Recovery decision acknowledgement missing; stop safely');
    }
    approvalIds.push(result.review_id);
    report({type:'operational_review',sku:row.sku,mapping_id:row.mapping_id,
      decision:'operational_decision_recorded',review_id:result.review_id,source_page_id:row.source_page_id,
      source_sha256:assessment.source_body_sha256});
  }
  report({type:'operational_summary',offset,limit,candidate_count:candidates.length,
    next_offset:offset+selected.length<candidates.length?offset+selected.length:null,
    considered:selected.length,verified,rejected,
    decisions_recorded:approvalIds.length,review_ids:approvalIds,
    collection_started:false});
}
main().catch(()=>{report({type:'error',message:'Operational recovery stopped; reconcile durable decisions before restart'});process.exitCode=1})
  .finally(()=>reader.close());
