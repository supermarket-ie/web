// A whole-pack mass can be reconciled only when the retailer explicitly gives
// matching title/net mass and the structured size is its exact drained mass.
export const NET_PACK_EVIDENCE='explicit_net_contents_with_drained_pack' as const;
type Candidate={name:string;quantity:{grams?:number;millilitres?:number;pieces?:number}|null;
  quantityEvidence?:string;identityDetails?:Record<string,unknown>};
const number='[0-9]{1,8}(?:[.,][0-9]{1,6})?';
const weight=`(?:([0-9]{1,4})\\s*[x×]\\s*)?(${number})\\s*(kg|g)`;
function mass(text:unknown){
  if(typeof text!=='string'||text.length>120)return null;
  const match=text.trim().replace(/\s*[e℮]$/i,'').trim().match(new RegExp(`^${weight}$`,'i'));
  return match?fact(match):null;
}
function fact(match:RegExpMatchArray){
  const count=Number(match[1]??1),unit=Number(match[2].replace(',','.'))*(match[3].toLowerCase()==='kg'?1000:1);
  const total=count*unit;
  return Number.isInteger(count)&&count>0&&count<=1000&&unit>0&&Number.isFinite(total)&&total<=100000000
    ?{count,total}:null;
}
export function normaliseNetPackQuantity<T extends Candidate>(p:T):T {
  const d=p.identityDetails, q=p.quantity;
  if(!d||!q||Object.keys(q).length!==1||typeof q.grams!=='number'||!(q.grams>0)
    ||!Array.isArray(d.packSize)||d.packSize.length!==1||p.name.length>500)return p;
  const raw=d.packSize[0] as {value?:unknown;units?:unknown}|null;
  if(!raw||!['g','kg'].includes(String(raw.units).toLowerCase())
    ||!new RegExp(`^${number}$`).test(String(raw.value)))return p;
  const structured=Number(String(raw.value).replace(',','.'))*(String(raw.units).toLowerCase()==='kg'?1000:1);
  const net=mass(d.netContents),drained=mass(d.drainedWeight);
  const matches=[...p.name.matchAll(new RegExp(`\\b${weight}\\b`,'gi'))];
  const title=matches.length===1?fact(matches[0]):null;
  if(!net||!drained||!title||net.total!==title.total||net.count!==title.count
    ||(drained.count>1&&drained.count!==net.count)
    ||!(drained.total<net.total)||structured!==drained.total
    ||![structured,net.total].includes(q.grams))return p;
  return {...p,quantity:{grams:net.total},quantityEvidence:NET_PACK_EVIDENCE};
}
