const STORE_ID = 258;
const API_BASE = 'https://storefrontgateway.dunnesstoresgrocery.com/api';
const SITE_URL = 'https://www.dunnesstoresgrocery.com';

export type DunnesDiscoveryCandidate = {
  sku: string | null;
  name: string;
  price: number | null;
  url: string | null;
  queries: string[];
  score: number;
  brandMatch: boolean;
  packMatch: boolean;
  productSignalMatch: boolean;
  variantConflict: boolean;
  canonicalPack: PackSignature;
  candidatePack: PackSignature;
};

export type DunnesDiscoveryResult = {
  queryVariants: string[];
  candidates: DunnesDiscoveryCandidate[];
  best: DunnesDiscoveryCandidate | null;
  accepted: boolean;
};

type RawCandidate = { sku: string | null; name: string; price: number | null; url: string | null };
export type PackSignature = { amount: number | null; unit: 'g' | 'ml' | null; count: number | null; multipack: boolean };

function plain(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
export function normaliseDunnesName(value: string) { return plain(value).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function toBaseAmount(qty: number, unit: string): { amount: number; unit: 'g' | 'ml' } {
  const u = unit.toLowerCase(); if (u === 'kg') return { amount: qty * 1000, unit: 'g' }; if (u === 'g') return { amount: qty, unit: 'g' }; if (u === 'l') return { amount: qty * 1000, unit: 'ml' }; if (u === 'cl') return { amount: qty * 10, unit: 'ml' }; return { amount: qty, unit: 'ml' };
}

export function dunnesPackSignature(value: string): PackSignature {
  const raw = plain(value).replace(/,/g, '.').replace(/×/g, 'x');
  const multi = raw.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/i);
  if (multi) { const base = toBaseAmount(Number(multi[2]), multi[3]); return { amount: base.amount, unit: base.unit, count: Number(multi[1]), multipack: true }; }
  const explicitCountMatch = raw.match(/\b(\d+)\s*(?:pack|pk|rolls?|pieces?|tabs?|tablets?|capsules?|wipes?|bags?|sachets?|boxes?|cans?|bottles?|burgers?|fish\s+fingers?|fingers?|singles?|slices?)\b/i);
  const leadingItemCountMatch = raw.match(/\b(\d+)\s+(?:(?:[a-z0-9'-]+)\s+){0,5}(?:burgers?|fish\s+fingers?|fingers?|singles?|slices?|rolls?|cans?|bottles?|wipes?|bags?|sachets?|boxes?|dippers?|waffles?|bagels?|candles?|cases?)\b/i);
  const parentheticalCountMatch = raw.match(/\(\s*(\d+)\s*(?:pieces?|daisies|candles|cases)?\s*\)/i);
  const amountMatch = raw.match(/\b(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/i);
  const base = amountMatch ? toBaseAmount(Number(amountMatch[1]), amountMatch[2]) : null;
  const countMatch = explicitCountMatch ?? leadingItemCountMatch ?? parentheticalCountMatch;
  return { amount: base?.amount ?? null, unit: base?.unit ?? null, count: countMatch ? Number(countMatch[1]) : null, multipack: false };
}

function sizeText(value: string) {
  const raw = plain(value).replace(/,/g, '.').replace(/×/g, 'x');
  const multi = raw.match(/\b\d+\s*x\s*\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl)\b/i); if (multi) return multi[0];
  const count = raw.match(/\b\d+\s*(?:pack|pk|rolls?|pieces?|tabs?|tablets?|capsules?|wipes?|bags?|sachets?|boxes?|cans?|bottles?|burgers?|fish\s+fingers?|fingers?|singles?|slices?)\b/i);
  const amount = raw.match(/\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl)\b/i); return [count?.[0], amount?.[0]].filter(Boolean).join(' ').trim();
}

export function isDunnesPackCompatible(canonical: string, candidate: string) {
  const expected = dunnesPackSignature(canonical), actual = dunnesPackSignature(candidate);
  if (expected.amount !== null && (actual.amount === null || expected.unit !== actual.unit || expected.amount !== actual.amount)) return false;
  if (expected.count !== null && (actual.count === null || expected.count !== actual.count)) return false;
  if (!expected.multipack && actual.multipack) return false; if (expected.multipack && !actual.multipack) return false; return true;
}
export function dunnesPackRatio(canonical: string, candidate: string): number | null {
  const expected = dunnesPackSignature(canonical), actual = dunnesPackSignature(candidate);
  if (expected.amount !== null && actual.amount !== null && expected.unit === actual.unit) { if (expected.multipack || actual.multipack) return (actual.amount * (actual.count ?? 1)) / (expected.amount * (expected.count ?? 1)); return actual.amount / expected.amount; }
  if (expected.count !== null && actual.count !== null) return actual.count / expected.count;
  if (expected.count !== null && actual.count === null && actual.amount !== null) return 1 / expected.count; return null;
}

const GENERIC = new Set(['the','and','with','original','fresh','irish','pack','bottle','aerosol','spray','product','free','good','selected','selection','large','small','medium','standard','premium']);
function words(value: string) { return normaliseDunnesName(value).replace(/\b\d+(?:\s+\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack)?\b/g,' ').split(/\s+/).filter(w => w.length > 2 && !GENERIC.has(w)); }
function nameScore(expected: string, candidate: string) { const ew=words(expected), cw=words(candidate), cn=normaliseDunnesName(candidate), en=normaliseDunnesName(expected); if(!ew.length||!cw.length)return 0;if(en===cn)return 1;return (ew.filter(w=>cn.includes(w)).length/ew.length)*.75+(cw.filter(w=>en.includes(w)).length/cw.length)*.25; }
function brandMatches(brand:string,candidate:string){const b=normaliseDunnesName(brand),c=normaliseDunnesName(candidate);if(b&&c.includes(b))return true;return b.split(/\s+/).filter(Boolean).filter(w=>w.length>=4||(w.length>=3&&/\d/.test(w))).some(w=>c.includes(w));}
function productSignalMatches(canonicalName:string,candidate:string){const p=words(canonicalName);if(!p.length)return false;const c=normaliseDunnesName(candidate);return p.filter(w=>c.includes(w)).length/p.length>=.6;}
const VARIANT_GROUPS=[['spaghetti','hoops'],['salted','unsalted'],['smooth','crunchy'],['regular','zero','diet'],['white','wholemeal','wholegrain']];
function variantTerms(value:string,group:string[]){const t=new Set(normaliseDunnesName(value).split(/\s+/).filter(Boolean));return group.filter(term=>t.has(term));}
export function hasDunnesVariantConflict(canonicalName:string,candidate:string){return VARIANT_GROUPS.some(group=>{const e=variantTerms(canonicalName,group),a=variantTerms(candidate,group);if(!e.length&&!a.length)return false;if(e.length!==a.length)return true;return e.some(term=>!a.includes(term));});}
function coreTerms(canonicalName:string,brand:string){const bw=new Set(words(brand));return words(canonicalName).filter(w=>!bw.has(w)).slice(0,5).join(' ');}
function queryVariants(canonicalName:string,brand:string){const cn=normaliseDunnesName(canonicalName),bn=normaliseDunnesName(brand),enriched=cn.includes(bn)?canonicalName:`${brand} ${canonicalName}`,core=coreTerms(canonicalName,brand),pack=sizeText(canonicalName);return [...new Set([enriched,core?`${brand} ${core}`:brand,core&&pack?`${brand} ${core} ${pack}`:'',canonicalName].map(v=>v.trim()).filter(Boolean))];}
function makeProductUrl(candidate:{sku:string|null;name:string}){if(!candidate.sku||!candidate.name)return null;const slug=candidate.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');return `${SITE_URL}/sm/delivery/rsid/${STORE_ID}/product/details/${encodeURIComponent(slug)}/${candidate.sku}`;}
async function searchDunnes(query:string):Promise<RawCandidate[]>{const trimmed=query.split(' ').slice(0,8).join(' ').slice(0,90),url=`${API_BASE}/stores/${STORE_ID}/search?q=${encodeURIComponent(trimmed)}&take=12&page=1&skip=0`;const response=await fetch(url,{cache:'no-store',headers:{Accept:'application/json, text/plain, */*','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36','x-site-host':SITE_URL,'x-site-location':'HeadersBuilderInterceptor','x-correlation-id':crypto.randomUUID(),'x-shopping-mode':'22222222-2222-2222-2222-222222222222'}});if(!response.ok)throw new Error(`Dunnes discovery search HTTP ${response.status} for query ${JSON.stringify(trimmed)}`);const body=await response.json() as {items?:Array<{sku?:string|number|null;name?:string|null;priceNumeric?:number|null}>};return(body.items??[]).map(item=>{const candidate={sku:item.sku==null?null:String(item.sku),name:item.name??'',price:typeof item.priceNumeric==='number'?item.priceNumeric:null,url:null as string|null};candidate.url=makeProductUrl(candidate);return candidate;});}
export async function discoverDunnesProduct(canonicalName:string,brand:string):Promise<DunnesDiscoveryResult>{const variants=queryVariants(canonicalName,brand),byKey=new Map<string,RawCandidate&{queries:string[]}>(),failures:Error[]=[];let successfulQueries=0;for(const query of variants){let candidates:RawCandidate[];try{candidates=await searchDunnes(query);successfulQueries+=1;}catch(error){failures.push(error instanceof Error?error:new Error(String(error)));continue;}for(const candidate of candidates){const key=candidate.sku||`${normaliseDunnesName(candidate.name)}:${candidate.price??''}`,existing=byKey.get(key);if(existing)existing.queries.push(query);else byKey.set(key,{...candidate,queries:[query]});}}if(successfulQueries===0&&failures.length>0)throw new Error(`All Dunnes discovery queries failed: ${failures.map(error=>error.message).join(' | ')}`);const expected=normaliseDunnesName(canonicalName).includes(normaliseDunnesName(brand))?canonicalName:`${brand} ${canonicalName}`;const ranked:DunnesDiscoveryCandidate[]=[...byKey.values()].map(candidate=>({...candidate,score:nameScore(expected,candidate.name),brandMatch:brandMatches(brand,candidate.name),packMatch:isDunnesPackCompatible(canonicalName,candidate.name),productSignalMatch:productSignalMatches(canonicalName,candidate.name),variantConflict:hasDunnesVariantConflict(canonicalName,candidate.name),canonicalPack:dunnesPackSignature(canonicalName),candidatePack:dunnesPackSignature(candidate.name)})).sort((a,b)=>b.score-a.score);const best=ranked[0]??null;const accepted=Boolean(best&&best.sku&&best.price&&best.price>0&&best.brandMatch&&best.packMatch&&best.productSignalMatch&&!best.variantConflict&&best.score>=.72);return{queryVariants:variants,candidates:ranked,best,accepted};}
