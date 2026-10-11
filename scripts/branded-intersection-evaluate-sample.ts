import fs from 'node:fs';
import { compare } from '../src/lib/branded-product-identity';
import type { evaluate } from '../src/lib/branded-intersection';
const [reportPath,labelsPath,output]=process.argv.slice(2);
if(!output)throw Error('Usage: REPORT.json INDEPENDENT_LABELS.json OUTPUT.json');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8')) as ReturnType<typeof evaluate>;
const labels=JSON.parse(fs.readFileSync(labelsPath,'utf8')) as {labelMethod:string;cases:{id:string;left:string;right:string;label:string}[]};
const by=new Map(report.records.map(r=>[r.id,r]));
const cases=labels.cases.map(c=>{const a=by.get(c.left),b=by.get(c.right);if(!a||!b)throw Error('Label references missing evidence');
 const r=compare(a,b,report.brandRules,report.asOf);return {...c,predicted:r.decision,reasons:r.reasons,falseMatch:r.decision==='exact_match'&&c.label!=='exact_match'};});
const accepted=cases.filter(c=>c.predicted==='exact_match'),falseMatches=cases.filter(c=>c.falseMatch);
const positives=cases.filter(c=>c.label==='exact_match');
fs.writeFileSync(output,JSON.stringify({labelMethod:labels.labelMethod,total:cases.length,positives:positives.length,negatives:cases.length-positives.length,
 accepted:accepted.length,falseMatches:falseMatches.length,precision:accepted.length?(accepted.length-falseMatches.length)/accepted.length:null,
 recall:positives.filter(c=>c.predicted==='exact_match').length/positives.length,
 illustrativeOneSided95PercentFalseAcceptanceUpperBound:falseMatches.length===0&&accepted.length?1-Math.pow(.05,1/accepted.length):null,
 riskCaveat:'Targeted, correlated product pairs are not a representative random sample. This bound is illustrative under independent sampling, not a production error-rate guarantee. Independent second-rater review remains outstanding.',cases},null,2),{mode:0o600});
