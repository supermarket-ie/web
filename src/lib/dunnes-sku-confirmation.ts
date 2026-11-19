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
  const c = words(canonicalName).filter(w => !PACK_TOKEN.test(w)), t = new Set(words(retailerTitle).filter(w => !PACK_TOKEN.test(w)));
  const problems: string[] = [];
  const missing = c.filter(w => !t.has(w));
  if (missing.length) problems.push(`title_words_missing:${missing.join('+')}`);
  const cs = new Set(c);
  const oneSided = [...new Set([...c, ...t])].filter(w => QUALIFIERS.has(w) && cs.has(w) !== t.has(w));
  if (oneSided.length) problems.push(`variant_conflict:${oneSided.join('+')}`);
  return problems;
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
  if (!canonicalPack.amount || !canonicalPack.unit) reasons.push('canonical_pack_unstated');
  else if (canonicalPack.multipack || canonicalPack.count) reasons.push('multipack_not_supported');
  else if (!structured) reasons.push('structured_pack_missing');
  else if (structured.unit !== canonicalPack.unit || structured.amount !== canonicalPack.amount) reasons.push('structured_pack_differs');
  if (name && !isDunnesPackCompatible(i.canonicalName, name)) reasons.push('title_pack_differs');
  if (name && hasDunnesVariantConflict(i.canonicalName, name)) reasons.push('variant_conflict');
  if (name) for (const pr of titleWordProblems(i.canonicalName, name)) if (!reasons.includes(pr)) reasons.push(pr);
  if (i.otherCompatibleCandidates > 0) reasons.push('ambiguous_candidates');
  if (i.skuOwnedElsewhere) reasons.push('sku_already_owned');
  const price = parseEuro(r?.price);
  if (r?.available === false || price === null) reasons.push('no_current_price');
  return { ok: reasons.length === 0, reasons, price, structuredPack: structured ? `${structured.amount}${structured.unit}` : null };
}
