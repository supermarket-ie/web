// TypeScript types mirroring the Supabase DB schema

export interface Product {
  id: string;
  canonical_name: string;
  category: string | null;
}

export interface StoreProduct {
  id: string;
  product_id: string;
  store: string;
  store_product_name: string;
  store_url: string | null;
  store_sku: string | null;
  url_status: string | null;
}

export interface PriceObservation {
  id: string;
  store_product_id: string;
  price: number | null;
  price_per_unit: number | null;
  unit_for_comparison: string | null;
  observed_at: string;
  source: string | null;
}

export interface Subscriber {
  id: string;
  email: string;
  family_size: string | null;
  subscribed: boolean;
  unsubscribe_token: string | null;
}
