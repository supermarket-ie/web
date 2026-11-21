// Barcode-led cross-retailer discovery (owner priority, 21 Nov 2026). PURE: no I/O.
//
// The barcode comes from Tesco's own product data (Apify `gtin`). Dunnes and SuperValu expose no barcode field, but
// their public storefront search resolves a manufacturer barcode to exactly one SKU (measured 20 Nov: controls clean).
// A search hit is therefore STRONG DISCOVERY EVIDENCE that the retailer's own catalogue associates that SKU with the
// barcode. It is recorded as `sku_found_by_gtin_search`, which is distinct from a GTIN the retailer itself returned
// (`gtin_returned_by_retailer`, which never occurs for Dunnes/SuperValu today). It is never automatic proof of an exact
// match: deterministic brand / pack / count / variant checks run on the hit, conflicts are HELD, and comparison
// relationships still require the protected pair review.
import { canonicalVariantConflict, declaredPack, normalized } from './tesco-hold-reentry';

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

// Accent- and punctuation-insensitive, spaceless form ("Müller" = "muller", "Dr. Oetker" = "droetker").
const flat = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Every interpretation of a title's stated quantity as a WHOLE-PACK total in g/ml: "6x25g" = 150; SuperValu-style
// "6 Pack (25 g)" = 150 (count x per-unit) or 25 (if the measure is already the total).
function packTotals(title: string, structured?: SearchHit['unitOfSize']): number[] {
  const t = title.toLowerCase().replace(/[()]/g, ' ').replace(/(\d),(\d)/g, '$1.$2');
  const unit: Record<string, number> = { g: 1, kg: 1000, ml: 1, cl: 10, l: 1000, ltr: 1000, litre: 1000, litres: 1000 };
  const out = new Set<number>();
  const mx = t.match(/\b(\d{1,3})\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|ltr|litres?|l)\b/);
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|ltr|litres?|l)\b/);
  const c = t.match(/\b(\d{1,3})\s*(?:pack|pk|x)\b/);
  if (mx) out.add(Math.round(Number(mx[1]) * Number(mx[2]) * unit[mx[3]]));
  else if (m) { const v = Number(m[1]) * unit[m[2]]; out.add(Math.round(v)); if (c) out.add(Math.round(v * Number(c[1]))); }
  if (structured && Number(structured.size) > 0 && structured.abbreviation && unit[structured.abbreviation.toLowerCase()]) {
    const v = Number(structured.size) * unit[structured.abbreviation.toLowerCase()];
    out.add(Math.round(v)); if (c) out.add(Math.round(v * Number(c[1])));
  }
  return [...out];
}

// Qualifiers that CONTRADICT each other when stated on opposite sides. A qualifier stated on one side only is an
// omission (retailer titles differ in detail), not a contradiction, under a shared barcode.
const CONTRADICTIONS: Array<[RegExp, RegExp]> = [
  [/\b(sugar free|no added sugar|zero|diet)\b/, /\b(regular|full sugar|original)\b/],
  [/\b(light|lite|lighter|low fat|reduced fat|skimmed)\b/, /\b(full fat|whole|extra creamy)\b/],
  [/\bunsalted\b/, /\b(?<!un)salted\b/], [/\bunsmoked\b/, /\b(?<!un)smoked\b/],
  [/\bdecaf(feinated)?\b/, /\b(?<!de)caffeinated\b/], [/\bwhite\b/, /\b(brown|wholemeal)\b/],
  [/\bmild\b/, /\b(hot|extra hot)\b/], [/\bsmooth\b/, /\b(crunchy|with bits|bits)\b/],
];
/** STATED contradictions between the Tesco product and the retailer's barcode hit ([] = none found). */
export function barcodeIdentityConflicts(tesco: { name: string; brand: string | null }, hit: SearchHit): string[] {
  const reasons: string[] = [];
  // Brand: the Tesco brand (or its first word) must appear in the hit's structured brand or title, or vice versa,
  // ignoring accents, case, spacing and punctuation. Only a clearly different brand is a contradiction.
  const tb = flat(tesco.brand), tb1 = flat((tesco.brand ?? '').split(/\s+/)[0]);
  const hb = flat(hit.brand), hn = flat(hit.name), hb1 = flat((hit.brand ?? '').split(/\s+/)[0]);
  const brandOk = !tb ? false : hn.includes(tb) || (hb && (hb.includes(tb) || tb.includes(hb)))
    || (tb1.length >= 4 && (hn.includes(tb1) || (!!hb && hb.includes(tb1)))) || (hb1.length >= 4 && tb.includes(hb1))
    || (hb.length >= 4 && tb.startsWith(hb.slice(0, 4)) && hn.includes(hb.slice(0, 4)));
  if (!brandOk || (tesco.brand && !hit.brand && !hn.includes(tb1) && !hn.includes(tb))) reasons.push('brand');
  // Pack: a contradiction only when both sides state a quantity and NO whole-pack interpretation agrees.
  const a = packTotals(tesco.name), b = packTotals(hit.name, hit.unitOfSize);
  if (a.length && b.length && !a.some(x => b.some(y => Math.abs(x - y) <= Math.max(1, x * 0.005)))) reasons.push('pack');
  // Count: both state an explicit multipack count and they differ.
  const ca = declaredPack(tesco.name), cb = declaredPack(hit.name);
  if (ca.countExplicit && cb.countExplicit && ca.units !== cb.units) reasons.push('count');
  // Variant: an explicit contradiction across the two titles.
  const ta = normalized(tesco.name), tb2 = normalized(hit.name);
  if (CONTRADICTIONS.some(([x, y]) => (x.test(ta) && y.test(tb2) && !x.test(tb2)) || (y.test(ta) && x.test(tb2) && !x.test(ta)))) reasons.push('variant');
  return reasons;
}
// Product words: no brand words, measures, counts or generic packaging/marketing words; accents folded; plurals folded.
const GENERIC = new Set(['and', 'with', 'the', 'of', 'in', 'for', 'a', 'pack', 'pk', 'x', 'bottle', 'bag', 'pouch', 'tub', 'jar', 'tin', 'can',
  'sharing', 'single', 'multipack', 'flavour', 'flavoured', 'original', 'classic', 'irish', 'real', 'pure', 'new', 'piece', 'pieces']);
