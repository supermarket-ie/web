import { agentSupabase } from './supabase';
import {
  getCatalogueSeed,
  resolveCatalogueRows,
  type CataloguePriceRow,
} from '../../src/lib/shopping/catalogue-core';

export interface CatalogueCandidate {
  canonical_name: string;
  category: string | null;
  score: number;
  best_price: number | null;
  best_store: string | null;
  on_promotion: boolean;
  stores: Array<{
    store: string;
    price: number;
    was_price: number | null;
    on_promotion: boolean;
    store_product_name: string;
  }>;
}

function toLegacyCandidate(candidate: ReturnType<typeof resolveCatalogueRows>[number]): CatalogueCandidate {
  return {
    canonical_name: candidate.canonical_name,
    category: candidate.category,
    score: candidate.score,
    best_price: candidate.best_price,
    best_store: candidate.best_store,
    on_promotion: candidate.on_promotion,
    stores: candidate.offers.map(offer => ({
      store: offer.retailer,
      price: offer.price,
      was_price: offer.was_price ?? null,
      on_promotion: offer.on_promotion,
      store_product_name: offer.retailer_product_name,
    })),
  };
}

export async function resolveCatalogueProduct(query: string, limit = 5): Promise<CatalogueCandidate[]> {
  const seed = getCatalogueSeed(query);
  if (!seed) return [];

  const { data, error } = await agentSupabase
    .from('latest_prices')
    .select('canonical_name, category, store, store_product_name, price, was_price, on_promotion')
    .or(`canonical_name.ilike.%${seed}%,store_product_name.ilike.%${seed}%`)
    .limit(200);

  if (error) throw new Error(`Catalogue lookup failed: ${error.message}`);

  return resolveCatalogueRows(query, (data ?? []) as CataloguePriceRow[], limit)
    .map(toLegacyCandidate);
}

export async function getCurrentProductSnapshot(canonicalName: string) {
  const { data, error } = await agentSupabase
    .from('latest_prices')
    .select('canonical_name, category, store, store_product_name, price, was_price, on_promotion')
    .eq('canonical_name', canonicalName);

  if (error) throw new Error(`Current price lookup failed: ${error.message}`);

  const rows = (data ?? []) as CataloguePriceRow[];
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => Number(a.price) - Number(b.price));
  return {
    canonical_name: canonicalName,
    best_price: Number(sorted[0].price),
    best_store: sorted[0].store,
    any_promotion: rows.some(row => row.on_promotion === true),
    stores: sorted.map(row => ({
      store: row.store,
      price: Number(row.price),
      was_price: row.was_price == null ? null : Number(row.was_price),
      on_promotion: row.on_promotion === true,
      store_product_name: row.store_product_name,
    })),
    captured_at: new Date().toISOString(),
  };
}
