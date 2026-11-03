/**
 * Offer-to-offer comparison is a separate claim from a trusted exact price in
 * latest_prices. No canonical association, title similarity or AI confidence
 * can create a verified pairwise edge.
 */
import { hasProductIdentityConflict } from './shopping/product-identity';

export type ComparisonType = 'exact_product' | 'comparable_alternative' | 'not_comparable' | 'unverified';
export const COMPARISON_LABELS: Record<ComparisonType, string> = {
  exact_product: 'Exact product',
  comparable_alternative: 'Comparable alternative',
  not_comparable: 'Not comparable',
  unverified: 'Unverified comparison',
};

export type PairReview = {
  left_offer_id: string;
  right_offer_id: string;
  classification: ComparisonType;
  left_source_hash: string;
  right_source_hash: string;
  left_captured_at: string;
  right_captured_at: string;
  reviewed_at: string;
  rationale: string;
  reviewer: string;
};
export type OfferIdentity = { store: string; storeProductId?: string; name: string; price: number };
export type PackUnit = { total: number; unit: 'g' | 'ml' | 'each'; count: number; label: string };

const HASH = /^[a-f0-9]{64}$/;
const HORIZON_MS = 14 * 86400000;
export function pairKey(a: string, b: string) { return [a, b].sort().join(':'); }

export function validPairReview(row: PairReview, now = Date.now()): boolean {
  if (!row.left_offer_id || !row.right_offer_id || row.left_offer_id === row.right_offer_id ||
      !HASH.test(row.left_source_hash) || !HASH.test(row.right_source_hash) ||
      !row.reviewer?.trim() || !row.rationale?.trim() ||
      !['exact_product', 'comparable_alternative', 'not_comparable', 'unverified'].includes(row.classification)) return false;
  return [row.left_captured_at, row.right_captured_at, row.reviewed_at].every(value => {
    const at = Date.parse(value);
    return Number.isFinite(at) && at <= now && at >= now - HORIZON_MS;
  });
}

/** Conservative parser for clearly stated pack totals; never infers absent pack facts. */
export function readPack(name: string): PackUnit | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  const text = name.toLowerCase().replace(/,/g, '');
  const multi = text.match(/\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|litres?|l|ml)\b/i);
  const single = multi ? null : text.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|litres?|l|ml)\b/i);
  const countPack = text.match(/\b(\d+)\s*(?:pack|pk)\b|\bpack\s*of\s*(\d+)\b/i);
  const n = multi ? Number(multi[1]) : countPack ? Number(countPack[1] || countPack[2]) : 1;
  const quantity = multi ? Number(multi[2]) : single ? Number(single[1]) : null;
  const rawUnit = multi ? multi[3] : single ? single[2] : null;
  if (quantity !== null && rawUnit) {
    const unit = /^(?:kg)$/.test(rawUnit) ? 'g' : /^(?:l|litre|litres)$/.test(rawUnit) ? 'ml' : rawUnit as 'g' | 'ml';
    const factor = rawUnit === 'kg' || /^(?:l|litre|litres)$/.test(rawUnit) ? 1000 : 1;
    const total = quantity * n * factor;
    return Number.isFinite(total) && total > 0 ? { total, unit, count: n, label: multi?.[0] ?? single?.[0] ?? '' } : null;
  }
  return countPack && n > 0 ? { total: n, unit: 'each', count: n, label: countPack[0] } : null;
}

export function normalizedUnitPrice(name: string, price: number): { price: number; per: 'kg' | 'l' | 'each' } | null {
  const pack = readPack(name);
  if (!pack || !Number.isFinite(price) || price <= 0) return null;
  return { price: price * (pack.unit === 'each' ? 1 : 1000) / pack.total,
    per: pack.unit === 'g' ? 'kg' : pack.unit === 'ml' ? 'l' : 'each' };
}

export function differentPack(a: string, b: string): boolean {
  const x = readPack(a), y = readPack(b);
  return !x || !y || x.unit !== y.unit || x.total !== y.total || x.count !== y.count;
}

function variantWordsConflict(a: string, b: string): boolean {
  const terms = ['original','chocolate','strawberry','vanilla','lemon','lime','orange',
    'lavender','unscented','light cream','fresh cream','jumbo','large','medium'];
  const found = (name: string) => terms.filter(term => new RegExp('\\b' + term + '\\b','i').test(name));
  const left = found(a), right = found(b);
  return left.length > 0 && right.length > 0 && left.some(word => !right.includes(word));
}

export function classifyOfferGroup(offers: OfferIdentity[], reviews: PairReview[], now = Date.now()): Record<string, ComparisonType> {
  const result: Record<string, ComparisonType> = {};
  if (offers.length === 1) return { [offers[0].store]: 'exact_product' };
  for (const offer of offers) result[offer.store] = 'unverified';
  const latest = new Map<string, PairReview>();
  for (const review of reviews) {
    if (!validPairReview(review, now)) continue;
    const key = pairKey(review.left_offer_id, review.right_offer_id);
    const old = latest.get(key);
    if (!old || Date.parse(old.reviewed_at) < Date.parse(review.reviewed_at)) latest.set(key, review);
  }
  const pairs: ComparisonType[] = [];
  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      const a = offers[i], b = offers[j];
      if (!a.storeProductId || !b.storeProductId) return result;
      const reviewed = latest.get(pairKey(a.storeProductId, b.storeProductId))?.classification ?? 'unverified';
      const conflictingVariant = hasProductIdentityConflict(a.name, b.name);
      const strictExactConflict = reviewed === 'exact_product' &&
        (differentPack(a.name, b.name) || conflictingVariant ||
          variantWordsConflict(a.name, b.name));
      pairs.push(strictExactConflict ? 'not_comparable' : reviewed);
    }
  }
  if (pairs.includes('not_comparable')) {
    return Object.fromEntries(offers.map(offer => [offer.store, 'not_comparable']));
  }
  if (pairs.includes('unverified')) return result;
  const preferred = ['tesco', 'supervalu', 'dunnes'];
  const anchor = [...offers].sort((a, b) => preferred.indexOf(a.store) - preferred.indexOf(b.store))[0];
  for (const offer of offers) {
    if (offer === anchor) { result[offer.store] = 'exact_product'; continue; }
    result[offer.store] = latest.get(pairKey(anchor.storeProductId!, offer.storeProductId!))!.classification;
  }
  return result;
}

export function isVerifiedExactThree(offers: OfferIdentity[], reviews: PairReview[], now = Date.now()) {
  if (offers.length !== 3 || new Set(offers.map(o => o.store)).size !== 3) return false;
  const statuses = classifyOfferGroup(offers, reviews, now);
  return offers.every(o => statuses[o.store] === 'exact_product');
}
