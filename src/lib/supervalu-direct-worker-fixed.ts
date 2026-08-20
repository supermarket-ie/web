export * from './supervalu-direct-worker-base';

import { supabaseAdmin } from '@/lib/supabase';
import { loadLatestPreviousPrices } from '@/lib/chunked-price-selection';
import type { SupervaluQueueProduct } from './supervalu-direct-worker-base';

const STORE = 'supervalu';

export async function selectSupervaluProducts(limit: number, query?: string): Promise<SupervaluQueueProduct[]> {
  let builder = supabaseAdmin
    .from('store_products')
    .select('id, store_product_name, store_url, store_sku, products!inner(canonical_name)')
    .eq('store', STORE)
    .eq('url_status', 'resolved')
    .like('store_url', '%/product/%')
    .limit(limit);

  if (query) builder = builder.ilike('products.canonical_name', `%${query}%`);

  const { data, error } = await builder;
  if (error) throw new Error(`Failed selecting SuperValu products: ${error.message}`);
  if (!data || data.length === 0) return [];

  const latest = await loadLatestPreviousPrices(data.map((row) => row.id), 'SuperValu');

  return data
    .filter((row) => typeof row.store_url === 'string' && row.store_url.includes('/product/'))
    .map((row) => {
      const product = row.products as unknown as { canonical_name: string };
      return {
        storeProductId: row.id,
        canonicalName: product.canonical_name,
        storeProductName: row.store_product_name,
        storeUrl: row.store_url as string,
        storeSku: row.store_sku,
        previousPrice: latest.get(row.id) ?? null,
      };
    });
}
