import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { NUTRITION } from '@/lib/nutrition-data';
import { BrowseClient } from './BrowseClient';

export const metadata: Metadata = {
  title: 'Browse Groceries · supermarket.ie',
  description: 'Browse weekly grocery essentials for Irish families by category. Sign in to unlock live prices from Tesco, Dunnes, SuperValu, Lidl and Aldi.',
  openGraph: {
    title: 'Browse Groceries · supermarket.ie',
    description: 'Curated Irish grocery essentials — free to browse, sign in for live prices.',
    url: 'https://supermarket.ie/browse',
  },
};

// All actual DB categories with emoji + display order
export const CATEGORY_CONFIG: Record<string, { emoji: string; order: number; color: string }> = {
  'Bakery':              { emoji: '🍞', order: 1,  color: '#FEF3E2' },
  'Dairy':               { emoji: '🥛', order: 2,  color: '#EEF3FB' },
  'Dairy Alternatives':  { emoji: '🌾', order: 3,  color: '#F0FAF7' },
  'Meat':                { emoji: '🥩', order: 4,  color: '#FAEAEC' },
  'Fish':                { emoji: '🐟', order: 5,  color: '#EEF3FB' },
  'Fruit':               { emoji: '🍎', order: 6,  color: '#FFF0F0' },
  'Vegetables':          { emoji: '🥦', order: 7,  color: '#F0FAF7' },
  'Frozen':              { emoji: '🧊', order: 8,  color: '#EEF3FB' },
  'Breakfast':           { emoji: '🥣', order: 9,  color: '#FEF3E2' },
  'Tinned':              { emoji: '🥫', order: 10, color: '#F5F0EB' },
  'Pasta & Rice':        { emoji: '🍝', order: 11, color: '#FEF3E2' },
  'Baking':              { emoji: '🎂', order: 12, color: '#FEF3E2' },
  'Condiments':          { emoji: '🫙', order: 13, color: '#F5F0EB' },
  'Spreads':             { emoji: '🧈', order: 14, color: '#FEF3E2' },
  'Oils':                { emoji: '🫒', order: 15, color: '#F0FAF7' },
  'Stock':               { emoji: '🍲', order: 16, color: '#FEF3E2' },
  'Seasoning':           { emoji: '🧂', order: 17, color: '#F5F0EB' },
  'Other':               { emoji: '🛒', order: 99, color: '#F5F0EB' },
};

export interface Product {
  id: string;
  canonical_name: string;
  category: string | null;
  storeCount: number;
  nutrition: { calories: number; protein: number; carbs: number; fat: number } | null;
}

async function getProducts(): Promise<Product[]> {
  const { data, error } = await supabaseAdmin
    .from('store_products')
    .select('product_id, store, products(id, canonical_name, category)')
    .eq('url_status', 'resolved');

  if (error || !data) return [];

  const map = new Map<string, { id: string; canonical_name: string; category: string | null; stores: Set<string> }>();
  for (const row of data) {
    const raw = row.products;
    const p = (Array.isArray(raw) ? raw[0] : raw) as { id: string; canonical_name: string; category: string | null } | null;
    if (!p) continue;
    if (!map.has(p.id)) map.set(p.id, { id: p.id, canonical_name: p.canonical_name, category: p.category, stores: new Set() });
    map.get(p.id)!.stores.add(row.store);
  }

  return Array.from(map.values()).map(({ stores, ...rest }) => ({
    ...rest,
    storeCount: stores.size,
    nutrition: NUTRITION[rest.canonical_name]
      ? { calories: NUTRITION[rest.canonical_name].calories, protein: NUTRITION[rest.canonical_name].protein, carbs: NUTRITION[rest.canonical_name].carbs, fat: NUTRITION[rest.canonical_name].fat }
      : null,
  }));
}

export default async function BrowsePage() {
  const products = await getProducts();
  return <BrowseClient products={products} />;
}
