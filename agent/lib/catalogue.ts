import { agentSupabase } from './supabase';
import { withSupabaseRetry } from '../../src/lib/supabase-resilience';
import {
  getCatalogueSeed,
  resolveCatalogueRows,
  type CataloguePriceRow,
} from '../../src/lib/shopping/catalogue-core';
import { classifyOfferGroup, COMPARISON_LABELS } from '../../src/lib/comparison-policy';

export interface CatalogueCandidate {
  canonical_product_id: string | null;
  canonical_name: string;
  category: string | null;
  score: number;
  /** Lowest current price across stores. NOT a claim that the stores sell the same product (see best_price_basis). */
  best_price: number | null;
  best_store: string | null;
  best_price_basis: 'lowest_current_price_across_stores_not_verified_same_product';
  on_promotion: boolean;
  stores: Array<{
    store: string;
    price: number;
    was_price: number | null;
    on_promotion: boolean;
    store_product_name: string;
    /** Exact match / Similar product / Unverified / Different product, or single_store. */
    comparison: string;
  }>;
}

/** Cross-store label per offer: never 'exact' without an independently reviewed pair edge. */
function offerComparison(offers: Array<{ store: string; name: string; price: number }>) {
  const status = classifyOfferGroup(offers.map(o => ({ store: o.store, name: o.name, price: o.price })), []);
  return (store: string) => offers.length < 2 ? 'single_store' : COMPARISON_LABELS[status[store] ?? 'unverified'];
}
const BEST_PRICE_BASIS = 'lowest_current_price_across_stores_not_verified_same_product' as const;

function toLegacyCandidate(candidate: ReturnType<typeof resolveCatalogueRows>[number]): CatalogueCandidate {
  const label = offerComparison(candidate.offers.map(o => ({ store: o.retailer, name: o.retailer_product_name, price: o.price })));
  return {
    canonical_product_id: candidate.canonical_product_id ?? null,
    canonical_name: candidate.canonical_name,
    category: candidate.category,
    score: candidate.score,
    best_price: candidate.best_price,
    best_store: candidate.best_store,
    best_price_basis: BEST_PRICE_BASIS,
    on_promotion: candidate.on_promotion,
    stores: candidate.offers.map(offer => ({
      store: offer.retailer,
      price: offer.price,
      was_price: offer.was_price ?? null,
      on_promotion: offer.on_promotion,
      store_product_name: offer.retailer_product_name,
      comparison: label(offer.retailer),
    })),
  };
}

export async function resolveCatalogueProduct(query: string, limit = 5): Promise<CatalogueCandidate[]> {
  const seed = getCatalogueSeed(query);
  if (!seed) return [];

  const { data, error } = await withSupabaseRetry(
    'latest_prices.catalogue_resolve',
    () => agentSupabase
      .from('latest_prices')
      .select('canonical_product_id, canonical_name, category, store, store_product_name, price, was_price, on_promotion')
      .or(`canonical_name.ilike.%${seed}%,store_product_name.ilike.%${seed}%`)
      // Broad staples such as milk, bread and butter also occur in hundreds of
      // unrelated or specialist product names. Fetch the complete practical
      // result set so the shared resolver ranks the catalogue rather than an
      // arbitrary first PostgREST page.
      .limit(1000),
  );

  if (error) throw new Error(`Catalogue lookup failed: ${error.message}`);

  return resolveCatalogueRows(query, (data ?? []) as CataloguePriceRow[], limit)
    .map(toLegacyCandidate);
}

export async function getCurrentProductSnapshot(canonicalName: string) {
  const { data, error } = await withSupabaseRetry(
    'latest_prices.product_snapshot',
    () => agentSupabase
      .from('latest_prices')
      .select('canonical_product_id, canonical_name, category, store, store_product_name, price, was_price, on_promotion')
      .eq('canonical_name', canonicalName),
  );

  if (error) throw new Error(`Current price lookup failed: ${error.message}`);

  const rows = (data ?? []) as CataloguePriceRow[];
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => Number(a.price) - Number(b.price));
  const label = offerComparison(sorted.map(r => ({ store: r.store, name: r.store_product_name, price: Number(r.price) })));
  return {
    canonical_name: canonicalName,
    best_price: Number(sorted[0].price),
    best_store: sorted[0].store,
    best_price_basis: BEST_PRICE_BASIS,
    any_promotion: rows.some(row => row.on_promotion === true),
    stores: sorted.map(row => ({
      store: row.store,
      price: Number(row.price),
      was_price: row.was_price == null ? null : Number(row.was_price),
      on_promotion: row.on_promotion === true,
      store_product_name: row.store_product_name,
      comparison: label(row.store),
    })),
    captured_at: new Date().toISOString(),
  };
}
