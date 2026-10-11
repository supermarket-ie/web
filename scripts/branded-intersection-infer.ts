import fs from 'node:fs';
import path from 'node:path';
import { generateText, Output } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { BRAND_RULES } from '../src/lib/branded-brand-registry';
import { inferenceRequest, inferenceSchema, INFERENCE_VERSION, runBounded, gateInference, type Budget, type Ledger, type Corroboration } from '../src/lib/branded-inference';
import type { evaluate } from '../src/lib/branded-intersection';
import { digest } from '../src/lib/tesco-discovery';

// Separate operator CLI. No application route, collector hook or automatic run.
const [reportPath,outputDirectory,budgetPath,confirm]=process.argv.slice(2);
if(!reportPath||!outputDirectory||!budgetPath||confirm!=='--confirm-bounded-inference')throw Error('Usage: REPORT.json PRIVATE_OUTPUT BUDGET.json --confirm-bounded-inference');
if(!process.env.ANTHROPIC_API_KEY)throw Error('Approved Anthropic provider credential unavailable; no calls made');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8')) as ReturnType<typeof evaluate>;
const config=JSON.parse(fs.readFileSync(budgetPath,'utf8')) as Budget & {model:string;corroboration?:Corroboration[]};
// Same approved provider/model as agent/agent.ts; no new account or routing.
if(config.model!=='claude-sonnet-5')throw Error('Model must match the reviewed project provider/model');
fs.mkdirSync(outputDirectory,{recursive:true,mode:0o700});
const ledgerPath=path.join(outputDirectory,'inference-ledger.json');
const lock=fs.openSync(ledgerPath+'.lock','wx',0o600);
async function persist(ledger:Ledger){const tmp=ledgerPath+'.tmp';const fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(ledger,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,ledgerPath);const d=fs.openSync(outputDirectory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
try{
  const ledger:Ledger=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath,'utf8')):{version:INFERENCE_VERSION,model:config.model,entries:[]};
  if(ledger.model!==config.model)throw Error('Existing ledger uses another model');
  const records=new Map(report.records.map(r=>[r.id,r]));
  const selected=report.candidates.filter(p=>p.result.missing.every(m=>m==='wording_requires_inference_or_corroboration'))
    .sort((a,b)=>a.id.localeCompare(b.id));
  const requests=selected.slice(0,20).map(p=>{const a=records.get(p.left)!,b=records.get(p.right)!;
    const context=report.canonicalMetadata.filter(x=>a.canonicalIds.includes(x.id)||b.canonicalIds.includes(x.id));
    return inferenceRequest(a,b,context);});
  await runBounded(requests,async(request,maxOutputTokens)=>{
    const response=await generateText({model:anthropic(config.model),output:Output.object({schema:inferenceSchema}),
      system:request.system,prompt:JSON.stringify(request.data),maxOutputTokens,maxRetries:0,abortSignal:AbortSignal.timeout(60000)});
    return {result:response.output,usage:{inputTokens:response.usage.inputTokens??NaN,outputTokens:response.usage.outputTokens??NaN}};
  },config,ledger,persist);
  const decisions=ledger.entries.filter(e=>e.result).map(e=>{const req=requests.find(r=>r.id===e.id);if(!req)return {id:e.id,status:'other_input_preserved'};
    return {id:e.id,...gateInference(req.data.records[0],req.data.records[1],e.result,BRAND_RULES,report.asOf,config.corroboration)};});
  fs.writeFileSync(path.join(outputDirectory,'inference-proposals.json'),JSON.stringify({version:INFERENCE_VERSION,decisions},null,2),{mode:0o600});
  const replay=ledger.entries.flatMap(e=>{const req=requests.find(r=>r.id===e.id);if(!req||!e.result)return [];
    return [{left:req.data.records[0].id,right:req.data.records[1].id,evidenceDigest:digest([...req.data.records].sort((a,b)=>a.id.localeCompare(b.id))),result:e.result,corroboration:config.corroboration??[]}];});
  fs.writeFileSync(path.join(outputDirectory,'inference-replay.json'),JSON.stringify(replay,null,2),{mode:0o600});
  console.log(JSON.stringify({callsReserved:ledger.entries.length,completed:ledger.entries.filter(e=>e.status==='completed').length,
    reservedUsd:ledger.entries.reduce((n,e)=>n+e.reservedUsd,0),usageCostEstimateUsd:ledger.entries.reduce((n,e)=>n+(e.usageCostEstimateUsd??0),0)}));
}finally{fs.closeSync(lock);fs.unlinkSync(ledgerPath+'.lock');}
