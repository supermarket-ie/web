import { supabaseAdmin } from '@/lib/supabase';

export type RefreshStore = 'dunnes' | 'supervalu' | 'aldi';

export type StoreRefreshRow = {
  store_product_id: string;
  canonical_name: string;
  store_product_name: string;
  store_url: string | null;
  store_sku: string | null;
  previous_price: number | null;
  last_observed_at: string | null;
};

export async function selectStoreProductsForRefresh(
  store: RefreshStore,
  limit: number,
  options: { productUrlOnly?: boolean; query?: string } = {},
): Promise<StoreRefreshRow[]> {
  const { data, error } = await supabaseAdmin.rpc('select_store_products_for_refresh', {
    p_store: store,
    p_limit: Math.max(1, Math.min(Math.floor(limit), 2500)),
    p_product_url_only: options.productUrlOnly ?? false,
    p_query: options.query?.trim() || null,
  });

  if (error) throw new Error(`Failed selecting ${store} products for refresh: ${error.message}`);
  return (data ?? []) as StoreRefreshRow[];
}
