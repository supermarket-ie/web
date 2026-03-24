import { createClient } from "@supabase/supabase-js";
import { ProductComparison } from "./types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getWeeklyPromotions(): Promise<ProductComparison[]> {
  const { data, error } = await supabase
    .from("product_comparison")
    .select("*")
    .eq("on_promotion", true)
    .not("price", "is", null)
    .order("category");

  if (error) throw new Error(`Failed to fetch promotions: ${error.message}`);
  return data ?? [];
}

export async function getPricesByCategory(
  category: string
): Promise<ProductComparison[]> {
  const { data, error } = await supabase
    .from("product_comparison")
    .select("*")
    .eq("category", category)
    .not("price", "is", null)
    .order("canonical_name")
    .order("price");

  if (error)
    throw new Error(`Failed to fetch category prices: ${error.message}`);
  return data ?? [];
}

export async function getAllCategories(): Promise<string[]> {
  const { data, error } = await supabase
    .from("products")
    .select("category")
    .order("category");

  if (error) throw new Error(`Failed to fetch categories: ${error.message}`);

  const categories = [...new Set((data ?? []).map((r) => r.category))];
  return categories;
}
