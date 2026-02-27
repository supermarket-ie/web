import type { StoreResolver, StoreProductRow, ResolveResult } from '../types';

/**
 * SuperValu URL resolver.
 *
 * SuperValu product URLs follow the pattern:
 *   https://shop.supervalu.ie/shopping/product/{slug}-{sku}
 *
 * If the store_product already has a store_url we return it directly.
 * Otherwise we fall back to a search URL.
 */
export const SuperValuResolver: StoreResolver = {
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
        store_url: `https://shop.supervalu.ie/shopping/product/${slug}-${product.store_sku}`,
        store_sku: product.store_sku,
      };
    }

    const query = encodeURIComponent(product.store_product_name);
    return {
      store_url: `https://shop.supervalu.ie/shopping/search-results?q=${query}`,
      store_sku: null,
    };
  },
};
