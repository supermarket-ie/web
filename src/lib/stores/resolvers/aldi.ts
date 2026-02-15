import type { StoreResolver, StoreProductRow, ResolveResult } from '../types';

/**
 * Aldi Ireland URL resolver.
 *
 * Aldi product URLs follow the pattern:
 *   https://groceries.aldi.ie/en-GB/p-{slug}-{sku}
 *
 * If the store_product already has a store_url we return it directly.
 * Otherwise we fall back to a search URL.
 */
export const AldiResolver: StoreResolver = {
  resolve(product: StoreProductRow): ResolveResult {
    if (product.store_url) {
      return { store_url: product.store_url, store_sku: product.store_sku };
    }

    if (product.store_sku) {
      const slug = product.store_product_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
      return {
        store_url: `https://groceries.aldi.ie/en-GB/p-${slug}-${product.store_sku}`,
        store_sku: product.store_sku,
      };
    }

    const query = encodeURIComponent(product.store_product_name);
    return {
      store_url: `https://groceries.aldi.ie/en-GB/Search?query=${query}`,
      store_sku: null,
    };
  },
};
