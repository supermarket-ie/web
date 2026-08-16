import { getAllLatestPrices } from '@/lib/price-data';

export const revalidate = 3600;

type PromotionDeal = {
  product_name: string;
  store: string;
  price: number;
  was_price: number;
  saving: number;
};

async function getPromotions(): Promise<PromotionDeal[]> {
  const prices = await getAllLatestPrices();

  const deals: PromotionDeal[] = [];
  for (const row of prices) {
    if (!row.on_promotion || row.price == null || row.was_price == null) continue;

    const saving = row.was_price - row.price;
    if (saving <= 0) continue;

    deals.push({
      product_name: row.canonical_name,
      store: row.store,
      price: row.price,
      was_price: row.was_price,
      saving: Math.round(saving * 100) / 100,
    });
  }

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
