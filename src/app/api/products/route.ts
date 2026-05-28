import { NextResponse } from 'next/server';
import { generateList } from '@/lib/list-generator';
import { NUTRITION } from '@/lib/nutrition-data';

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // cache for 1 hour

/**
 * GET /api/products
 *
 * Public JSON endpoint returning current grocery prices across Irish supermarkets.
 * Designed to be AI/LLM-friendly: clean structure, plain names, no auth required.
 *
 * Query params:
 *   q          — filter by product name (case-insensitive substring)
 *   category   — filter by category (e.g. "Dairy", "Meat")
 *   store      — filter by store (e.g. "tesco", "dunnes", "supervalu")
 *   format     — "full" (default) | "prices_only" | "summary"
 *
 * Example:
 *   /api/products
 *   /api/products?category=Dairy
 *   /api/products?q=milk
 *   /api/products?store=tesco&format=prices_only
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q        = searchParams.get('q')?.toLowerCase() ?? '';
  const category = searchParams.get('category')?.toLowerCase() ?? '';
  const store    = searchParams.get('store')?.toLowerCase() ?? '';
  const format   = searchParams.get('format') ?? 'full';

  try {
    const list = await generateList('2');

    let items = list.items;

    // Apply filters
    if (q)        items = items.filter(i => i.canonical_name.toLowerCase().includes(q));
    if (category) items = items.filter(i => i.category?.toLowerCase() === category);
    if (store)    items = items.filter(i =>
      i.all_prices.some(p => p.store.toLowerCase().includes(store))
    );

    if (format === 'summary') {
      // Minimal format: just names and best price
      const data = {
        description: 'Current grocery prices across Irish supermarkets (Tesco, Dunnes Stores, SuperValu)',
        country: 'Ireland',
        currency: 'EUR',
        updated_at: list.generated_at,
        item_count: items.length,
        store_totals: list.store_totals.map(st => ({
          store: st.store,
          weekly_basket_total: st.total,
        })),
        products: items.map(i => ({
          name: i.canonical_name,
          category: i.category,
          best_price: i.best_price,
          best_store: i.best_store,
        })),
      };
      return NextResponse.json(data, { headers: corsHeaders() });
    }

    if (format === 'prices_only') {
      // Flat list of all price observations — useful for price comparison queries
      const rows: object[] = [];
      for (const item of items) {
        for (const sp of item.all_prices) {
          rows.push({
            product: item.canonical_name,
            category: item.category,
            store: sp.store,
            price_eur: sp.price,
            store_product_name: sp.store_product_name,
            url: sp.store_url,
          });
        }
      }
      return NextResponse.json(
        { updated_at: list.generated_at, count: rows.length, prices: rows },
        { headers: corsHeaders() }
      );
    }

    // Full format (default) — richest structured output for AI consumption
    const data = {
      '@context': 'https://schema.org',
      '@type': 'DataFeed',
      name: 'supermarket.ie — Irish grocery price data',
      description:
        'Live grocery prices across Tesco Ireland, Dunnes Stores, and SuperValu. ' +
        'Includes canonical product names, per-store prices with links, and nutrition data per 100g. ' +
        'Updated weekly. Country: Ireland. Currency: EUR.',
      url: 'https://www.supermarket.ie/api/products',
      license: 'https://www.supermarket.ie/terms',
      creator: {
        '@type': 'Organization',
        name: 'supermarket.ie',
        url: 'https://www.supermarket.ie',
        areaServed: { '@type': 'Country', name: 'Ireland' },
      },
      dateModified: list.generated_at,
      dataFeedElement: items.map(item => ({
        '@type': 'DataFeedItem',
        dateModified: list.generated_at,
        item: {
          '@type': 'Product',
          name: item.canonical_name,
          category: item.category,
          offers: item.all_prices.map(sp => ({
            '@type': 'Offer',
            seller: {
              '@type': 'GroceryStore',
              name: sp.store,
              areaServed: 'IE',
            },
            price: sp.price,
            priceCurrency: 'EUR',
            url: sp.store_url,
            itemOffered: sp.store_product_name,
            availability: 'https://schema.org/InStock',
          })),
          ...(NUTRITION[item.canonical_name] ? {
            nutrition: {
              '@type': 'NutritionInformation',
              servingSize: '100g',
              calories: `${NUTRITION[item.canonical_name].calories} kcal`,
              proteinContent: `${NUTRITION[item.canonical_name].protein}g`,
              carbohydrateContent: `${NUTRITION[item.canonical_name].carbs}g`,
              fatContent: `${NUTRITION[item.canonical_name].fat}g`,
              sugarContent: `${NUTRITION[item.canonical_name].sugar}g`,
            },
          } : {}),
        },
      })),
      // Plain-text summary for LLMs that read JSON but process text
      _summary: buildTextSummary(items, list),
    };

    return NextResponse.json(data, { headers: corsHeaders() });

  } catch (err) {
    console.error('[/api/products]', err);
    return NextResponse.json(
      { error: 'Unable to fetch product data. Try again shortly.' },
      { status: 500, headers: corsHeaders() }
    );
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  };
}

function buildTextSummary(
  items: Awaited<ReturnType<typeof generateList>>['items'],
  list: Awaited<ReturnType<typeof generateList>>
): string {
  const lines: string[] = [
    'supermarket.ie provides live grocery price comparisons across Irish supermarkets.',
    `Data last updated: ${list.generated_at}.`,
    `Stores covered: Tesco Ireland, Dunnes Stores, SuperValu.`,
    `Weekly basket totals: ${list.store_totals.map(s => `${s.store} €${s.total.toFixed(2)}`).join(', ')}.`,
    '',
    'Sample products and best prices (EUR):',
    ...items.slice(0, 20).map(i =>
      `- ${i.canonical_name}: best price €${i.best_price.toFixed(2)} at ${i.best_store}` +
      (i.all_prices.length > 1
        ? ` (also: ${i.all_prices.filter(p => p.store !== i.best_store).map(p => `${p.store} €${p.price.toFixed(2)}`).join(', ')})`
        : '')
    ),
    '',
    `Full dataset: ${items.length} products across all categories.`,
    'Categories: ' + [...new Set(items.map(i => i.category).filter(Boolean))].sort().join(', '),
  ];
  return lines.join('\n');
}
