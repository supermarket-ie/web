import fs from 'node:fs';
import path from 'node:path';
import { generateText, Output } from 'ai';
import { inferenceRequest, inferenceSchema, INFERENCE_VERSION, runBounded, gateInference, selectInferenceCandidates, validateBudget, reconcileFailed, type Budget, type Ledger, type Corroboration } from '../src/lib/branded-inference';
import type { evaluate } from '../src/lib/branded-intersection';
import { digest } from '../src/lib/tesco-discovery';
import { resolveAgentModel } from '../src/lib/agent/model';

async function main() {
// Separate operator CLI. No application route, collector hook or automatic run.
const args=process.argv.slice(2);
// Operator reconcile mode: makes NO model call. Marks uncertain calls failed_reconciled (still counted at full
// reservation, never re-sent) so a reviewed campaign can continue. Usage: --reconcile-failed PRIVATE_OUTPUT
if(args[0]==='--reconcile-failed'){
  if(args.length!==2)throw Error('Usage: --reconcile-failed PRIVATE_OUTPUT');
  const ledgerFile=path.join(args[1],'inference-ledger.json');
  const lockFd=fs.openSync(ledgerFile+'.lock','wx',0o600);
  try{
    const ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8')) as Ledger;
    const failed=ledger.entries.filter(e=>e.status==='failed_unknown_spend').map(e=>({id:e.id,campaign:e.campaign,reservedUsd:e.reservedUsd,error:e.error??null}));
    const n=reconcileFailed(ledger);
    const tmp=ledgerFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(ledger,null,2),{mode:0o600});fs.renameSync(tmp,ledgerFile);
    console.log(JSON.stringify({event:'reconciled',count:n,failed}));
  }finally{fs.closeSync(lockFd);fs.unlinkSync(ledgerFile+'.lock');}
  return;
}
const [reportPath,outputDirectory,budgetPath,confirm]=args;
if(!reportPath||!outputDirectory||!budgetPath||confirm!=='--confirm-bounded-inference'||(args.length!==4&&!(args.length===6&&args[4]==='--priority')))
  throw Error('Usage: REPORT.json PRIVATE_OUTPUT BUDGET.json --confirm-bounded-inference [--priority PAIR_IDS.json] | --reconcile-failed PRIVATE_OUTPUT');
