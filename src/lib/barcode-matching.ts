// Barcode-led cross-retailer discovery (owner priority, 21 Nov 2026). PURE: no I/O.
//
// The barcode comes from Tesco's own product data (Apify `gtin`). Dunnes and SuperValu expose no barcode field, but
// their public storefront search resolves a manufacturer barcode to exactly one SKU (measured 20 Nov: controls clean).
// A search hit is therefore STRONG DISCOVERY EVIDENCE that the retailer's own catalogue associates that SKU with the
// barcode. It is recorded as `sku_found_by_gtin_search`, which is distinct from a GTIN the retailer itself returned
// (`gtin_returned_by_retailer`, which never occurs for Dunnes/SuperValu today). It is never automatic proof of an exact
// match: deterministic brand / pack / count / variant checks run on the hit, conflicts are HELD, and comparison
// relationships still require the protected pair review.

export type GtinKind = 'gtin8' | 'gtin12' | 'gtin13';
export type GtinRejection = 'not_digits' | 'bad_length' | 'bad_check_digit' | 'packaging_gtin14' | 'variable_measure'
  | 'restricted_circulation' | 'coupon_or_refund';
export type NormalisedGtin =
  | { ok: true; kind: GtinKind; gtin14: string; retail: string; queryForms: string[] }
  | { ok: false; reason: GtinRejection; raw: string };

