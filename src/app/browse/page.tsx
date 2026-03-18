import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { NUTRITION } from '@/lib/nutrition-data';
import { CATEGORY_CONFIG, type BrowseProduct } from '@/lib/category-config';
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

async function getProducts(): Promise<BrowseProduct[]> {
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
  return <BrowseClient products={products} categoryConfig={CATEGORY_CONFIG} />;
}
