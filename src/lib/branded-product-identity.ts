import { validGtin } from './tesco-discovery';

export const IDENTITY_VERSION = 'branded-identity-v1';
export type Store = 'tesco' | 'supervalu' | 'dunnes';
export type BrandRule = { name: string; aliases: string[]; owner: string | null;
  kind: 'manufacturer_brand' | 'retailer_private_label'; source: string; checkedAt: string };
export type Evidence = {
  id: string; store: Store; sku: string; url: string; title: string; brand: string | null;
  gtin: string | null; quantity?: { grams?: number; millilitres?: number; pieces?: number } | null;
  description?: string | null; ingredients?: string | null; imageUrl?: string | null;
  manufacturer?: string | null; dimensions?: string | null;
  source: { kind: 'captured_product' | 'captured_listing' | 'refresh_attested' | 'stored_mapping';
    ref: string; at: string | null; url: string | null; hash?: string };
  mappingIds: string[]; canonicalIds: string[]; conflicts: string[];
  lastLiveVerifiedAt: string | null;
};
export type Pack = { count: number | null; amount: number | null; unit: 'g' | 'ml' | 'count' | null;
  basis: 'single' | 'per_item' | 'ambiguous_multi' | 'count' | 'unknown'; issues: string[] };
export function normalise(s: string) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[’']/g, '').replace(/&(?:amp;)?/g, ' and ').replace(/[^a-z0-9.%]+/g, ' ')
  .replace(/\.(?!\d)/g, ' ').trim().replace(/\s+/g, ' '); }
export function unitWords(s: string) { return normalise(s.replace(/(\d)\s*[x×]\s*(?=\d)/gi, '$1 x '))
  .replace(/\bkilograms?\b/g, 'kg').replace(/\bgrams?\b/g, 'g')
  .replace(/\bmillilit(?:er|re)s?\b/g, 'ml').replace(/\blit(?:er|re)s?\b/g, 'l'); }
