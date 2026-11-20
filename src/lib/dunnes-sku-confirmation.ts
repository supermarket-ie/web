import { dunnesPackSignature, hasDunnesVariantConflict, isDunnesPackCompatible, normaliseDunnesName } from './dunnes-discovery';

/**
 * SKU-bound confirmation of a Dunnes discovery candidate (owner-approved smallest safe extension, Nov 2026).
 * A search-listing candidate is never accepted on its own: the retailer's product-by-SKU API response must
 * itself state the same SKU and title, the canonical brand, the canonical's stated pack as a STRUCTURED size,
 * and no own-label flag; the candidate must be the only compatible one and its SKU must be unowned.
 * Pure: the caller fetches (through the request governor) and retains the response body as evidence.
 */
export const DUNNES_PRODUCT_API_BASE = 'https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/products/';
export const dunnesProductApiUrl = (sku: string) => `${DUNNES_PRODUCT_API_BASE}${encodeURIComponent(sku)}`;

export type DunnesProductResponse = {
  sku?: unknown; name?: unknown; brand?: unknown; price?: unknown; available?: unknown;
  unitsOfSize?: { size?: unknown; abbreviation?: unknown } | null;
  attributes?: { OwnBrand?: unknown } | null;
};

export type ConfirmationInput = {
  canonicalName: string;
  canonicalBrand: string;
  candidateSku: string;
  candidateName: string;
  httpStatus: number;
  requestedUrl: string;
  finalUrl: string;
  response: DunnesProductResponse | null;
  /** Another Dunnes offer already carries this SKU (any canonical). */
  skuOwnedElsewhere: boolean;
  /** Other search candidates that also pass brand + pack + no-variant-conflict (ambiguity). */
  otherCompatibleCandidates: number;
};

export type Confirmation = { ok: boolean; reasons: string[]; price: number | null; structuredPack: string | null };