/** GS1 mod-10 check digit over the full code (8, 12, 13 or 14 digits). */
export function gs1CheckDigitValid(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop()!;
  let sum = 0;
  d.reverse().forEach((x, i) => { sum += x * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Normalise a stated GTIN to the RETAIL-UNIT identifier and the exact forms a retailer search indexes.
 * - GTIN-14 with indicator digit 1-8 identifies a packaging level (case/outer), not the retail pack: rejected.
 * - Indicator 9 is variable measure: rejected.
 * - A zero-padded GTIN-14 is unpadded to EAN-13, UPC-A (12) or EAN-8 by GS1 nesting (13 / 12 / 8 significant digits).
 * - Restricted-circulation prefixes (EAN-13 020-029, 040-049 and 200-299; EAN-8 starting 0 or 2) are retailer-internal
 *   or in-store codes: rejected. Coupon/refund prefixes 98-99 are rejected.
 * Query forms: EAN-13 as 13 digits; UPC-A as both its EAN-13 form ("0"+12) and 12 digits; EAN-8 as 8 digits
 * (the 14-digit padded form never resolves; measured).
 */
export function normaliseGtin(raw: unknown): NormalisedGtin {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return { ok: false, reason: 'not_digits', raw: s };
  if (![8, 12, 13, 14].includes(s.length)) return { ok: false, reason: 'bad_length', raw: s };
  if (!gs1CheckDigitValid(s)) return { ok: false, reason: 'bad_check_digit', raw: s };
  const gtin14 = s.padStart(14, '0');
  const indicator = gtin14[0];
  if (indicator === '9') return { ok: false, reason: 'variable_measure', raw: s };
  if (indicator !== '0') return { ok: false, reason: 'packaging_gtin14', raw: s };
  let kind: GtinKind, retail: string;
  if (gtin14.startsWith('000000')) { kind = 'gtin8'; retail = gtin14.slice(6); }
  else if (gtin14.startsWith('00')) { kind = 'gtin12'; retail = gtin14.slice(2); }
  else { kind = 'gtin13'; retail = gtin14.slice(1); }
  if (kind === 'gtin8' && /^[02]/.test(retail)) return { ok: false, reason: 'restricted_circulation', raw: s };
  if (kind === 'gtin13' && /^(0[24]|2)/.test(retail)) return { ok: false, reason: 'restricted_circulation', raw: s };
  if (kind === 'gtin13' && /^9[89]/.test(retail)) return { ok: false, reason: 'coupon_or_refund', raw: s };
  // An EAN-13 beginning "0" IS a UPC-A: number systems 2/4 are in-store/restricted, 5 is coupons.
  if (kind === 'gtin12' && /^[24]/.test(retail)) return { ok: false, reason: 'restricted_circulation', raw: s };
  if (kind === 'gtin12' && /^5/.test(retail)) return { ok: false, reason: 'coupon_or_refund', raw: s };
  const queryForms = kind === 'gtin12' ? [`0${retail}`, retail] : [retail];
  return { ok: true, kind, gtin14, retail, queryForms };
}

export type SearchHit = { sku: string; name: string; brand: string | null; unitOfSize?: { size?: number; abbreviation?: string } | null };
export type BarcodeOutcome =
  | 'not_found'                // the retailer's search returned no item for any query form
  | 'ambiguous'                // more than one SKU for the barcode: held
  | 'identity_conflict'        // one SKU, but brand/pack/count/variant contradicts the Tesco product: held
  | 'identity_consistent';     // one SKU, no deterministic contradiction (still NOT an approved exact match)

// One normaliser for brand AND title words: accents folded, apostrophes joined ("Jerry's" = "jerrys"), lower case.
export function identityTokens(s: string | null | undefined): string[] {
  return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}
// Known cross-retailer spellings of the SAME brand (spaceless token form -> canonical tokens). Extend only with
// evidence; anything not listed must match by whole tokens.
const BRAND_ALIASES: Record<string, string[]> = { mullerice: ['muller', 'rice'], muller: ['muller'], miwadi: ['mi', 'wadi'], mandm: ['m', 'm'] };
const BRAND_NOISE = new Set(['the', 'co', 'company', 'ltd', 'limited', 'and', 'of', 'paris', 'foods', 'family']);
type BrandMatch = 'match' | 'partial' | 'mismatch';
function brandMatch(tescoBrand: string | null, hit: SearchHit): BrandMatch {
  const tb = identityTokens(tescoBrand).filter(t => !BRAND_NOISE.has(t));
  if (!tb.length) return 'mismatch';
  const hitTokens = new Set([...identityTokens(hit.brand), ...identityTokens(hit.name)]);
  const joined = tb.join(''), hitJoined = identityTokens(hit.name).join(''), hitBrandJoined = identityTokens(hit.brand).join('');
  const alias = BRAND_ALIASES[joined];
  if (tb.every(t => hitTokens.has(t)) || (alias && alias.every(t => hitTokens.has(t)))) return 'match';
  // Spacing variants ("Mi Wadi" / "MiWadi"): the joined brand (>= 5 chars) inside the joined hit brand or title.
  if (joined.length >= 5 && (hitBrandJoined === joined || hitJoined.includes(joined) || (hitBrandJoined.length >= 5 && joined === hitBrandJoined))) return 'match';
  // A first-token match only (e.g. "Maguire & Paterson" vs "Maguire & Patterson") is NOT proof: review.
  if (tb[0].length >= 4 && hitTokens.has(tb[0])) return 'partial';
  return 'mismatch';
}

// Quantity of one title: explicit count (if any), per-unit measure and whole-pack total, in g/ml/piece.
type PackInfo = { count: number | null; unit: number | null; totals: number[] };
const UNIT: Record<string, number> = { g: 1, kg: 1000, ml: 1, cl: 10, l: 1000, ltr: 1000, litre: 1000, litres: 1000 };
const COUNT_WORDS = '(?:pack|pk|pots?|sachets?|bars?|rolls?|sticks?|pouches?|cans?|bottles?|tins?|tubs?|pieces?|piece|portions?|slices?)';
function packInfo(title: string, structured?: SearchHit['unitOfSize']): PackInfo {
  const t = title.toLowerCase().replace(/[()]/g, ' ').replace(/(\d),(\d)/g, '$1.$2');
  const mx = t.match(/\b(\d{1,3})\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|ltr|litres?|litre|l)\b/);
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|ltr|litres?|litre|l)\b/);
  const c = t.match(new RegExp(`\\b(\\d{1,3})\\s*(?:x\\b|${COUNT_WORDS}\\b)`)) ?? t.match(/\b(?:pack|pk)\s*of\s*(\d{1,3})\b/);
  const st = structured && Number(structured.size) > 0 && structured.abbreviation && UNIT[structured.abbreviation.toLowerCase()]
    ? Math.round(Number(structured.size) * UNIT[structured.abbreviation.toLowerCase()]) : null;
  if (mx) { const n = Number(mx[1]), u = Number(mx[2]) * UNIT[mx[3]]; return { count: n, unit: Math.round(u), totals: [Math.round(n * u)] }; }
  const count = c ? Number(c[1]) : null;
  const v = m ? Math.round(Number(m[1]) * UNIT[m[2]]) : null;
  const totals = new Set<number>();
  if (st != null) totals.add(st);                         // a retailer's structured size states the whole pack
  else if (v != null) { totals.add(v); if (count && count > 1) totals.add(v * count); } // "6 Pack (25 g)": 25 per unit or total
  return { count: count && count > 1 ? count : null, unit: v, totals: [...totals] };
}
const close = (x: number, y: number) => Math.abs(x - y) <= Math.max(1, x * 0.005);

