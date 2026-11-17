/**
 * Offer-to-offer comparison is a separate claim from a trusted exact price in
 * latest_prices. No canonical association, title similarity or AI confidence
 * can create a verified pairwise edge.
 */
import { hasProductIdentityConflict } from './shopping/product-identity';

export type ComparisonType = 'exact_product' | 'comparable_alternative' | 'not_comparable' | 'unverified';
export const COMPARISON_LABELS: Record<ComparisonType, string> = {
  exact_product: 'Exact match',
  comparable_alternative: 'Similar product',
  not_comparable: 'Different product or pack',
  unverified: 'Unverified',
};
/** Short customer explanation shown beside a total or ranking. */
export const COMPARISON_EXPLANATIONS = {
  verified: 'Every item is an independently verified exact match at each store compared.',
  indicative: 'Indicative only: these stores’ products have not all been verified as the same item, so this is not a like-for-like comparison.',
  incomplete: 'Not every item is available at each store, so store totals are not comparable.',
} as const;

export type BasketLine = { id: string; quantity: number; offers: OfferIdentity[] };
export type StoreBasketLine = { id: string; status: ComparisonType | 'missing'; name: string | null; price: number | null;
  unitPrice: { price: number; per: 'kg' | 'l' | 'each' } | null };
export type StoreBasket = {
  store: string;
  totalLines: number;
  /** Lines with an offer at this store that is not a different product. */
  comparableLines: number;
  missingLines: number;
  differentProductLines: number;
  unverifiedLines: number;
  similarLines: number;
  /** Indicative sum of this store's comparable offers (partial or complete). Never a ranking basis. */
  subtotal: number | null;
  /** Indicative total, only when every line has a comparable offer here. */
  completeTotal: number | null;
  /** Only when complete AND every line is an independently verified exact match across the compared stores. */
  verifiedExactTotal: number | null;
  lines: StoreBasketLine[];
};
export type BasketComparison = {
  basis: 'verified_exact' | 'indicative' | 'incomplete';
  stores: StoreBasket[];
  /** Set only when at least two stores have complete, verified exact baskets. */
  cheapestVerified: { store: string; total: number } | null;
};

const cents = (n: number) => Math.round(n * 100);
/**
 * The single rule for cross-store basket claims. Uses classifyOfferGroup per line (pair-review ledger +
 * deterministic differences). A "cheapest" claim exists only between >= 2 stores whose baskets are
 * complete and whose every line is an approved exact match among those stores. Otherwise stores are
 * returned in a neutral order (coverage, then name), never ranked by price.
 */
