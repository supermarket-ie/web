import { supabaseAdmin } from '@/lib/supabase';

export const revalidate = 3600;

// Types for Supabase nested-select results
type StoreProduct = {
  store: string;
  store_product_name: string;
  products: { canonical_name: string; category: string } | null;
} | null;

type RawObs = {
  price: number;
  was_price: number | null;
  on_promotion: boolean | null;
  store_products: StoreProduct;
};

type PromotionDeal = {
  product_name: string;
  store: string;
  price: number;
  was_price: number;
  saving: number;
};

async function getPromotions(): Promise<PromotionDeal[]> {
  const { data } = await supabaseAdmin
    .from('price_observations')
    .select('price, was_price, on_promotion, store_products(store, store_product_name, products(canonical_name, category))')
    .eq('on_promotion', true)
    .order('observed_at', { ascending: false })
    .limit(500);

  const rows = (data ?? []) as unknown as RawObs[];

  // Process and deduplicate
  const seen = new Set<string>();
  const deals: PromotionDeal[] = [];

  for (const r of rows) {
    const sp = r.store_products;
    if (!sp?.products?.canonical_name || !sp.store || r.price == null || !r.was_price) continue;

    const key = `${sp.products.canonical_name}::${sp.store}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const saving = r.was_price - r.price;
    if (saving <= 0) continue;

    deals.push({
      product_name: sp.products.canonical_name,
      store: sp.store,
      price: r.price,
      was_price: r.was_price,
      saving: Math.round(saving * 100) / 100,
    });
  }

  // Return top 20 deals by savings
  return deals
    .sort((a, b) => b.saving - a.saving)
    .slice(0, 20);
}

export async function GET() {
  try {
    const promotions = await getPromotions();

    return new Response(JSON.stringify(promotions), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (error) {
    console.error('[/api/promotions] Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch promotions' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}