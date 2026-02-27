import type { StoreResolver, StoreProductRow, ResolveResult } from '../types';

/**
 * Tesco Ireland URL resolver.
 *
 * Tesco IE product URLs follow the pattern:
 *   https://www.tesco.ie/groceries/en-IE/products/{sku}
 *
 * If the store_product already has a store_url we return it directly.
 * If we have a store_sku we can construct the URL.
 * Otherwise we fall back to a search URL using the product name.
 */
export const TescoResolver: StoreResolver = {
  resolve(product: StoreProductRow): ResolveResult {
    // If already resolved, return as-is
    if (product.store_url) {
      return { store_url: product.store_url, store_sku: product.store_sku };
    }

    // If we have a SKU, build the canonical URL
    if (product.store_sku) {
      return {
        store_url: `https://www.tesco.ie/groceries/en-IE/products/${product.store_sku}`,
        store_sku: product.store_sku,
      };
    }

    // Fall back to search using the store product name
    const query = encodeURIComponent(product.store_product_name);
    return {
      store_url: `https://www.tesco.ie/groceries/en-IE/search?query=${query}`,
      store_sku: null,
    };
  },
};
