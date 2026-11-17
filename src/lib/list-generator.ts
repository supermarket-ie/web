import { supabaseAdmin } from './supabase';
import { withSupabaseRetry } from './supabase-resilience';
import { NUTRITION, type NutritionData } from './nutrition-data';
import { classifyOfferGroup, compareBasket, normalizedUnitPrice, type BasketLine, type ComparisonType, type PairReview } from './comparison-policy';
import { getCurrentPairReviews } from './comparison-reviews';

export type FamilySize = '1' | '2' | '3-4' | '5+';

export interface StorePrice {
  store: string;
  price: number;
  store_product_name: string;
  store_url: string | null;
  comparison?: ComparisonType;
  unit_price?: { price: number; per: 'kg' | 'l' | 'each' } | null;
}

export interface ListItem {
  product_id: string;
  canonical_name: string;
  category: string | null;
  quantity: number;
  best_store: string;
  best_price: number;
  best_price_total: number;
  best_store_product_name: string;
  best_store_url: string | null;
  all_prices: StorePrice[];
  nutrition: NutritionData | null;
  store_overridden?: boolean;
  /** Whether best_price is for the same product as the other stores' prices. Absent on legacy lists = indicative. */
  price_comparison?: 'verified_exact' | 'indicative' | 'different_products' | 'single_store';
}

export interface SmartList {
  family_size: FamilySize;
  /** Cheapest verified exact basket, or '' when no such claim is supported. */
  recommended_store: string;
  /** Complete baskets of verified exact matches only (>= 2 stores), else empty. */
  store_totals: { store: string; total: number; item_count?: number; basis?: 'verified_exact' }[];
  comparison_basis?: 'verified_exact' | 'indicative' | 'incomplete';
  items: ListItem[];
  generated_at: string;
}

export interface ListCustomisations {
  removedItems?: string[];
  addedItems?: string[];
  storeOverrides?: Record<string, string>;
}

function getMultiplier(familySize: FamilySize): number {
  switch (familySize) {
    case '1': return 1;
    case '2': return 1;
    case '3-4': return 1.5;
    case '5+': return 2;
  }
}

export async function generateList(
  familySize: FamilySize,
  customisations?: ListCustomisations
): Promise<SmartList> {
  const multiplier = getMultiplier(familySize);
  const quantity = Math.ceil(multiplier);

  const removedSet = new Set(customisations?.removedItems ?? []);
  const addedSet = new Set(customisations?.addedItems ?? []);
  const overrides = customisations?.storeOverrides ?? {};

  // `latest_prices` is the fail-closed trusted-offer boundary. Never rebuild
  // current offers from raw observations here: that would admit stale prices,
  // unresolved identity and observations without trusted provenance.
  const [{ data: trustedOffers, error: offerError }, reviews] = await Promise.all([
    withSupabaseRetry(
      'latest_prices.generate_list',
      () => supabaseAdmin
        .from('latest_prices')
        .select('canonical_product_id, canonical_name, category, store, store_product_id, store_product_name, store_url, price'),
    ),
    getCurrentPairReviews(),
  ]);

  if (offerError) throw offerError;
  return buildSmartList((trustedOffers ?? []) as TrustedListOffer[], reviews, familySize, customisations, quantity, removedSet, addedSet, overrides);
}

export type TrustedListOffer = { canonical_product_id: string; canonical_name: string; category: string | null; store: string;
  store_product_id?: string | null; store_product_name: string; store_url: string | null; price: number };