// Mutually exclusive variant groups: a conflict when both titles state a DIFFERENT member of the same group. A member
// stated on one side only is an omission. Longer phrases are matched first ("extra mature" before "mature").
const VARIANT_GROUPS: Array<Array<[string, RegExp]>> = [
  [['no_sugar', /\b(zero|sugar free|no added sugar|diet|no sugars?)\b/], ['regular_sugar', /\b(full sugar|regular)\b/]],
  [['low_fat', /\b(light|lite|lighter|low fat|reduced fat|skimmed|semi skimmed|fat free)\b/], ['full_fat', /\b(full fat|whole milk|extra creamy)\b/]],
  [['unsalted', /\bunsalted\b/], ['salted', /\b(?<!un)salted\b/]],
  [['unsmoked', /\bunsmoked\b/], ['smoked', /\b(?<!un)smoked\b/]],
  [['decaf', /\bdecaf(feinated)?\b/], ['caffeinated', /\b(?<!de)caffeinated\b/]],
  [['white_bread', /\bwhite\b(?!\s+chocolate)/], ['brown_bread', /\b(brown|wholemeal|wholegrain|wholewheat)\b/]],
  [['extra_mature', /\b(extra mature|vintage|extra strong)\b/], ['mature', /\b(?<!extra )mature\b/], ['medium', /\bmedium\b/],
    ['mild', /\bmild\b/], ['extra_hot', /\bextra hot\b/], ['hot', /\b(?<!extra )hot\b/]],
  [['smooth', /\bsmooth\b/], ['crunchy', /\b(crunchy|chunky|with bits|bits)\b/]],
  [['still', /\bstill\b/], ['sparkling', /\b(sparkling|carbonated|fizzy)\b/]],
  [['dark_choc', /\bdark chocolate\b/], ['milk_choc', /\bmilk chocolate\b/], ['white_choc', /\bwhite chocolate\b/]],
];
function variantLabels(title: string, group: Array<[string, RegExp]>): Set<string> {
  const t = identityTokens(title).join(' ');
  return new Set(group.filter(([, re]) => re.test(t)).map(([l]) => l));
}

// Product words for title agreement / substitution: no brand tokens, measures, numbers or generic words; plurals folded.
const GENERIC = new Set(['and', 'with', 'the', 'of', 'in', 'for', 'a', 'pack', 'pk', 'x', 'bottle', 'bag', 'pouch', 'tub', 'jar', 'tin', 'can',
  'sharing', 'single', 'multipack', 'flavour', 'flavoured', 'original', 'classic', 'irish', 'real', 'pure', 'new', 'piece', 'pieces',
  'fresh', 'large', 'family', 'premium', 'delicious', 'traditional', 'tasty', 'limited', 'edition', 'from', 'months', 'month', 'by']);
