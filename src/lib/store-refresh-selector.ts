import { supabaseAdmin } from '@/lib/supabase';

export type RefreshStore = 'tesco' | 'dunnes' | 'supervalu' | 'aldi';

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
  options: { productUrlOnly?: boolean; query?: string; failureRunId?: string } = {},
): Promise<StoreRefreshRow[]> {
  let failureProductIds: Set<string> | null = null;
  if (options.failureRunId) {
    const { data: failures, error: failureError } = await supabaseAdmin
      .from('scrape_failures')
      .select('store_product_id')
      .eq('run_id', options.failureRunId)
      .eq('store', store);
    if (failureError) throw new Error(`Failed selecting ${store} failure cohort: ${failureError.message}`);
    failureProductIds = new Set((failures ?? []).map((row) => row.store_product_id as string));
    if (failureProductIds.size === 0) return [];
  }

  const { data, error } = await supabaseAdmin.rpc('select_store_products_for_refresh', {
    p_store: store,
    p_limit: failureProductIds ? 2500 : Math.max(1, Math.min(Math.floor(limit), 2500)),
    p_product_url_only: options.productUrlOnly ?? false,
    p_query: options.query?.trim() || null,
  });

  if (error) throw new Error(`Failed selecting ${store} products for refresh: ${error.message}`);
  const rows = (data ?? []) as StoreRefreshRow[];
  if (!failureProductIds) return rows;
  return rows.filter((row) => failureProductIds.has(row.store_product_id)).slice(0, Math.max(1, limit));
}