/** Pure: builds the list from trusted offers. Cross-store totals and "recommended store" follow compareBasket. */
export function buildSmartList(
  trustedOffers: TrustedListOffer[], reviews: PairReview[], familySize: FamilySize, customisations: ListCustomisations | undefined,
  quantity = Math.ceil(getMultiplier(familySize)), removedSet = new Set(customisations?.removedItems ?? []),
  addedSet = new Set(customisations?.addedItems ?? []), overrides = customisations?.storeOverrides ?? {}, now = Date.now(),
): SmartList {
  type PriceInfo = { price: number; store_product_name: string; store_url: string | null; store_product_id?: string | null };
  type ProductEntry = { canonical_name: string; category: string | null; stores: Map<string, PriceInfo> };

  const byProduct = new Map<string, ProductEntry>();

  for (const offer of trustedOffers) {
    const productId = String(offer.canonical_product_id);
    const price = Number(offer.price);
    if (!productId || !Number.isFinite(price) || price <= 0) continue;

    if (!byProduct.has(productId)) {
      byProduct.set(productId, {
        canonical_name: offer.canonical_name,
        category: offer.category,
        stores: new Map()
      });
    }

    byProduct.get(productId)!.stores.set(offer.store, {
      price,
      store_product_name: offer.store_product_name,
      store_url: offer.store_url,
      store_product_id: offer.store_product_id,
    });
  }

  const items: ListItem[] = [];
  const basketLines: BasketLine[] = [];

  for (const [productId, { canonical_name, category, stores }] of byProduct) {
    if (stores.size < 2 && !addedSet.has(productId)) continue;
    if (removedSet.has(productId)) continue;

    const overrideStore = overrides[productId];
    let bestStore = '';
    let bestPrice = Infinity;

    if (overrideStore && stores.has(overrideStore)) {
      bestStore = overrideStore;
      bestPrice = stores.get(overrideStore)!.price;
    } else {
      for (const [store, { price }] of stores) {
        if (price < bestPrice) {
          bestPrice = price;
          bestStore = store;
        }
      }
    }

    const offers = Array.from(stores.entries()).map(([store, info]) => ({ store, storeProductId: info.store_product_id ?? undefined,
      name: info.store_product_name, price: info.price }));
    basketLines.push({ id: productId, quantity, offers });
    const status = classifyOfferGroup(offers, reviews, now);
    const statuses = Object.values(status);
    const priceComparison: ListItem['price_comparison'] = stores.size < 2 ? 'single_store'
      : statuses.every(s => s === 'exact_product') ? 'verified_exact'
      : statuses.some(s => s === 'not_comparable') ? 'different_products' : 'indicative';

    const allPrices: StorePrice[] = Array.from(stores.entries())
      .map(([store, info]) => ({
        store,
        price: info.price,
        store_product_name: info.store_product_name,
        store_url: info.store_url,
        comparison: status[store] ?? 'unverified',
        unit_price: normalizedUnitPrice(info.store_product_name, info.price),
      }))
      .sort((a, b) => a.price - b.price);

    const best = stores.get(bestStore)!;
    const cheapestPrice = allPrices[0]?.price ?? bestPrice;

    items.push({
      product_id: productId,
      canonical_name,
      category,
      quantity,
      best_store: bestStore,
      best_price: bestPrice,
      best_price_total: Math.round(bestPrice * quantity * 100) / 100,
      best_store_product_name: best.store_product_name,
      best_store_url: best.store_url,
      all_prices: allPrices,
      nutrition: NUTRITION[canonical_name] ?? null,
      store_overridden: !!overrideStore && bestPrice > cheapestPrice,
      price_comparison: priceComparison,
    });
  }

  items.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));

  // Store totals exist ONLY as complete baskets of independently verified exact matches (>= 2 stores).
  // Summing whatever each store happens to stock would rank unequal, unverified baskets.
  const comparison = compareBasket(basketLines, [...new Set(basketLines.flatMap(l => l.offers.map(o => o.store)))], reviews, now);
  const verifiedTotals = comparison.cheapestVerified
    ? comparison.stores.filter(s => s.verifiedExactTotal !== null)
      .map(s => ({ store: s.store, total: Math.round(s.verifiedExactTotal! * 100) / 100, item_count: s.totalLines, basis: 'verified_exact' as const }))
      .sort((a, b) => a.total - b.total)
    : [];

  return {
    family_size: familySize,
    recommended_store: comparison.cheapestVerified?.store ?? '',
    store_totals: verifiedTotals,
    comparison_basis: comparison.basis,
    items,
    generated_at: new Date().toISOString()
  };
}

export async function getAllProducts(): Promise<{ product_id: string; canonical_name: string; category: string | null }[]> {
  const { data, error } = await supabaseAdmin
    .from('store_products')
    .select('product_id, products(id, canonical_name, category)')
    .eq('url_status', 'resolved');

  if (error || !data) return [];

  const seen = new Set<string>();
  const result: { product_id: string; canonical_name: string; category: string | null }[] = [];
  for (const row of data) {
    const p = (Array.isArray(row.products) ? row.products[0] : row.products) as { id: string; canonical_name: string; category: string | null } | null;
    if (!p || seen.has(row.product_id)) continue;
    seen.add(row.product_id);
    result.push({ product_id: row.product_id, canonical_name: p.canonical_name, category: p.category });
  }
  return result.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
}
