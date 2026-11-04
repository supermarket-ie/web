// Existing supervised SQL bridge only. This script makes NO retailer requests
// and NO price writes. Staged targets remain failed until current source review.
import { readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { repairContextSql, activationContextSql, supportedRepairHint, supportedRepairActivation,
  stageRepairSql, activateRepairSql, type RepairContext, type ActivationContext } from '../src/lib/tesco-evidence-repair';
const args=process.argv.slice(2);
const allowed=new Set(['--stage','--activate','--dry-run','--confirm-repair','--limit','--result-file']);
for(let i=0;i<args.length;i++){
  if(!allowed.has(args[i]))throw Error('Unknown repair option');
  if(!['--dry-run','--confirm-repair'].includes(args[i])){
    if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing repair option');i++;
  }
}
function option(k:string){const i=args.indexOf(k);return i<0?undefined:args[i+1];}
const stage=option('--stage'),activate=option('--activate');
if(!!stage===!!activate||args.includes('--dry-run')===args.includes('--confirm-repair'))throw Error('Select one operation and confirmation mode');
const limit=Number(option('--limit')??10);
if(!Number.isInteger(limit)||limit<1||limit>10)throw Error('Repair batches are bounded to ten');
type Row={mapping_id:string;source_page_id:string;target_sku:string;source_body_sha256:string;
  audit_id:string;review_reason:string};
const rows=readFileSync(stage??activate!,'utf8').split('\n').filter(Boolean).map(x=>JSON.parse(x) as Row);
if(rows.length>limit||new Set(rows.map(x=>stage?x.mapping_id:x.audit_id)).size!==rows.length)throw Error('Invalid bounded repair manifest');
let sequence=0,disconnected=false;
const waiting=new Map<number,{resolve:(r:Record<string,unknown>[])=>void;reject:(e:Error)=>void}>();
const input=createInterface({input:process.stdin});
input.on('close',()=>{disconnected=true;for(const w of waiting.values())w.reject(Error('Supervisor disconnected'));waiting.clear();});
input.on('line',line=>{
  try{const r=JSON.parse(line),w=waiting.get(r.id);if(!w)return;waiting.delete(r.id);
    if(r.error||!Array.isArray(r.rows))w.reject(Error('Repair SQL failed'));else w.resolve(r.rows);
  }catch{disconnected=true;}
});
function send(v:unknown){process.stdout.write(JSON.stringify(v)+'\n');}
const execute=(query:string)=>new Promise<Record<string,unknown>[]>((resolve,reject)=>{
  if(disconnected){reject(Error('Supervisor disconnected'));return;}
  const id=++sequence,timer=setTimeout(()=>{waiting.delete(id);reject(Error('Supervisor deadline'));},90000);
  waiting.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});
  send({type:'sql',id,query});
});
function report(v:unknown){send(v);if(option('--result-file'))appendFileSync(option('--result-file')!,JSON.stringify(v)+'\n',{mode:0o600});}
async function main(){
  for(const row of rows){
    const query=stage?repairContextSql(row.mapping_id,row.source_page_id,row.target_sku)
      :activationContextSql(row.audit_id,row.source_page_id);
    const [found]=await execute(`select ${query} context`);
    const context=found?.context as RepairContext|ActivationContext|null;
    const supported=stage?supportedRepairHint(context):supportedRepairActivation(context as ActivationContext|null);
    const page=stage?context?.hint:(context as ActivationContext|null)?.source;
    if(!supported||!page||page.body_sha256!==row.source_body_sha256){
      report({type:'repair_result',mapping_id:row.mapping_id,audit_id:row.audit_id,result:'not_supported'});continue;
    }
    if(args.includes('--dry-run')){
      report({type:'repair_result',mapping_id:row.mapping_id,audit_id:row.audit_id,result:'supported_dry_run'});continue;
    }
    const batch=`tesco-repair-${stage?'stage':'activate'}-${randomUUID()}`;
    report({type:'repair_start',batch,mapping_id:context!.offer.id,source_page_id:row.source_page_id});
    const sql=stage?stageRepairSql(context!,row.review_reason,batch)
      :activateRepairSql(context as ActivationContext,row.review_reason,batch);
    const result=await execute(sql);
    report({type:'repair_result',operation:stage?'stage':'activate',mapping_id:context!.offer.id,
      result:'committed',...result[0],price_writes:0});
  }
}
main().catch(()=>{report({type:'error',message:'Repair interrupted; reconcile the saved SQL and audit ledger before continuing.'});process.exitCode=1;})
  .finally(()=>input.close());
