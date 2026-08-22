export * from './supervalu-direct-worker-base';

import { selectStoreProductsForRefresh } from '@/lib/store-refresh-selector';
import type { SupervaluQueueProduct } from './supervalu-direct-worker-base';

export async function selectSupervaluProducts(limit: number, query?: string): Promise<SupervaluQueueProduct[]> {
  const rows = await selectStoreProductsForRefresh('supervalu', limit, {
    productUrlOnly: true,
    query,
  });

  return rows.map((row) => ({
    storeProductId: row.store_product_id,
    canonicalName: row.canonical_name,
    storeProductName: row.store_product_name,
    storeUrl: row.store_url as string,
    storeSku: row.store_sku,
    previousPrice: row.previous_price,
  }));
}