export function compareBasket(lines: BasketLine[], stores: string[], reviews: PairReview[], now = Date.now()): BasketComparison {
  const status = new Map(lines.map(l => [l.id, classifyOfferGroup(l.offers, reviews, now)]));
  const build = (store: string): StoreBasket => {
    let sub = 0, any = false;
    const out: StoreBasketLine[] = lines.map(line => {
      const offer = line.offers.find(o => o.store === store);
      if (!offer) return { id: line.id, status: 'missing', name: null, price: null, unitPrice: null };
      const s = status.get(line.id)![store] ?? 'unverified';
      if (s !== 'not_comparable') { sub += cents(offer.price) * line.quantity; any = true; }
      return { id: line.id, status: s, name: offer.name, price: offer.price, unitPrice: normalizedUnitPrice(offer.name, offer.price) };
    });
    const count = (s: StoreBasketLine['status']) => out.filter(l => l.status === s).length;
    const comparable = out.filter(l => l.status !== 'missing' && l.status !== 'not_comparable').length;
    const complete = lines.length > 0 && comparable === lines.length;
    return { store, totalLines: lines.length, comparableLines: comparable, missingLines: count('missing'),
      differentProductLines: count('not_comparable'), unverifiedLines: count('unverified'), similarLines: count('comparable_alternative'),
      subtotal: any ? sub / 100 : null, completeTotal: complete ? sub / 100 : null, verifiedExactTotal: null, lines: out };
  };
  const baskets = stores.map(build);
  // Re-check equivalence ONLY among the complete stores, so an unrelated store's offer cannot block or create a claim.
  const complete = baskets.filter(b => b.completeTotal !== null);
  if (complete.length >= 2) {
    const names = new Set(complete.map(b => b.store));
    const allExact = lines.every(line => {
      const subset = line.offers.filter(o => names.has(o.store));
      const s = classifyOfferGroup(subset, reviews, now);
      return subset.length === names.size && subset.every(o => s[o.store] === 'exact_product');
    });
    if (allExact) for (const b of complete) b.verifiedExactTotal = b.completeTotal;
  }
  const verified = baskets.filter(b => b.verifiedExactTotal !== null);
  const cheapest = verified.length >= 2 ? [...verified].sort((a, b) => a.verifiedExactTotal! - b.verifiedExactTotal! || a.store.localeCompare(b.store))[0] : null;
  const ordered = [...baskets].sort((a, b) => (verified.length >= 2 && a.verifiedExactTotal !== null && b.verifiedExactTotal !== null
    ? a.verifiedExactTotal - b.verifiedExactTotal
    : Number(b.verifiedExactTotal !== null) - Number(a.verifiedExactTotal !== null) || b.comparableLines - a.comparableLines) || a.store.localeCompare(b.store));
  return { basis: cheapest ? 'verified_exact' : complete.length >= 2 ? 'indicative' : 'incomplete', stores: ordered,
    cheapestVerified: cheapest ? { store: cheapest.store, total: cheapest.verifiedExactTotal! } : null };
}

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
  // Explicit multipacks in either order: "4 x 125g" or "125g x 4". Both are labelled with an "x".
  const lead = text.match(/\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|litres?|l|ml)\b/i);
  const trail = lead ? null : text.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|litres?|l|ml)\s*[x×]\s*(\d+)\b/i);
  const multi = lead ? { count: lead[1], qty: lead[2], unit: lead[3], label: lead[0] }
    : trail ? { count: trail[3], qty: trail[1], unit: trail[2], label: trail[0] } : null;
  const single = multi ? null : text.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|litres?|l|ml)\b/i);
  const countPack = text.match(/\b(\d+)\s*(?:pack|pk)\b|\bpack\s*of\s*(\d+)\b/i);
  const n = multi ? Number(multi.count) : countPack ? Number(countPack[1] || countPack[2]) : 1;
  const quantity = multi ? Number(multi.qty) : single ? Number(single[1]) : null;
  const rawUnit = multi ? multi.unit : single ? single[2] : null;
  if (quantity !== null && rawUnit) {
    const unit = /^(?:kg)$/.test(rawUnit) ? 'g' : /^(?:l|litre|litres)$/.test(rawUnit) ? 'ml' : rawUnit as 'g' | 'ml';
    const factor = rawUnit === 'kg' || /^(?:l|litre|litres)$/.test(rawUnit) ? 1000 : 1;
    const total = quantity * n * factor;
    return Number.isFinite(total) && total > 0 ? { total, unit, count: n, label: multi?.label ?? single?.[0] ?? '' } : null;
  }
  return countPack && n > 0 ? { total: n, unit: 'each', count: n, label: countPack[0] } : null;
}

/** A pack total that can be trusted: one measured unit, an explicit "N x M" multipack, or a plain count. */
export function unambiguousPack(p: PackUnit) { return p.unit === 'each' || p.count === 1 || /[x×]/i.test(p.label); }