const aliasCache = new WeakMap<BrandRule[], { rule: BrandRule; alias: string }[]>();
export function brandFor(e: Evidence, rules: BrandRule[]) {
  const title = normalise(e.title), stated = normalise(e.brand ?? '');
  // Title prefixes are independent of imported canonical brand metadata. A
  // retailer-owned title always wins over a stale manufacturer-brand field.
  if (!aliasCache.has(rules)) aliasCache.set(rules,rules.flatMap(rule => [rule.name,...rule.aliases].map(alias=>({rule,alias:normalise(alias)}))));
  const aliases = aliasCache.get(rules)!;
  const starts = aliases
    .filter(x => title === x.alias || title.startsWith(x.alias + ' '))
    .sort((a, b) => Number(b.rule.kind === 'retailer_private_label') - Number(a.rule.kind === 'retailer_private_label')
      || b.alias.length - a.alias.length);
  const titleRule = starts[0]?.rule;
  const statedRule = aliases.find(x => x.alias === stated)?.rule;
  if (titleRule) return { rule: titleRule, titleAlias: starts[0].alias,
    conflict: Boolean(statedRule && titleRule.name !== statedRule.name) };
  // A metadata label alone does not establish a branded product.
  return { rule: undefined, titleAlias: '', conflict: false };
}
const multiplier: Record<string, number> = { g: 1, kg: 1000, ml: 1, cl: 10, l: 1000 };
export function parsePack(title: string, quantity?: Evidence['quantity'], allowStructured = false): Pack {
  const text = unitWords(title), issues: string[] = [];
  const measures = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/g)];
  const times = text.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/);
  const reverse = text.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\s*x\s*(\d+)\b/);
  const counts = [...text.matchAll(/\b(\d+)\s*(?:packs?|pk|pieces?|rolls?|bags?|sachets?|capsules?|tablets?|cans?|bottles?)\b/g)]
    .map(m => Number(m[1]));
  const of = text.match(/\bpack of (\d+)\b/); if (of) counts.push(Number(of[1]));
  if (times) counts.push(Number(times[1])); if (reverse) counts.push(Number(reverse[3]));
  if (new Set(counts).size > 1 || counts.some(n => n < 1)) issues.push('conflicting_pack_counts');
  if (measures.length > 1) issues.push('multiple_explicit_measures');
  const m = measures[0]; let amount = m ? Number(m[1]) * multiplier[m[2]] : null;
  let unit: Pack['unit'] = m ? ['g', 'kg'].includes(m[2]) ? 'g' : 'ml' : null;
  const count = counts[0] ?? (m ? 1 : null);
  if (amount !== null && amount <= 0) issues.push('invalid_measure');
  const structured = quantity ? Object.entries(quantity).filter(([,v]) => v !== undefined) : [];
  if (structured.length > 1) issues.push('ambiguous_structured_quantity');
  if (structured.length === 1 && structured[0][0] !== 'pieces') {
    const [key, value] = structured[0]; const qUnit = key === 'grams' ? 'g' : 'ml';
    if (!Number.isFinite(value) || value <= 0) issues.push('invalid_structured_quantity');
    else if (amount !== null && count === 1 && (value !== amount || qUnit !== unit)) issues.push('title_structured_quantity_conflict');
    else if (allowStructured && amount === null && counts.length === 0) { amount = value; unit = qUnit; }
  }
  if (/\b(?:loose|per kg|approx|approximately|variable weight)\b/.test(text)) issues.push('variable_pack');
  if (/\b(?:multipack|multi pack)\b/.test(text) && !counts.length) issues.push('missing_multipack_count');
  if (amount !== null && count !== null && count > 1 && !times && !reverse) issues.push('multipack_measure_basis_unconfirmed');
  if (amount !== null) return { count: count ?? 1, amount, unit,
    basis: (count ?? 1) === 1 ? 'single' : times || reverse ? 'per_item' : 'ambiguous_multi', issues };
  if (count !== null) return { count, amount: count, unit: 'count', basis: 'count', issues };
  return { count: null, amount: null, unit: null, basis: 'unknown', issues: [...issues, 'pack_missing'] };
}
export function identityWords(e: Evidence, titleAlias: string) {
  let s = unitWords(e.title);
  if (titleAlias && s.startsWith(titleAlias)) s = s.slice(titleAlias.length);
  s = s.replace(/\b\d+\s*x\s*(?=\d)/g, '').replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|cl|l)\b/g, '')
    .replace(/\bx\s*\d+\b/g, '')
    .replace(/\b(?:pack of )?\d+\s*(?:packs?|pk|pieces?|rolls?|bags?|sachets?|capsules?|tablets?|cans?|bottles?)\b/g, '')
    .replace(/\bpetits? pois(?: peas)?\b/g, 'petits pois');
  // No generic stemming, stopword removal of negation, or spelling inference.
  return [...new Set(s.split(' ').filter(w => w && !['and', 'the', 'pack', 'pk', 'bottle', 'can', 'jar'].includes(w)))].sort();
}
export function safeProductUrl(e: Pick<Evidence, 'url' | 'sku' | 'store'>) {
  if (!/^\d{5,14}$/.test(e.sku)) return false;
  try { const u = new URL(e.url);
    if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.search) return false;
    if (e.store === 'tesco') return u.origin === 'https://www.tesco.ie' && u.pathname === `/shop/en-IE/products/${e.sku}`;
    const host = e.store === 'supervalu' ? 'shop.supervalu.ie' : 'www.dunnesstoresgrocery.com';
    return u.hostname === host && /\/product\//.test(u.pathname)
      && new RegExp(`(?:/|-id-)${e.sku}$`).test(u.pathname);
  } catch { return false; }
}
export function supported(e: Evidence, asOf: string) {
  const time = Date.parse(e.source.at ?? '');
  return e.source.kind !== 'stored_mapping' && Number.isFinite(time) && time <= Date.parse(asOf)
    && time > Date.parse(asOf) - 14 * 86400000 && safeProductUrl(e) && e.conflicts.length === 0
    && (!(e.source.kind === 'captured_product' || e.source.kind === 'captured_listing') || /^[a-f0-9]{64}$/.test(e.source.hash ?? ''));
}
export type Decision = { decision: 'exact_match' | 'not_exact_match' | 'insufficient_evidence';
  method: 'barcode' | 'deterministic' | 'llm_corroborated' | 'unresolved'; reasons: string[]; contradictions: string[];
  missing: string[]; sameWords: boolean; samePack: boolean; plausible: boolean };