function productWords(title: string, brand: string | null): Set<string> {
  const brandWords = new Set((brand ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return new Set(title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|g|ml|cl|l|ltr|litres?|litre)\b/g, ' ').split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !/^\d+$/.test(w) && !brandWords.has(w) && !GENERIC.has(w))
    .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)));
}
/**
 * Title agreement between the Tesco product and the barcode hit: shared product words over the SMALLER set (0..1).
 * A SECOND, independent signal: a barcode hit whose title diverges (e.g. Tesco "NIVEA Creme Soft Shower Cream" vs a
 * retailer's "Nivea Clay Fresh Shower Cream" under the same barcode) is a retailer data error or relabel, and goes to
 * review rather than counting as a strong association.
 */
export function titleAgreement(tesco: { name: string; brand: string | null }, hit: SearchHit): number {
  const a = productWords(tesco.name, tesco.brand), b = productWords(hit.name, hit.brand ?? tesco.brand);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter(w => b.has(w) || [...b].some(x => x.length >= 5 && w.length >= 5 && (x.startsWith(w) || w.startsWith(x)))).length;
  return Math.round((shared / Math.min(a.size, b.size)) * 100) / 100;
}
export const STRONG_TITLE_AGREEMENT = 0.6;
export type EvidenceTier = 'strong' | 'review' | 'held';
/** strong = one SKU, no stated contradiction AND title agreement; review = barcode only; held = conflict/ambiguous. */
export function evidenceTier(outcome: BarcodeOutcome, agreement: number): EvidenceTier | null {
  if (outcome === 'identity_consistent') return agreement >= STRONG_TITLE_AGREEMENT ? 'strong' : 'review';
  if (outcome === 'identity_conflict' || outcome === 'ambiguous') return 'held';
  return null;
}
/** Stricter, informational: qualifiers stated on one side only (omissions). Never a hold reason by itself. */
export function oneSidedQualifiers(tesco: string, hit: string): boolean { return canonicalVariantConflict(tesco, hit); }

/** Classify one retailer's response(s) for one barcode. `hits` = de-duplicated items across the query forms. */
export function classifyBarcodeResult(tesco: { name: string; brand: string | null }, hits: SearchHit[]):
  { outcome: BarcodeOutcome; sku: string | null; reasons: string[] } {
  const bySku = new Map(hits.filter(h => h.sku).map(h => [h.sku, h]));
  if (bySku.size === 0) return { outcome: 'not_found', sku: null, reasons: [] };
  if (bySku.size > 1) return { outcome: 'ambiguous', sku: null, reasons: [`skus:${[...bySku.keys()].join('+')}`] };
  const hit = [...bySku.values()][0];
  const reasons = barcodeIdentityConflicts(tesco, hit);
  return { outcome: reasons.length ? 'identity_conflict' : 'identity_consistent', sku: hit.sku, reasons };
}

export type MappingRelation = 'confirms_mapping' | 'conflicts_with_mapping' | 'new_relationship' | 'sku_owned_by_other_canonical';
/** Relation of a barcode-resolved retailer SKU to our existing mappings for the Tesco product's canonical record. */
export function relationToMapping(resolvedSku: string, canonicalOffers: string[], skuOwnedByOtherCanonical: boolean): MappingRelation {
  if (canonicalOffers.includes(resolvedSku)) return 'confirms_mapping';
  if (skuOwnedByOtherCanonical) return 'sku_owned_by_other_canonical';
  return canonicalOffers.length ? 'conflicts_with_mapping' : 'new_relationship';
}