export function normalizedUnitPrice(name: string, price: number): { price: number; per: 'kg' | 'l' | 'each' } | null {
  const pack = readPack(name);
  // "8 Pack 454g" does not say whether 454g is per item or the total, so no unit price is shown.
  if (!pack || !unambiguousPack(pack) || !Number.isFinite(price) || price <= 0) return null;
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

// Own-label ranges of the retailers compared (Dunnes Stores, SuperValu, Tesco). Brand words shared with
// manufacturers ("Deluxe" etc.) are deliberately excluded; a miss only leaves a pair Unverified.
const OWN_LABEL = /^\s*(?:dunnes(?:\s+stores)?|supervalu|tesco|simply\s+better|signature\s+tastes)\b/i;
/** A retailer own-label title. Own-label products of different retailers are never the same commercial product. */
export function isOwnLabel(name: string) { return OWN_LABEL.test(name ?? ''); }

/**
 * Deterministic evidence that two retailer offers are DIFFERENT products. Only facts stated in both
 * titles count: two readable packs that differ, an identity/variant contradiction, or own-label on
 * either side. Absence of a fact is never a contradiction, and this can never establish equivalence.
 */
export function deterministicDifference(a: string, b: string): string | null {
  const x = readPack(a), y = readPack(b);
  // Only unambiguous packs: one measured unit, or an explicit "N x M" multipack. "6 Pack (270 g)" is
  // ambiguous (per item or total?) and can never prove a difference.
  // A multipack and a single pack of equal weight are different retail packs (2 x 150g is not one 300g pack).
  const measured = (p: PackUnit) => p.unit !== 'each' && unambiguousPack(p);
  if (x && y && measured(x) && measured(y) && (x.unit !== y.unit || x.total !== y.total || x.count !== y.count)) return 'different_pack';
  if (isOwnLabel(a) || isOwnLabel(b)) return 'own_label';
  if (hasProductIdentityConflict(a, b) || variantWordsConflict(a, b)) return 'different_variant';
  return null;
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
  // Unreviewed pairs with deterministic evidence of a DIFFERENT product (stated pack, variant, own-label).
  const differences = new Map<string, number>();
  const markDifferent = (a: OfferIdentity, b: OfferIdentity) => {
    if (!deterministicDifference(a.name, b.name)) return;
    differences.set(a.store, (differences.get(a.store) ?? 0) + 1);
    differences.set(b.store, (differences.get(b.store) ?? 0) + 1);
  };
  let missingIds = false;
  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      const a = offers[i], b = offers[j];
      if (!a.storeProductId || !b.storeProductId) { missingIds = true; markDifferent(a, b); pairs.push('unverified'); continue; }
      const reviewed = latest.get(pairKey(a.storeProductId, b.storeProductId))?.classification ?? 'unverified';
      // An approved exact review is vetoed only by a STATED contradiction (differing unambiguous packs, a
      // variant conflict or own-label). An absent or ambiguous pack in a title does not override a review.
      const strictExactConflict = reviewed === 'exact_product' && deterministicDifference(a.name, b.name) !== null;
      if (reviewed === 'unverified') markDifferent(a, b);
      pairs.push(strictExactConflict ? 'not_comparable' : reviewed);
    }
  }
  if (!missingIds && pairs.includes('not_comparable')) {
    return Object.fromEntries(offers.map(offer => [offer.store, 'not_comparable']));
  }
  if (missingIds || pairs.includes('unverified')) {
    // An offer that is deterministically different from EVERY other offer is a different product;
    // the rest stay unverified (never promoted). Two offers that differ are both different products.
    for (const offer of offers) if ((differences.get(offer.store) ?? 0) === offers.length - 1) result[offer.store] = 'not_comparable';
    return result;
  }
  const preferred = ['tesco', 'supervalu', 'dunnes'];
  const anchor = [...offers].sort((a, b) => preferred.indexOf(a.store) - preferred.indexOf(b.store))[0];
  for (const offer of offers) {
    if (offer === anchor) continue;
    result[offer.store] = latest.get(pairKey(anchor.storeProductId!, offer.storeProductId!))!.classification;
  }
  // A Tesco offer whose only counterparts are Similar products is itself shown as Similar, not Exact.
  if (!anchor) return result;
  const others = offers.filter(o => o !== anchor).map(o => result[o.store]);
  // Exact only if at least one counterpart is exact to it; Similar stays beside the retailer that differs.
  result[anchor.store] = others.some(s => s === 'exact_product') ? 'exact_product' : 'comparable_alternative';
  return result;
}

export function isVerifiedExactThree(offers: OfferIdentity[], reviews: PairReview[], now = Date.now()) {
  if (offers.length !== 3 || new Set(offers.map(o => o.store)).size !== 3) return false;
  const statuses = classifyOfferGroup(offers, reviews, now);
  return offers.every(o => statuses[o.store] === 'exact_product');
}
