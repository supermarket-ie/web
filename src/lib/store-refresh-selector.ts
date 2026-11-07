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
    failureProductIds = new Set<string>();
    for (let offset = 0; ; offset += 500) {
      const { data: failures, error: failureError } = await supabaseAdmin
        .from('scrape_failures')
        .select('store_product_id')
        .eq('run_id', options.failureRunId)
        .eq('store', store)
        .order('id')
        .range(offset, offset + 499);
      if (failureError) throw new Error(`Failed selecting ${store} failure cohort: ${failureError.message}`);
      for (const row of failures ?? []) failureProductIds.add(row.store_product_id as string);
      if ((failures ?? []).length < 500) break;
    }
    if (failureProductIds.size === 0) return [];
  }

  const selectionLimit = failureProductIds ? 2500 : Math.max(1, Math.min(Math.floor(limit), 2500));
  const rows: StoreRefreshRow[] = [];
  const selectedIds = new Set<string>();
  // PostgREST caps result rows independently of p_limit. Fetch the entire
  // bounded selection before publishing any work. SQL still chooses the
  // priority cohort; an explicit unique outer order keeps page offsets stable.
  for (let offset = 0; offset < selectionLimit; offset += 500) {
    const pageSize = Math.min(500, selectionLimit - offset);
    const { data, error } = await supabaseAdmin.rpc('select_store_products_for_refresh', {
      p_store: store,
      p_limit: selectionLimit,
      p_product_url_only: options.productUrlOnly ?? false,
      p_query: options.query?.trim() || null,
    }).order('store_product_id').range(offset, offset + pageSize - 1);

    if (error) throw new Error(`Failed selecting ${store} products for refresh: ${error.message}`);
    const page = (data ?? []) as StoreRefreshRow[];
    for (const row of page) {
      if (selectedIds.has(row.store_product_id)) {
        throw new Error(`Unstable ${store} refresh selection; no run was queued`);
      }
      selectedIds.add(row.store_product_id);
      rows.push(row);
    }
    if (page.length < pageSize) break;
  }
  if (!failureProductIds) return rows;
  return rows.filter((row) => failureProductIds.has(row.store_product_id)).slice(0, Math.max(1, limit));
}
