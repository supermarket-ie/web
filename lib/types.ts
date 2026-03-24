export type Store = "tesco" | "dunnes" | "supervalu" | "lidl";

export interface FamilyProfile {
  familySize: 1 | 2 | 3 | 4 | 5;
  dietary: DietaryPreference[];
  budget?: number; // weekly budget in euros
}

export type DietaryPreference =
  | "vegetarian"
  | "vegan"
  | "gluten_free"
  | "dairy_free"
  | "halal";

// What comes back from the product_comparison view
export interface ProductComparison {
  canonical_name: string;
  category: string;
  store: Store;
  store_product_name: string;
  brand: string | null;
  is_own_brand: boolean;
  price: number | null;
  was_price: number | null;
  on_promotion: boolean | null;
  price_per_unit: number | null;
  observed_at: string | null;
}

// A single item in the generated shopping list
export interface ShoppingListItem {
  canonical_name: string;
  display_name: string;
  category: string;
  store: Store;
  store_product_name: string;
  brand: string | null;
  is_own_brand: boolean;
  price: number;
  was_price: number | null;
  on_promotion: boolean;
  quantity: number;
  line_total: number;
  note?: string;
}

export interface StoreBreakdown {
  items: number;
  total: number;
}

export interface GeneratedList {
  items: ShoppingListItem[];
  total_estimate: number;
  store_breakdown: Record<string, StoreBreakdown>;
  savings_vs_full_price: number;
  ai_summary: string;
  key_insights: string[];
  store_strategy: string;
}

export interface GenerateListRequest {
  familySize: number;
  dietary: DietaryPreference[];
  budget?: number;
}

export interface GenerateListResponse {
  list: GeneratedList;
  error?: string;
}