function productWords(title: string, brand: string | null): string[] {
  const brandTokens = new Set(identityTokens(brand));
  const t = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’`]/g, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|g|ml|cl|l|ltr|litres?|litre)\b/g, ' ');
  return [...new Set(t.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !/^\d+[a-z]?$/.test(w) && !brandTokens.has(w) && !GENERIC.has(w))
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)))];
}
// Same word, or an inflection only (shared prefix, length difference <= 2): "tomato"/"tomatoes" yes, "pepper"/"peppermint" no.
const sameWord = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s` || (Math.abs(a.length - b.length) <= 2 && Math.min(a.length, b.length) >= 4
  && (a.startsWith(b) || b.startsWith(a)));

export type HitAssessment = { conflicts: string[]; review: string[]; agreement: number };
/**
 * Deterministic assessment of ONE barcode hit against the Tesco product.
 * conflicts (=> held): different brand; both state a quantity and no whole-pack reading agrees; different counts that
 *   do not reconcile; a different member of a mutually exclusive variant group; the hit SKU equals the query.
 * review (=> not strong): partial brand; no positive pack confirmation; unmatched product words on BOTH sides
 *   (substitution, e.g. Strawberry vs Raspberry); low title agreement.
 * Omissions (a detail stated on one side only) are neither.
 */
export function assessBarcodeHit(tesco: { name: string; brand: string | null }, hit: SearchHit, query?: string): HitAssessment {
  const conflicts: string[] = [], review: string[] = [];
  if (query && hit.sku === query) conflicts.push('sku_equals_query');
  const bm = brandMatch(tesco.brand, hit);
  if (bm === 'mismatch') conflicts.push('brand'); else if (bm === 'partial') review.push('brand_partial');
  const a = packInfo(tesco.name), b = packInfo(hit.name, hit.unitOfSize);
  if (a.totals.length && b.totals.length) {
    const matched = a.totals.some(x => b.totals.some(y => close(x, y)));
    if (!matched) conflicts.push('pack');
    else if ((a.count ?? 1) !== (b.count ?? 1)) {
      // Counts differ: reconcile only when the side WITHOUT a count states the other side's WHOLE-pack total.
      const multi = (a.count ?? 1) > 1 ? a : b, single = multi === a ? b : a;
      const multiTotal = multi.count && multi.unit ? multi.count * multi.unit : null;
      const reconciles = single.count == null && multiTotal != null && single.totals.some(x => close(x, multiTotal))
        && !(single.unit != null && multi.unit != null && close(single.unit, multi.unit));
      if (!reconciles) conflicts.push('count');
    }
  } else review.push('pack_unconfirmed');
  for (const g of VARIANT_GROUPS) {
    const la = variantLabels(tesco.name, g), lb = variantLabels(hit.name, g);
    if (la.size && lb.size && ![...la].some(l => lb.has(l))) { conflicts.push(`variant:${[...la].join('+')}|${[...lb].join('+')}`); break; }
  }
  const wa = productWords(tesco.name, tesco.brand), wb = productWords(hit.name, hit.brand ?? tesco.brand);
  const aOnly = wa.filter(w => !wb.some(x => sameWord(w, x))), bOnly = wb.filter(w => !wa.some(x => sameWord(w, x)));
  const shared = wa.length - aOnly.length;
  const agreement = wa.length && wb.length ? Math.round((shared / Math.min(wa.length, wb.length)) * 100) / 100 : 0;
  if (aOnly.length && bOnly.length) review.push(`substitution:${aOnly.join('+')}|${bOnly.join('+')}`);
  if (agreement < STRONG_TITLE_AGREEMENT) review.push(`title_agreement:${agreement}`);
  return { conflicts, review, agreement };
}
/** Back-compatible: the stated contradictions only. */
export function barcodeIdentityConflicts(tesco: { name: string; brand: string | null }, hit: SearchHit): string[] {
  return assessBarcodeHit(tesco, hit).conflicts;
}
export function titleAgreement(tesco: { name: string; brand: string | null }, hit: SearchHit): number {
  return assessBarcodeHit(tesco, hit).agreement;
}
export const STRONG_TITLE_AGREEMENT = 0.6;
export type EvidenceTier = 'strong' | 'review' | 'held';
/** strong = one SKU, no conflict and no review reason; review = barcode evidence needing a human; held = conflict/ambiguous. */
export function evidenceTier(outcome: BarcodeOutcome, agreementOrReview: number | string[]): EvidenceTier | null {
  if (outcome === 'identity_conflict' || outcome === 'ambiguous') return 'held';
  if (outcome !== 'identity_consistent') return null;
  const review = Array.isArray(agreementOrReview) ? agreementOrReview.length > 0 : agreementOrReview < STRONG_TITLE_AGREEMENT;
  return review ? 'review' : 'strong';
}

/** Classify one retailer's response(s) for one barcode. `hits` = items across ALL query forms (an SKU seen twice is one hit). */
export function classifyBarcodeResult(tesco: { name: string; brand: string | null }, hits: SearchHit[], query?: string):
  { outcome: BarcodeOutcome; sku: string | null; reasons: string[]; review: string[]; agreement: number; tier: EvidenceTier | null } {
  const bySku = new Map(hits.filter(h => h.sku).map(h => [h.sku, h]));
  if (bySku.size === 0) return { outcome: 'not_found', sku: null, reasons: [], review: [], agreement: 0, tier: null };
  if (bySku.size > 1) return { outcome: 'ambiguous', sku: null, reasons: [`skus:${[...bySku.keys()].join('+')}`], review: [], agreement: 0, tier: 'held' };
  const hit = [...bySku.values()][0];
  const a = assessBarcodeHit(tesco, hit, query);
  const outcome: BarcodeOutcome = a.conflicts.length ? 'identity_conflict' : 'identity_consistent';
  return { outcome, sku: hit.sku, reasons: a.conflicts, review: a.review, agreement: a.agreement, tier: evidenceTier(outcome, a.review) };
}

export type MappingRelation = 'confirms_mapping' | 'conflicts_with_mapping' | 'new_relationship' | 'sku_owned_by_other_canonical';
/** Relation of a barcode-resolved retailer SKU to our existing mappings for the Tesco product's canonical record. */
export function relationToMapping(resolvedSku: string, canonicalOffers: string[], skuOwnedByOtherCanonical: boolean): MappingRelation {
  if (canonicalOffers.includes(resolvedSku)) return 'confirms_mapping';
  if (skuOwnedByOtherCanonical) return 'sku_owned_by_other_canonical';
  return canonicalOffers.length ? 'conflicts_with_mapping' : 'new_relationship';
}
