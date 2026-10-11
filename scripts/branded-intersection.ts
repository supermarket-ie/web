import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { evaluate, STORES } from '../src/lib/branded-intersection';
import { digest } from '../src/lib/tesco-discovery';

const args=process.argv.slice(2);
if((args.length!==4&&args.length!==6) || args[0]!=='--input' || args[2]!=='--out'||(args.length===6&&args[4]!=='--inference'))throw Error('Usage: --input SNAPSHOT.json --out PRIVATE_DIRECTORY [--inference PROPOSALS.json]');
const report=evaluate(JSON.parse(fs.readFileSync(args[1],'utf8')),undefined,args[5]?JSON.parse(fs.readFileSync(args[5],'utf8')):[]);
const out=path.join(args[3],`branded-${digest({version:report.version,registry:report.brandRegistryDigest,input:report.inputDigest})}`);
fs.mkdirSync(out,{recursive:true,mode:0o700});
function write(name:string,value:string){
  const dest=path.join(out,name);if(fs.existsSync(dest)){if(fs.readFileSync(dest,'utf8')!==value)throw Error('Immutable report differs');return;}
  const temp=dest+'.'+randomUUID()+'.tmp';const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,dest);
}
write('report.json',JSON.stringify(report,null,2));
write('summary.json',JSON.stringify({asOf:report.asOf,...report.summary,limitations:report.limitations},null,2));
write('all-exact-groups.json',JSON.stringify(report.exactGroups,null,2));
write('brand-review-queue.json',JSON.stringify(report.brandReviewQueue,null,2));
write('intersection.json',JSON.stringify(report.intersection,null,2));
write('collection-opportunities.json',JSON.stringify(report.opportunities,null,2));
write('catalogue-audit.json',JSON.stringify(report.associations,null,2));
write('inference-candidates.json',JSON.stringify(report.candidates,null,2));
const header=['category','canonical_product_id','name','brand','manufacturer','pack','decision','verification_status','demand','mapping_repair',
  ...STORES.flatMap(s=>[`${s}_sku`,`${s}_url`,`${s}_title`,`${s}_gtin`,`${s}_evidence_kind`,`${s}_evidence_ref`,`${s}_evidence_at`,`${s}_url_verification`,`${s}_last_live_verified_at`,`${s}_fresh_price`,`${s}_price`,`${s}_price_observed_at`,`${s}_collection_ready`,`${s}_conflicts`])];
function cell(v:unknown){let s=v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
write('intersection.csv',[header,...report.intersection.map(t=>[t.category,t.canonicalProductId,t.name,t.brand,t.manufacturer,t.pack,t.decision,t.verificationStatus,t.demand,t.mappingRepairRequired,
  ...STORES.flatMap(s=>{const r=t.retailers[s];return[r.sku,r.url,r.title,r.gtin,r.evidence.kind,r.evidence.ref,r.evidence.at,r.urlVerification,r.lastLiveVerifiedAt,r.hasCurrentTrustedPrice,r.price,r.priceObservedAt,r.collectionReady,r.conflicts];})])].map(row=>row.map(cell).join(',')).join('\n')+'\n');
const fd=fs.openSync(out,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
console.log(JSON.stringify({directory:out,summary:report.summary},null,2));