export function parseEuro(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const m = value.replace(/,/g, '').match(/^\s*€?\s*(\d+(?:\.\d{1,2})?)\s*$/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Structured size as "<amount><g|ml>" (kg/l converted), or null. */
export function structuredPackSize(u: DunnesProductResponse['unitsOfSize']): { amount: number; unit: 'g' | 'ml' } | null {
  const size = typeof u?.size === 'number' ? u.size : Number(u?.size);
  const abbr = String(u?.abbreviation ?? '').toLowerCase();
  if (!Number.isFinite(size) || size <= 0) return null;
  const factor: Record<string, [number, 'g' | 'ml']> = { g: [1, 'g'], kg: [1000, 'g'], ml: [1, 'ml'], l: [1000, 'ml'], ltr: [1000, 'ml'], cl: [10, 'ml'] };
  const f = factor[abbr];
  return f ? { amount: Math.round(size * f[0] * 1000) / 1000, unit: f[1] } : null;
}

const words = (s: string) => normaliseDunnesName(s).split(' ').filter(Boolean);
// Title words only: an apostrophe joins a word ("Flahavan's" = "Flahavans") instead of leaving a stray "s".
// Brand confirmation keeps using words(): brand spelling variants are never merged.
const titleWords = (s: string) => words(s.replace(/([a-z])['\u2019]([a-z])/gi, '$1$2'));

/** Canonical brand stated by the response's structured brand (all brand words present, in order-insensitive form). */
export function brandConfirmed(canonicalBrand: string, responseBrand: unknown): boolean {
  if (typeof responseBrand !== 'string' || !responseBrand.trim()) return false;
  const want = words(canonicalBrand), have = new Set(words(responseBrand));
  return want.length > 0 && want.every(w => have.has(w));
}

// Qualifiers that make a different product when stated on only ONE side.
const QUALIFIERS = new Set(['light', 'lite', 'low', 'reduced', 'free', 'zero', 'diet', 'organic', 'original', 'extra', 'mild', 'hot',
  'spicy', 'smoked', 'unsmoked', 'salted', 'unsalted', 'sweetened', 'unsweetened', 'skimmed', 'semi', 'whole', 'wholemeal', 'white',
  'brown', 'decaf', 'sensitive', 'kids', 'baby', 'protein', 'vegan', 'gluten', 'lactose', 'sugar', 'salt', 'fat', 'max', 'mini', 'jumbo', 'large', 'small']);
const PACK_TOKEN = /^(\d+(\.\d+)?(g|kg|ml|l|cl|ltr|x)?|x|pack|pk|portions?|g|kg|ml|l)$/;
/** Every canonical word appears in the retailer title, and no qualifier is stated on one side only. */
export function titleWordProblems(canonicalName: string, retailerTitle: string): string[] {
  // Connectives carry no identity ("Garlic & Herb" = "Garlic and Herb"); qualifier and pack checks are unaffected.
  const CONNECTIVE = new Set(['and', 'with', 'of', 'the', 'in', 'a']);
  // A BARE number is a pack token only when a unit/pack word follows it ("400 g", "6 x", "4 pack"). Otherwise it is
  // identity ("4+ Months" vs "6+ Months", "Size 4", "48 Washes") and must appear on both sides.
  const UNIT_NEXT = /^(g|kg|ml|l|cl|ltr|x|pack|pk|portions?)$/;
  const identity = (s: string) => titleWords(s).filter((w, i, all) =>
    !CONNECTIVE.has(w) && !(PACK_TOKEN.test(w) && (!/^\d+(\.\d+)?$/.test(w) || UNIT_NEXT.test(all[i + 1] ?? ''))));
  const c = identity(canonicalName), t = new Set(identity(retailerTitle));
  const problems: string[] = [];
  const missing = c.filter(w => !t.has(w));
  if (missing.length) problems.push(`title_words_missing:${missing.join('+')}`);
  const cs = new Set(c);
  const oneSided = [...new Set([...c, ...t])].filter(w => QUALIFIERS.has(w) && cs.has(w) !== t.has(w));
  if (oneSided.length) problems.push(`variant_conflict:${oneSided.join('+')}`);
  return problems;
}

const UNIT: Record<string, [number, 'g' | 'ml']> = { g: [1, 'g'], kg: [1000, 'g'], ml: [1, 'ml'], l: [1000, 'ml'], cl: [10, 'ml'] };
/**
 * Multipack stated as a count of N units of M ("6 Pack 25 g", "6 x 25g", "6x25g"). Null unless BOTH a count and a
 * per-unit measure are stated. Used only to recognise the SAME multipack written differently; never to equate a
 * multipack with a single pack.
 */
export function multipackOf(title: string): { count: number; unitAmount: number; unit: 'g' | 'ml' } | null {
  const t = title.toLowerCase().replace(/[()]/g, ' ');
  const m = t.match(/\b(\d{1,3})\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|cl)\b/)
    ?? (() => { const c = t.match(/\b(\d{1,3})\s*(?:pack|pk)\b/), s = t.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l|cl)\b/); return c && s ? [c[0], c[1], s[1], s[2]] as unknown as RegExpMatchArray : null; })();
  if (!m) return null;
  const f = UNIT[m[3]]; const count = Number(m[1]), amount = Number(m[2]) * f[0];
  return count > 1 && amount > 0 ? { count, unitAmount: Math.round(amount * 1000) / 1000, unit: f[1] } : null;
}

/** Pack pre-filter mirroring confirmDunnesSku: the SAME multipack (count + per-unit size), or a compatible single pack. */
export function packCompatible(ref: string, title: string): boolean {
  const a = multipackOf(ref), b = multipackOf(title);
  if (a || b) return !!a && !!b && a.count === b.count && a.unit === b.unit && a.unitAmount === b.unitAmount;
  return isDunnesPackCompatible(ref, title);
}

export type CatalogueListingItem = { sku?: unknown; name?: unknown; brand?: unknown };
/**
 * Candidates for ONE target from a brand's FULL Dunnes listing (brand-facet catalogue walk). An item qualifies only
 * if it fits EVERY reference title supplied (the SuperValu title, plus the Tesco title when the two agree): brand
 * stated by the listing brand or title, compatible pack (same multipack only), every reference word present, and no
 * one-sided qualifier. Listing data never proves identity: the caller requires EXACTLY ONE candidate and then the
 * product-by-SKU confirmation (confirmDunnesSku) before anything is written.
 */
export function brandCatalogueCandidates(brand: string, refs: string[], items: CatalogueListingItem[]): Array<{ sku: string; name: string }> {
  const seen = new Set<string>();
  const out: Array<{ sku: string; name: string }> = [];
  for (const it of items) {
    if (it.sku == null || typeof it.name !== 'string' || seen.has(String(it.sku))) continue;
    seen.add(String(it.sku));
    const name = it.name;
    const branded = brandConfirmed(brand, typeof it.brand === 'string' && it.brand.trim() ? it.brand : name);
    if (!branded || /^dunnes\b/i.test(name)) continue;
    if (refs.length && refs.every(ref => packCompatible(ref, name) && titleWordProblems(ref, name).length === 0 && !hasDunnesVariantConflict(ref, name))) {
      out.push({ sku: String(it.sku), name });
    }
  }
  return out;
}

export function confirmDunnesSku(i: ConfirmationInput): Confirmation {
  const reasons: string[] = [];
  const r = i.response;
  const expectedUrl = dunnesProductApiUrl(i.candidateSku);
  if (i.httpStatus !== 200 || !r) reasons.push(`http_${i.httpStatus}`);
  if (i.requestedUrl !== expectedUrl || i.finalUrl !== expectedUrl) reasons.push('not_sku_bound_request');
  if (r && String(r.sku ?? '') !== i.candidateSku) reasons.push('sku_mismatch');
  const name = typeof r?.name === 'string' ? r.name : '';
  if (!name || normaliseDunnesName(name) !== normaliseDunnesName(i.candidateName)) reasons.push('title_mismatch');
  if (!brandConfirmed(i.canonicalBrand, r?.brand)) reasons.push('brand_not_confirmed');
  if (r?.attributes?.OwnBrand === true || /^dunnes\b/i.test(name)) reasons.push('own_label');
  const canonicalPack = dunnesPackSignature(i.canonicalName);
  const structured = structuredPackSize(r?.unitsOfSize ?? null);
  const refMulti = multipackOf(i.canonicalName), gotMulti = name ? multipackOf(name) : null;
  if (refMulti || gotMulti) {
    // The same multipack only: identical count and per-unit size on both titles; the structured size must be the
    // per-unit size or the whole-pack total of THAT multipack.
    if (!refMulti || !gotMulti || refMulti.count !== gotMulti.count || refMulti.unit !== gotMulti.unit || refMulti.unitAmount !== gotMulti.unitAmount) reasons.push('multipack_differs');
    else if (!structured) reasons.push('structured_pack_missing');
    else if (structured.unit !== refMulti.unit || (structured.amount !== refMulti.unitAmount && structured.amount !== Math.round(refMulti.unitAmount * refMulti.count * 1000) / 1000)) reasons.push('structured_pack_differs');
  } else {
    if (!canonicalPack.amount || !canonicalPack.unit) reasons.push('canonical_pack_unstated');
    else if (canonicalPack.multipack || canonicalPack.count) reasons.push('multipack_not_supported');
    else if (!structured) reasons.push('structured_pack_missing');
    else if (structured.unit !== canonicalPack.unit || structured.amount !== canonicalPack.amount) reasons.push('structured_pack_differs');
    if (name && !isDunnesPackCompatible(i.canonicalName, name)) reasons.push('title_pack_differs');
  }
  if (name && hasDunnesVariantConflict(i.canonicalName, name)) reasons.push('variant_conflict');
  if (name) for (const pr of titleWordProblems(i.canonicalName, name)) if (!reasons.includes(pr)) reasons.push(pr);
  if (i.otherCompatibleCandidates > 0) reasons.push('ambiguous_candidates');
  if (i.skuOwnedElsewhere) reasons.push('sku_already_owned');
  const price = parseEuro(r?.price);
  if (r?.available === false || price === null) reasons.push('no_current_price');
  return { ok: reasons.length === 0, reasons, price, structuredPack: structured ? `${structured.amount}${structured.unit}` : null };
}
