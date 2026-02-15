// Shared types for store resolvers and extractors

export type StoreName = 'tesco' | 'dunnes' | 'supervalu' | 'lidl' | 'aldi';

export const VALID_STORES = new Set<StoreName>(['tesco', 'dunnes', 'supervalu', 'lidl', 'aldi']);

export interface SearchProfile {
  required_tokens: string[];
  exclude_tokens: string[];
  preferred_tokens: string[];
}

export interface StoreProductRow {
  id: string;
  product_id: string;
  store: string;
  store_product_name: string;
  store_url?: string | null;
  store_sku?: string | null;
  products: {
    id: string;
    canonical_name: string;
    search_profile: SearchProfile;
  };
}

// --- Resolver types ---

export interface ResolveResult {
  store_url: string;
  store_sku?: string | null;
}

export interface StoreResolver {
  /** Build a product URL from the store_product row + search profile */
  resolve(product: StoreProductRow): ResolveResult;
}

// --- Extractor types ---

export interface ExtractedPrice {
  product_name: string;
  price: number;
  was_price: number | null;
  on_promotion: boolean;
  url: string;
}

export interface StoreExtractor {
  /** Extract price data from raw HTML and/or text for a given store URL */
  extract(input: { source_url: string; html: string; text: string }): ExtractedPrice | null;
}
