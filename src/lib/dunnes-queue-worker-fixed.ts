export * from './dunnes-queue-worker-base';

import { selectStoreProductsForRefresh } from '@/lib/store-refresh-selector';
import type { DunnesQueueProduct } from './dunnes-queue-worker-base';

const STORE = 'dunnes';

export async function selectDunnesProducts(limit: number, query?: string): Promise<DunnesQueueProduct[]> {
  const rows = await selectStoreProductsForRefresh(STORE, limit, { query });

  return rows.map((row) => ({
    storeProductId: row.store_product_id,
    canonicalName: row.canonical_name,
    storeProductName: row.store_product_name,
    storeUrl: row.store_url,
    storeSku: row.store_sku,
    previousPrice: row.previous_price,
  }));
}
