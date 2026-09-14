import { agentSupabase } from './supabase';
import { OptimisticConcurrencyError } from './optimistic-retry';
import { computeBasketStoreTotals } from '../../src/lib/shopping/basket';
import { requireCanonicalProductId, requireMatchingTrustedOffer, requireSensibleQuantity } from '../../src/lib/shopping/action-gates';
import { withSupabaseRetry } from '../../src/lib/supabase-resilience';

export type AgentListItem = {
  canonical_product_id?: string | null;
  canonical_name: string;
  category?: string;
  store?: string;
  price?: number;
  quantity?: number;
  on_promotion?: boolean;
  store_product_name?: string;
};

export type CurrentPrice = {
  canonical_product_id: string;
  canonical_name: string;
  category: string | null;
  store: string;
  price: number;
  on_promotion: boolean | null;
  store_product_name: string | null;
};

type TrustedOfferRow = CurrentPrice & {
  was_price: number | null;
  observed_at: string;
  source: string;
  relationship_type: string;
  freshness_state: string;
};

export async function resolveCanonicalProduct(canonicalProductId: string) {
  const id = requireCanonicalProductId(canonicalProductId);
  const { data, error } = await agentSupabase.from('products').select('id, canonical_name').eq('id', id).maybeSingle();
  if (error) throw new Error(`Unable to validate canonical product: ${error.message}`);
  return data ? { canonical_product_id: String(data.id), canonical_name: data.canonical_name } : null;
}

export function computeStoreTotals(items: AgentListItem[]) {
  return computeBasketStoreTotals(
    items
      .filter(item => item.store && typeof item.price === 'number')
      .map(item => ({
        canonical_name: item.canonical_name,
        category: item.category ?? null,
        quantity: item.quantity ?? 1,
        selected_offer: {
          retailer: item.store!,
          retailer_product_name: item.store_product_name ?? item.canonical_name,
          price: item.price!,
          on_promotion: Boolean(item.on_promotion),
        },
      })),
  );
}

export async function loadCurrentShop(subscriberId: string) {
  const { data, error } = await agentSupabase
    .from('saved_lists')
    .select('id, name, family_size, items, store_totals, recommended_store, generated_at, created_at')
    .eq('subscriber_id', subscriberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Unable to load the current shop: ${error.message}`);
  if (!data) return null;

  return {
    ...data,
    items: ((data.items ?? []) as AgentListItem[]).map(item => ({ ...item })),
  };
}

async function getTrustedOffersForProduct(canonicalProductId: string): Promise<TrustedOfferRow[]> {
  const id = requireCanonicalProductId(canonicalProductId);
  const { data, error } = await withSupabaseRetry(
    'trusted_offers_for_products.exact_product',
    () => agentSupabase.rpc('trusted_offers_for_products', { product_ids: [id] }),
  );
  if (error) throw new Error(`Unable to fetch current product price: ${error.message}`);
  return ((data ?? []) as TrustedOfferRow[])
    .sort((a, b) => Number(a.price) - Number(b.price));
}

export async function getBestCurrentPrice(canonicalName: string): Promise<CurrentPrice | null> {
  // Resolve the cheap canonical products table first instead of filtering the
  // latest_prices view by name. The view otherwise constructs the full trusted
  // offer set before applying the canonical-name filter.
  const { data: product, error: productError } = await agentSupabase
    .from('products')
    .select('id')
    .eq('canonical_name', canonicalName)
    .maybeSingle();
  if (productError) throw new Error(`Unable to resolve current product: ${productError.message}`);
  if (!product?.id) return null;

  const rows = await getTrustedOffersForProduct(String(product.id));
  const row = rows[0];
  if (!row) return null;
  return {
    canonical_product_id: String(row.canonical_product_id),
    canonical_name: row.canonical_name,
    category: row.category ?? null,
    store: row.store,
    price: Number(row.price),
    on_promotion: row.on_promotion ?? null,
    store_product_name: row.store_product_name ?? null,
  };
}

export async function getTrustedCurrentOffer(canonicalProductId: string): Promise<CurrentPrice | null> {
  const id = requireCanonicalProductId(canonicalProductId);
  const rows = await getTrustedOffersForProduct(id);
  const row = rows[0];
  if (!row) return null;
  const price = requireMatchingTrustedOffer({
    requestedCanonicalProductId: id,
    offerCanonicalProductId: row.canonical_product_id,
    relationshipType: row.relationship_type,
    freshnessState: row.freshness_state,
    price: row.price,
  });
  return {
    canonical_product_id: id,
    canonical_name: row.canonical_name,
    category: row.category ?? null,
    store: row.store,
    price,
    on_promotion: row.on_promotion ?? null,
    store_product_name: row.store_product_name ?? null,
  };
}

export async function persistCurrentShop(
  subscriberId: string,
  listId: string,
  items: AgentListItem[],
  expectedGeneratedAt?: string | null,
) {
  for (const item of items) requireSensibleQuantity(item.quantity ?? 1);
  const storeTotals = computeStoreTotals(items);
  let query = agentSupabase
    .from('saved_lists')
    .update({
      items,
      store_totals: storeTotals,
      generated_at: new Date().toISOString(),
    })
    .eq('id', listId)
    .eq('subscriber_id', subscriberId);
  if (expectedGeneratedAt) query = query.eq('generated_at', expectedGeneratedAt);
  const { data, error } = await query.select('id');

  if (error) throw new Error(`Unable to update the current shop: ${error.message}`);
  if (!data?.length) throw new OptimisticConcurrencyError();

  return storeTotals;
}