export function compare(a: Evidence, b: Evidence, rules: BrandRule[], asOf: string): Decision {
  const aa = brandFor(a, rules), bb = brandFor(b, rules);
  const pa = parsePack(a.title, a.quantity, a.source.kind === 'captured_product'), pb = parsePack(b.title, b.quantity, b.source.kind === 'captured_product');
  const wa = identityWords(a, aa.titleAlias), wb = identityWords(b, bb.titleAlias);
  const contradictions: string[] = [], missing: string[] = [];
  if (!aa.rule || !bb.rule) missing.push('brand_ownership_unverified');
  if (aa.rule?.kind === 'retailer_private_label' || bb.rule?.kind === 'retailer_private_label') contradictions.push('retailer_private_label');
  if (aa.rule && bb.rule && aa.rule.name !== bb.rule.name) contradictions.push('brand_conflict');
  if (aa.conflict || bb.conflict) contradictions.push('title_brand_metadata_conflict');
  if (pa.count !== null && pb.count !== null && pa.count !== pb.count) contradictions.push('pack_count_conflict');
  if (pa.amount !== null && pb.amount !== null && pa.basis === pb.basis && (pa.amount !== pb.amount || pa.unit !== pb.unit)) contradictions.push('pack_size_conflict');
  const samePack = pa.amount !== null && pb.amount !== null && pa.unit === pb.unit && pa.amount === pb.amount && pa.count === pb.count && pa.basis === pb.basis && !pa.issues.length && !pb.issues.length;
  if (!samePack) missing.push('exact_pack_not_established');
  for (const issue of [...pa.issues, ...pb.issues]) missing.push(issue);
  if ([...pa.issues,...pb.issues].includes('title_structured_quantity_conflict')) contradictions.push('title_structured_quantity_conflict');
  const critical = ['original','vanilla','strawberry','chocolate','banana','mint','orange','lemon','lime','raspberry','blueberry',
    'wholemeal','white','brown','skimmed','whole','light','lite','zero','diet','unsalted','salted','smoked','unsmoked','organic',
    'decaf','decaffeinated','sensitive','bio','non','vegan','vegetarian','gluten','lactose','protein','concentrated','concentrate',
    'powder','liquid','gel','spray','frozen','fresh','antibacterial','sugar','no','free','reduced'];
  for (const term of critical) if (wa.includes(term) !== wb.includes(term)) missing.push(`variant_unconfirmed:${term}`);
  const opposing = [['salted','unsalted'],['whole','skimmed'],['smoked','unsmoked'],['white','wholemeal'],['original','zero'],['original','light'],['bio','non bio'],['fresh','frozen'],['powder','liquid'],['chocolate','vanilla'],['strawberry','raspberry']];
  const ta = ` ${wa.join(' ')} `, tb = ` ${wb.join(' ')} `;
  for (const [x,y] of opposing) if ((ta.includes(` ${x} `) && tb.includes(` ${y} `)) || (tb.includes(` ${x} `) && ta.includes(` ${y} `))) contradictions.push('formulation_or_flavour_conflict');
  const numbers = (w: string[]) => w.filter(x => /^\d/.test(x));
  if (numbers(wa).length && numbers(wb).length && JSON.stringify(numbers(wa)) !== JSON.stringify(numbers(wb))) contradictions.push('numeric_formulation_conflict');
  const container = (e: Evidence) => unitWords(e.title).match(/\b(can|bottle|jar)s?\b/)?.[1];
  if (container(a) && container(b) && container(a) !== container(b)) contradictions.push('container_conflict');
  if(Boolean(container(a))!==Boolean(container(b)))missing.push('container_unconfirmed');
  const ga = validGtin(a.gtin), gb = validGtin(b.gtin);
  if (ga && gb && ga !== gb) contradictions.push('barcode_conflict_requires_review');
  if (!supported(a, asOf) || !supported(b, asOf)) missing.push('independent_recent_retailer_evidence_missing');
  if (a.conflicts.length || b.conflicts.length) missing.push('conflicting_sku_records');
  if (!safeProductUrl(a) || !safeProductUrl(b)) missing.push('invalid_or_missing_product_url');
  const sameWords = wa.length > 0 && JSON.stringify(wa) === JSON.stringify(wb);
  const shared = wa.filter(w => wb.includes(w)).length;
  const plausible = Boolean(aa.rule && bb.rule && aa.rule.name === bb.rule.name && shared > 0 && shared / Math.max(wa.length,wb.length) >= .4);
  if (!sameWords) missing.push('wording_requires_inference_or_corroboration');
  // A shared barcode does not override conflicting variant words, title/pack
  // contradictions, unsafe provenance or retailer ownership.
  // A checksum-valid barcode can be copied into a wrong record. Unknown word
  // differences remain review work except narrowly non-identity merchandising.
  const packagingWords = new Set(['squeezy','squeeze','sharing','multipack']);
  const unexplained = [...wa.filter(w=>!wb.includes(w)),...wb.filter(w=>!wa.includes(w))].filter(w=>!packagingWords.has(w));
  const barcode = Boolean(ga && gb && ga === gb && samePack && !unexplained.length && !missing.some(x => x.startsWith('variant_')));
  const blockers = missing.filter(x => !(barcode && x === 'wording_requires_inference_or_corroboration'));
  const decision = contradictions.length ? 'not_exact_match' : blockers.length ? 'insufficient_evidence' : 'exact_match';
  return { decision, method: decision === 'exact_match' ? barcode ? 'barcode' : 'deterministic' : 'unresolved',
    reasons: [...new Set([...contradictions,...missing])], contradictions: [...new Set(contradictions)], missing: [...new Set(missing)], sameWords, samePack, plausible };
}
