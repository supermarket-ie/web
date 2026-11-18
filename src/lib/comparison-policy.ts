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
/**
 * The customer label for one offer. A product sold by only ONE retailer is not compared with anything, so it
 * gets no label: classifyOfferGroup treats a lone offer as trivially exact for basket maths, and showing that
 * as "Exact match" would imply a cross-store verification that never happened.
 */
export function comparisonLabel(type: ComparisonType | null | undefined, offerCount: number): string | null {
  return offerCount >= 2 ? COMPARISON_LABELS[type ?? 'unverified'] : null;
}
const RETAILER_NAMES: Record<string, string> = { tesco: 'Tesco', dunnes: 'Dunnes Stores', supervalu: 'SuperValu', aldi: 'Aldi', lidl: 'Lidl' };
export const retailerDisplayName = (store: string) => RETAILER_NAMES[String(store).toLowerCase()] ?? store;
const listNames = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/**
 * The ONE wording for a verified basket claim. It always names the stores it covers, and names any other
 * complete store as indicative, so a claim between Tesco and SuperValu is never read as "cheapest of all".
 */
export function verifiedClaimText(verified: Array<{ store: string; total: number }>, indicativeStores: string[] = []): string {
  const cents = (n: number) => Math.round(n * 100);
  const min = Math.min(...verified.map(v => cents(v.total)));
  const lowest = verified.filter(v => cents(v.total) === min).map(v => retailerDisplayName(v.store));
  const all = verified.map(v => retailerDisplayName(v.store));
  const others = verified.filter(v => cents(v.total) !== min).map(v => retailerDisplayName(v.store));
  // Equal totals are never described as one store being cheaper.
  const head = lowest.length === all.length
    ? `${listNames(all)} cost the same for this basket (verified exact matches).`
    : lowest.length > 1
      ? `${listNames(lowest)} are jointly cheapest of ${listNames(all)} for this basket (verified exact matches).`
      : all.length === 2
        ? `${lowest[0]} is cheaper than ${others[0]} for this basket (verified exact matches).`
        : `${lowest[0]} is the cheapest of ${listNames(all)} for this basket (verified exact matches).`;
  const tail = indicativeStores.length
    ? ` ${listNames(indicativeStores.map(retailerDisplayName))}: indicative total only, not verified as the same products.` : '';
  return head + tail;
}
/** Short customer explanation shown beside a total or ranking. */
export const COMPARISON_EXPLANATIONS = {
  verified: 'Every item is an independently verified exact match at the stores named.',
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
  /** Set only when at least two stores have complete, verified exact baskets; cheapest AMONG verifiedStores. */
  cheapestVerified: { store: string; total: number } | null;
  /** The stores the verified claim covers (>= 2), or []. A claim is always scoped to these stores. */
  verifiedStores: string[];
  /** True when two or more verified stores share the lowest total: no single store may be called cheapest. */
  cheapestTied: boolean;
  /** Complete baskets outside the verified claim: shown as indicative totals only. */
  indicativeCompleteStores: string[];
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
  const complete = baskets.filter(b => b.completeTotal !== null);
  // Verified SUBSET: complete stores whose every line is labelled Exact match. Per line, every Exact-labelled
  // offer belongs to one pairwise-exact set, so any two such stores are approved exact matches on every line.
  // Other complete stores stay indicative and never block or create the claim.
  const exactEverywhere = complete.filter(b => b.lines.every(l => l.status === 'exact_product'));
  // Re-assert pairwise exactness explicitly (defence in depth; never relies on the labelling alone).
  const sound = exactEverywhere.length >= 2 && lines.every(line => {
    const subset = line.offers.filter(o => exactEverywhere.some(b => b.store === o.store));
    return subset.length === exactEverywhere.length && allPairsExact(subset, reviews, now);
  });
  if (sound) for (const b of exactEverywhere) b.verifiedExactTotal = b.completeTotal;
  const verified = baskets.filter(b => b.verifiedExactTotal !== null);
  const cheapest = verified.length >= 2 ? [...verified].sort((a, b) => a.verifiedExactTotal! - b.verifiedExactTotal! || a.store.localeCompare(b.store))[0] : null;
  const ordered = [...baskets].sort((a, b) => (verified.length >= 2 && a.verifiedExactTotal !== null && b.verifiedExactTotal !== null
    ? a.verifiedExactTotal - b.verifiedExactTotal
    : Number(b.verifiedExactTotal !== null) - Number(a.verifiedExactTotal !== null) || b.comparableLines - a.comparableLines) || a.store.localeCompare(b.store));
  return { basis: cheapest ? 'verified_exact' : complete.length >= 2 ? 'indicative' : 'incomplete', stores: ordered,
    cheapestVerified: cheapest ? { store: cheapest.store, total: cheapest.verifiedExactTotal! } : null,
    verifiedStores: cheapest ? verified.map(b => b.store) : [],
    cheapestTied: !!cheapest && verified.filter(b => cents(b.verifiedExactTotal!) === cents(cheapest.verifiedExactTotal!)).length > 1,
    indicativeCompleteStores: complete.filter(b => !cheapest || b.verifiedExactTotal === null).map(b => b.store) };
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
  // Symmetric by construction: a difference found in either direction is a difference (the identity and
  // variant checks compare one title's words against the other's, so they are not symmetric on their own).
  return statedDifference(a, b) ?? statedDifference(b, a);
}
function statedDifference(a: string, b: string): string | null {
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
  if (offers.length === 1) return { [offers[0].store]: 'exact_product' };
  const latest = new Map<string, PairReview>();
  for (const review of reviews) {
    if (!validPairReview(review, now)) continue;
    const key = pairKey(review.left_offer_id, review.right_offer_id);
    const old = latest.get(key);
    if (!old || Date.parse(old.reviewed_at) < Date.parse(review.reviewed_at)) latest.set(key, review);
  }
  // Pairwise relation. An approved exact review is vetoed only by a STATED contradiction (differing
  // unambiguous packs, a variant conflict or own-label); an absent or ambiguous pack never overrides it.
  // 'vetoed' = an approved exact review contradicted by stated facts: the review itself is wrong, so every
  // approval connected to either offer is suspended (see below), not only this pair.
  type Rel = 'exact' | 'similar' | 'different' | 'vetoed' | 'unknown';
  const relation = (a: OfferIdentity, b: OfferIdentity): Rel => {
    const stated = deterministicDifference(a.name, b.name) !== null;
    const reviewed = a.storeProductId && b.storeProductId ? latest.get(pairKey(a.storeProductId, b.storeProductId))?.classification : undefined;
    if (reviewed === 'exact_product') return stated ? 'vetoed' : 'exact';
    if (reviewed === 'comparable_alternative') return 'similar';
    if (reviewed === 'not_comparable') return 'different';
    return stated ? 'different' : 'unknown';
  };
  const n = offers.length;
  const rel: Rel[][] = offers.map((a, i) => offers.map((b, j) => (i === j ? 'exact' : relation(a, b))));
  // Contradictory evidence: offers joined by exact edges but with a "different" pair among them (A = B, B = C,
  // A != C). Nothing in that component is trusted, and all of it is a different product.
  const parent = offers.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rel[i][j] === 'exact') parent[find(i)] = find(j);
  const contradicted = new Set<number>();
  const taint = (i: number) => { for (let k = 0; k < n; k++) if (find(k) === find(i)) contradicted.add(k); };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (rel[i][j] === 'vetoed') { taint(i); taint(j); }
    else if (find(i) === find(j) && rel[i][j] === 'different') taint(i);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (rel[i][j] === 'vetoed') rel[i][j] = 'different';
  // The largest set of uncontradicted offers that are PAIRWISE approved exact matches (>= 2). Ties keep the
  // preferred retailers (Tesco, SuperValu, Dunnes). Other retailers' offers never block it: they are labelled
  // by their own relation to that set.
  const preferred = ['tesco', 'supervalu', 'dunnes'];
  const rank = (i: number) => { const r = preferred.indexOf(offers[i].store); return r === -1 ? preferred.length : r; };
  const order = offers.map((_, i) => i).filter(i => !contradicted.has(i)).sort((a, b) => rank(a) - rank(b) || offers[a].store.localeCompare(offers[b].store));
  let clique: number[] = [];
  // One offer per retailer in a group (a handful), so subset enumeration is cheap.
  for (let mask = 1; mask < 1 << order.length; mask++) {
    const set = order.filter((_, k) => mask & (1 << k));
    if (set.length < 2 || set.length <= clique.length) continue;
    if (set.every((a, x) => set.slice(x + 1).every(b => rel[a][b] === 'exact'))) clique = set;
  }
  const result: Record<string, ComparisonType> = {};
  offers.forEach((offer, i) => {
    const others = offers.map((_, j) => j).filter(j => j !== i);
    if (contradicted.has(i)) result[offer.store] = 'not_comparable';
    else if (clique.includes(i)) result[offer.store] = 'exact_product';
    else if (clique.length) {
      const toSet = clique.map(j => rel[i][j]);
      result[offer.store] = toSet.includes('different') ? 'not_comparable' : toSet.includes('similar') ? 'comparable_alternative' : 'unverified';
    } else {
      // No verified set: an offer stated or reviewed as different from EVERY other offer is a different product;
      // one reviewed as Similar to another is a Similar product; everything else stays Unverified (never promoted).
      const rs = others.map(j => rel[i][j]);
      result[offer.store] = rs.every(r => r === 'different') ? 'not_comparable' : rs.includes('similar') ? 'comparable_alternative' : 'unverified';
    }
  });
  return result;
}

/**
 * EVERY pair of offers is an approved, unvetoed exact match. Exactness is not transitive through an anchor:
 * Tesco = SuperValu and Tesco = Dunnes does not make SuperValu = Dunnes when that pair is only Similar.
 */
export function allPairsExact(offers: OfferIdentity[], reviews: PairReview[], now = Date.now()): boolean {
  if (offers.length < 2) return offers.length === 1;
  for (let i = 0; i < offers.length; i++) for (let j = i + 1; j < offers.length; j++) {
    const s = classifyOfferGroup([offers[i], offers[j]], reviews, now);
    if (s[offers[i].store] !== 'exact_product' || s[offers[j].store] !== 'exact_product') return false;
  }
  return true;
}

export function isVerifiedExactThree(offers: OfferIdentity[], reviews: PairReview[], now = Date.now()) {
  if (offers.length !== 3 || new Set(offers.map(o => o.store)).size !== 3) return false;
  return allPairsExact(offers, reviews, now);
}