// The SAME provider/model contract as the production agent and the Tesco approval job
// (src/lib/agent/model.ts): Bedrock via the AWS credential chain by default, or the
// direct Anthropic rollback. No new account, endpoint or routing.
const provider=(process.env.AGENT_MODEL_PROVIDER??'bedrock').toLowerCase();
const configuredModel=provider==='anthropic'?(process.env.AGENT_ANTHROPIC_MODEL??'claude-sonnet-5'):(process.env.AGENT_MODEL_ID??'eu.anthropic.claude-sonnet-4-6');
if(provider==='anthropic'&&!process.env.ANTHROPIC_API_KEY)throw Error('Approved Anthropic provider credential unavailable; no calls made');
if(provider!=='anthropic'){
  // Resolve the AWS credential chain BEFORE reading any input, so a missing credential
  // stops the run with nothing read, reserved or sent (same guarantee as the Anthropic path).
  try{const {defaultProvider}=await import('@aws-sdk/credential-provider-node');await defaultProvider()();}
  catch{throw Error('Approved Bedrock credential unavailable; no calls made');}
}
const report=JSON.parse(fs.readFileSync(reportPath,'utf8')) as ReturnType<typeof evaluate>;
const config=JSON.parse(fs.readFileSync(budgetPath,'utf8')) as Budget & {model:string;corroboration?:Corroboration[]};
if(config.model!==configuredModel)throw Error(`Budget model must match the configured project model (${configuredModel})`);
const priority=args[5]?JSON.parse(fs.readFileSync(args[5],'utf8')) as string[]:[];
if(!Array.isArray(priority)||priority.some(x=>typeof x!=='string'))throw Error('Priority must be an array of pair ids');
fs.mkdirSync(outputDirectory,{recursive:true,mode:0o700});
const ledgerPath=path.join(outputDirectory,'inference-ledger.json');
const lock=fs.openSync(ledgerPath+'.lock','wx',0o600);
async function persist(ledger:Ledger){const tmp=ledgerPath+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(ledger,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,ledgerPath);const d=fs.openSync(outputDirectory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
try{
  const ledger:Ledger=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath,'utf8')):{version:INFERENCE_VERSION,model:config.model,entries:[]};
  if(ledger.model!==config.model)throw Error('Existing ledger uses another model');
  const records=new Map(report.records.map(r=>[r.id,r]));
  // Only real SKU pairs whose sole gap is wording; priority orders but never widens the set.
  const selected=selectInferenceCandidates(report.candidates,records,priority);
  validateBudget(config);
  // At most the campaign's call limit is prepared; oversized evidence is reported, never truncated.
  const oversized:string[]=[];
  const requests=selected.slice(0,config.maxCalls).flatMap(p=>{const a=records.get(p.left)!,b=records.get(p.right)!;
    const context=report.canonicalMetadata.filter(x=>a.canonicalIds.includes(x.id)||b.canonicalIds.includes(x.id));
    try{return [inferenceRequest(a,b,context)];}catch{oversized.push(p.id);return [];}});
  const model=resolveAgentModel();
  await runBounded(requests,async(request,maxOutputTokens)=>{
    const response=await generateText({model,output:Output.object({schema:inferenceSchema}),
      system:request.system,prompt:JSON.stringify(request.data),maxOutputTokens,maxRetries:0,abortSignal:AbortSignal.timeout(60000)});
    return {result:response.output,usage:{inputTokens:response.usage.inputTokens??NaN,outputTokens:response.usage.outputTokens??NaN}};
  },config,ledger,persist,p=>console.log(JSON.stringify({event:'batch',campaign:config.campaign,...p,
    campaignReservedUsd:Number(p.campaignReservedUsd.toFixed(4)),campaignUsageUsd:Number(p.campaignUsageUsd.toFixed(4))})));
  const decisions=ledger.entries.filter(e=>e.result).map(e=>{const req=requests.find(r=>r.id===e.id);if(!req)return {id:e.id,status:'other_input_preserved'};
    const base={id:e.id,left:req.data.records[0].id,right:req.data.records[1].id};
    // A gate refusal (e.g. the model cited canonical context as evidence) is a rejected candidate, not a crash.
    try{return {...base,...gateInference(req.data.records[0],req.data.records[1],e.result,report.brandRules,report.asOf,config.corroboration)};}
    catch(error){return {...base,decision:'insufficient_evidence',accepted:false,reasons:[`gate_refused:${error instanceof Error?error.message:String(error)}`],result:e.result};}});
  fs.writeFileSync(path.join(outputDirectory,'inference-proposals.json'),JSON.stringify({version:INFERENCE_VERSION,model:config.model,decisions},null,2),{mode:0o600});
  const replay=ledger.entries.flatMap(e=>{const req=requests.find(r=>r.id===e.id);if(!req||!e.result)return [];
    return [{left:req.data.records[0].id,right:req.data.records[1].id,evidenceDigest:digest([...req.data.records].sort((a,b)=>a.id.localeCompare(b.id))),result:e.result,corroboration:config.corroboration??[]}];});
  fs.writeFileSync(path.join(outputDirectory,'inference-replay.json'),JSON.stringify(replay,null,2),{mode:0o600});
  const own=ledger.entries.filter(e=>(e.campaign??'unlabelled')===config.campaign);
  console.log(JSON.stringify({model:config.model,campaign:config.campaign,capUsd:config.maxUsd,maxCalls:config.maxCalls,eligible:selected.length,prepared:requests.length,oversized:oversized.length,
    campaignCalls:own.length,completed:own.filter(e=>e.status==='completed').length,
    failedUnknownSpend:own.filter(e=>e.status==='failed_unknown_spend').length,
    campaignReservedUsd:own.reduce((n,e)=>n+e.reservedUsd,0),campaignUsageCostEstimateUsd:own.reduce((n,e)=>n+(e.usageCostEstimateUsd??0),0)}));
}finally{fs.closeSync(lock);fs.unlinkSync(ledgerPath+'.lock');}

}
void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
