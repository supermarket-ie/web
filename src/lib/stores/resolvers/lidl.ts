import type { StoreResolver, StoreProductRow, ResolveResult } from '../types';

/**
 * Lidl Ireland URL resolver.
 *
 * Lidl product URLs follow the pattern:
 *   https://www.lidl.ie/p/{slug}/p{sku}
 *
 * If the store_product already has a store_url we return it directly.
 * Otherwise we fall back to a search URL.
 */
export const LidlResolver: StoreResolver = {
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
        store_url: `https://www.lidl.ie/p/${slug}/p${product.store_sku}`,
        store_sku: product.store_sku,
      };
    }

    const query = encodeURIComponent(product.store_product_name);
    return {
      store_url: `https://www.lidl.ie/q/query/${query}`,
      store_sku: null,
    };
  },
};
