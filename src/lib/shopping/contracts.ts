export type RetailerId = string;

export type ProductIntent = {
  query: string;
  quantity?: number;
  brand_preference?: string | null;
  pack_size_preference?: string | null;
};

export type RetailerOffer = {
  retailer: RetailerId;
  retailer_product_id?: string | null;
  retailer_product_name: string;
  retailer_url?: string | null;
  price: number;
  was_price?: number | null;
  on_promotion: boolean;
  available?: boolean | null;
  captured_at?: string | null;
  match_confidence?: number | null;
};

export type ResolvedProduct = {
  canonical_name: string;
  category: string | null;
  score: number;
  best_price: number | null;
  best_store: RetailerId | null;
  on_promotion: boolean;
  offers: RetailerOffer[];
};

export type BasketItem = {
  canonical_name: string;
  category?: string | null;
  quantity: number;
  selected_offer?: RetailerOffer | null;
  alternatives?: RetailerOffer[];
  source?: 'history' | 'replenishment' | 'meal_plan' | 'explicit' | 'agent';
  reason?: string | null;
};

export type ShoppingBasket = {
  id?: string | null;
  household_id?: string | null;
  name?: string | null;
  items: BasketItem[];
  generated_at?: string | null;
};

export type HouseholdContext = {
  subscriber_id: string;
  family_size?: string | number | null;
  weekly_budget?: number | null;
  dietary: string[];
  dislikes?: string | null;
  preferred_stores: RetailerId[];
  memory: Record<string, unknown>;
};

export type StoreBasketComparison = {
  store: RetailerId;
  total: number;
  complete: boolean;
  covered_products: number;
  total_products: number;
  covered_units?: number;
  total_units?: number;
  missing_products: string[];
  substitutions?: Array<{
    requested: string;
    replacement: string;
    confidence: number;
  }>;
  utility_score?: number | null;
};

export type RetailerHandoffMethod =
  | 'product_links'
  | 'basket_link'
  | 'authenticated_cart'
  | 'retailer_api';

export type RetailerHandoffItem = {
  canonical_name: string;
  quantity: number;
  retailer_product_id?: string | null;
  retailer_product_name?: string | null;
  retailer_url?: string | null;
  status: 'matched' | 'missing';
};

export type RetailerHandoffResult = {
  retailer: RetailerId;
  status: 'ready' | 'partial' | 'unsupported' | 'failed';
  method?: RetailerHandoffMethod;
  matched_items: number;
  unmatched_items: string[];
  items?: RetailerHandoffItem[];
  cart_url?: string | null;
  checkout_url?: string | null;
  requires_retailer_login?: boolean;
  message?: string | null;
};
