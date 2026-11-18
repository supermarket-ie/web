import { classifyOfferGroup, comparisonLabel, type ComparisonType, type OfferIdentity, type PairReview } from './comparison-policy';

/**
 * Head-to-head store comparison under the shared comparison rule. Only products whose two offers are BOTH
 * labelled Exact match (approved pairwise review, no stated contradiction, in the context of every retailer's
 * offer on that product) count toward wins, totals, savings or category winners. Every other product sold at
 * both stores is listed with each retailer's own title and price and its label, and is never ranked.
 */
export type MatchupOffer = { price: number; title: string; label: string | null; status: ComparisonType };
export type MatchupProduct = { name: string; category: string; a: MatchupOffer; b: MatchupOffer };
export type MatchupResult = {
  verified: MatchupProduct[];
  unverified: MatchupProduct[];
  winsA: number; winsB: number; ties: number;
  totalA: number; totalB: number;
  /** Strictly cheaper store on the verified products, or null (none verified, or equal totals). */
  overallWinner: 'a' | 'b' | null;
  saving: number;
  categories: Array<{ category: string; totalA: number; totalB: number; count: number; winner: 'a' | 'b' | null }>;
  diffs: Array<MatchupProduct & { diff: number; cheaper: 'a' | 'b' }>;
};

export type MatchupPriceRow = { canonical_name: string; category: string; store: string; price: number; store_product_id?: string; store_product_name: string };

const cents = (n: number) => Math.round(n * 100);

export function buildMatchup(prices: MatchupPriceRow[], storeA: string, storeB: string, reviews: PairReview[], now = Date.now()): MatchupResult {
  const byProduct = new Map<string, { category: string; offers: Map<string, MatchupPriceRow> }>();
  for (const row of prices) {
    if (!Number.isFinite(row.price) || row.price <= 0) continue;
    const entry = byProduct.get(row.canonical_name) ?? { category: row.category, offers: new Map() };
    const existing = entry.offers.get(row.store);
    if (!existing || row.price < existing.price) entry.offers.set(row.store, row);
    byProduct.set(row.canonical_name, entry);
  }
  const verified: MatchupProduct[] = [], unverified: MatchupProduct[] = [];
  for (const [name, { category, offers }] of byProduct) {
    const a = offers.get(storeA), b = offers.get(storeB);
    if (!a || !b) continue;
    const group: OfferIdentity[] = [...offers.values()].map(o => ({ store: o.store, storeProductId: o.store_product_id, name: o.store_product_name, price: o.price }));
    const status = classifyOfferGroup(group, reviews, now);
    const offer = (row: MatchupPriceRow): MatchupOffer => ({ price: row.price, title: row.store_product_name,
      status: status[row.store] ?? 'unverified', label: comparisonLabel(status[row.store], group.length) });
    const product = { name, category, a: offer(a), b: offer(b) };
    (product.a.status === 'exact_product' && product.b.status === 'exact_product' ? verified : unverified).push(product);
  }
  let winsA = 0, winsB = 0, ties = 0, totalA = 0, totalB = 0;
  for (const p of verified) {
    totalA += cents(p.a.price); totalB += cents(p.b.price);
    if (cents(p.a.price) < cents(p.b.price)) winsA++; else if (cents(p.b.price) < cents(p.a.price)) winsB++; else ties++;
  }
  const categories = [...new Set(verified.map(p => p.category))].flatMap(category => {
    const items = verified.filter(p => p.category === category);
    if (items.length < 2) return [];
    const cA = items.reduce((s, p) => s + cents(p.a.price), 0), cB = items.reduce((s, p) => s + cents(p.b.price), 0);
    return [{ category, totalA: cA / 100, totalB: cB / 100, count: items.length, winner: cA < cB ? 'a' as const : cB < cA ? 'b' as const : null }];
  });
  const diffs = verified
    .map(p => ({ ...p, diff: Math.abs(cents(p.a.price) - cents(p.b.price)) / 100, cheaper: p.a.price < p.b.price ? 'a' as const : 'b' as const }))
    .filter(p => p.diff > 0.10).sort((x, y) => y.diff - x.diff).slice(0, 15);
  unverified.sort((x, y) => x.category.localeCompare(y.category) || x.name.localeCompare(y.name));
  return { verified, unverified, winsA, winsB, ties, totalA: totalA / 100, totalB: totalB / 100,
    overallWinner: !verified.length ? null : totalA < totalB ? 'a' : totalB < totalA ? 'b' : null,
    saving: Math.abs(totalA - totalB) / 100, categories, diffs };
}
