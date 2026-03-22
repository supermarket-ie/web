import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';

export const revalidate = 43200; // 12 hours — matches scrape frequency

// Category metadata for SEO + display
const CATEGORY_META: Record<string, {
  title: string;
  description: string;
  emoji: string;
  keywords: string[];
}> = {
  'dairy': {
    title: 'Dairy Prices Ireland',
    description: 'Compare milk, cheese, butter, cream and yogurt prices across Tesco, Dunnes Stores and SuperValu in Ireland. Updated twice weekly.',
    emoji: '🥛',
    keywords: ['cheapest milk Ireland', 'butter price Ireland', 'cheese price Tesco Dunnes SuperValu'],
  },
  'meat': {
    title: 'Meat Prices Ireland',
    description: 'Compare chicken, beef, pork and lamb prices across Irish supermarkets. Find the cheapest cuts at Tesco, Dunnes and SuperValu.',
    emoji: '🥩',
    keywords: ['cheapest chicken Ireland', 'beef mince price Ireland', 'meat prices Tesco Dunnes'],
  },
  'bakery': {
    title: 'Bread & Bakery Prices Ireland',
    description: 'Compare bread, rolls, wraps and bakery prices across Tesco, Dunnes Stores and SuperValu in Ireland.',
    emoji: '🍞',
    keywords: ['cheapest bread Ireland', 'bread price Tesco Dunnes SuperValu', 'bakery prices Ireland'],
  },
  'vegetables': {
    title: 'Vegetable Prices Ireland',
    description: 'Compare fresh vegetable prices across Irish supermarkets. Find the cheapest veg at Tesco, Dunnes and SuperValu.',
    emoji: '🥦',
    keywords: ['cheapest vegetables Ireland', 'veg prices Tesco Dunnes SuperValu', 'fresh veg Ireland'],
  },
  'fruit': {
    title: 'Fruit Prices Ireland',
    description: 'Compare fresh fruit prices across Tesco, Dunnes Stores and SuperValu in Ireland. Updated twice weekly.',
    emoji: '🍎',
    keywords: ['cheapest fruit Ireland', 'fruit prices Tesco Dunnes SuperValu'],
  },
  'breakfast': {
    title: 'Breakfast & Cereal Prices Ireland',
    description: 'Compare cereal, porridge and breakfast prices across Irish supermarkets.',
    emoji: '🥣',
    keywords: ['cheapest cereal Ireland', 'porridge price Ireland', 'breakfast prices Tesco Dunnes'],
  },
  'beverages': {
    title: 'Drinks & Beverages Prices Ireland',
    description: 'Compare juice, water, squash and soft drink prices across Tesco, Dunnes and SuperValu in Ireland.',
    emoji: '🧃',
    keywords: ['cheapest drinks Ireland', 'orange juice price Ireland', 'beverages Tesco Dunnes SuperValu'],
  },
  'tinned': {
    title: 'Tinned Food Prices Ireland',
    description: 'Compare tinned tomatoes, beans, tuna and canned food prices across Irish supermarkets.',
    emoji: '🥫',
    keywords: ['cheapest tinned food Ireland', 'tinned tomatoes price Ireland', 'canned food prices'],
  },
  'frozen': {
    title: 'Frozen Food Prices Ireland',
    description: 'Compare frozen food prices across Tesco, Dunnes Stores and SuperValu in Ireland.',
    emoji: '🧊',
    keywords: ['cheapest frozen food Ireland', 'frozen prices Tesco Dunnes SuperValu'],
  },
  'household': {
    title: 'Household Products Prices Ireland',
    description: 'Compare cleaning products, toilet roll and household essentials prices across Irish supermarkets.',
    emoji: '🧹',
    keywords: ['cheapest cleaning products Ireland', 'household prices Tesco Dunnes SuperValu'],
  },
  'snacks': {
    title: 'Snacks & Crisps Prices Ireland',
    description: 'Compare crisps, biscuits, popcorn and snack prices across Tesco, Dunnes and SuperValu in Ireland.',
    emoji: '🍿',
    keywords: ['cheapest crisps Ireland', 'snack prices Ireland', 'biscuits price Tesco Dunnes'],
  },
  'condiments': {
    title: 'Condiments & Sauces Prices Ireland',
    description: 'Compare ketchup, mayo, sauces and condiment prices across Irish supermarkets.',
    emoji: '🧴',
    keywords: ['condiments prices Ireland', 'ketchup price Ireland', 'sauce prices Tesco Dunnes'],
  },
  'pasta & rice': {
    title: 'Pasta & Rice Prices Ireland',
    description: 'Compare pasta, rice, noodles and grains prices across Tesco, Dunnes and SuperValu in Ireland.',
    emoji: '🍝',
    keywords: ['cheapest pasta Ireland', 'rice price Ireland', 'pasta price Tesco Dunnes SuperValu'],
  },
  'fish': {
    title: 'Fish & Seafood Prices Ireland',
    description: 'Compare fish fillet, tuna, salmon and seafood prices across Irish supermarkets.',
    emoji: '🐟',
    keywords: ['cheapest fish Ireland', 'salmon price Ireland', 'fish prices Tesco Dunnes SuperValu'],
  },
  'dairy alternatives': {
    title: 'Dairy Alternative Prices Ireland',
    description: 'Compare oat milk, almond milk and plant-based dairy prices across Irish supermarkets.',
    emoji: '🌾',
    keywords: ['cheapest oat milk Ireland', 'almond milk price Ireland', 'plant milk prices'],
  },
  'personal care': {
    title: 'Personal Care Prices Ireland',
    description: 'Compare shampoo, shower gel, toothpaste and toiletry prices across Tesco, Dunnes and SuperValu.',
    emoji: '🧴',
    keywords: ['cheapest shampoo Ireland', 'toiletries prices Ireland', 'personal care Tesco Dunnes'],
  },
  'baking': {
    title: 'Baking Ingredients Prices Ireland',
    description: 'Compare flour, sugar, baking powder and baking ingredient prices across Irish supermarkets.',
    emoji: '🧁',
    keywords: ['baking ingredients prices Ireland', 'cheapest flour Ireland', 'sugar price Ireland'],
  },
  'spreads': {
    title: 'Spreads & Jams Prices Ireland',
    description: 'Compare peanut butter, jam, honey and spread prices across Tesco, Dunnes and SuperValu.',
    emoji: '🫙',
    keywords: ['cheapest peanut butter Ireland', 'jam price Ireland', 'spreads prices Tesco Dunnes'],
  },
};

function slugToCategory(slug: string): string {
  // Convert URL slug back to category name
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function categoryToSlug(cat: string): string {
  return cat.toLowerCase().replace(/\s+&\s+/g, '-').replace(/\s+/g, '-');
}

function fmt(n: number) { return `€${n.toFixed(2)}`; }

const STORE_INFO = {
  tesco:     { name: 'Tesco',         color: '#003A8C', light: '#EEF3FB' },
  dunnes:    { name: 'Dunnes Stores', color: '#7B0017', light: '#FAEAEC' },
  supervalu: { name: 'SuperValu',     color: '#D4400F', light: '#FEF0E8' },
};
const STORES = ['tesco', 'dunnes', 'supervalu'] as const;

async function getCategoryProducts(category: string) {
  const { data: spRows } = await supabaseAdmin
    .from('store_products')
    .select('id, store, store_product_name, store_url, products(canonical_name, category)')
    .eq('url_status', 'resolved');

  const { data: priceRows } = await supabaseAdmin
    .from('price_observations')
    .select('store_product_id, price, on_promotion, was_price, observed_at')
    .order('observed_at', { ascending: false })
    .limit(3000);

  if (!spRows || !priceRows) return null;

  // Latest price per store_product
  const latestPrice = new Map<string, { price: number; on_promotion: boolean; was_price: number | null }>();
  for (const row of priceRows) {
    if (!latestPrice.has(row.store_product_id)) {
      latestPrice.set(row.store_product_id, { price: row.price, on_promotion: row.on_promotion, was_price: row.was_price });
    }
  }

  // Group by canonical product, filter to category
  const byProduct = new Map<string, { canonical: string; stores: Map<string, { price: number; name: string; url: string | null; on_promotion: boolean; was_price: number | null }> }>();

  for (const sp of spRows) {
    const p = sp.products as unknown as { canonical_name: string; category: string } | null;
    if (!p) continue;
    if (p.category.toLowerCase() !== category.toLowerCase()) continue;
    const obs = latestPrice.get(sp.id);
    if (!obs) continue;

    if (!byProduct.has(p.canonical_name)) {
      byProduct.set(p.canonical_name, { canonical: p.canonical_name, stores: new Map() });
    }
    byProduct.get(p.canonical_name)!.stores.set(sp.store, {
      price: obs.price,
      name: sp.store_product_name,
      url: sp.store_url,
      on_promotion: obs.on_promotion ?? false,
      was_price: obs.was_price ?? null,
    });
  }

  return Array.from(byProduct.values()).sort((a, b) => a.canonical.localeCompare(b.canonical));
}

export async function generateStaticParams() {
  return Object.keys(CATEGORY_META).map(slug => ({ category: slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const meta = CATEGORY_META[category];
  const catName = meta?.title ?? `${slugToCategory(category)} Prices Ireland`;
  return {
    title: `${catName} | supermarket.ie`,
    description: meta?.description ?? `Compare ${slugToCategory(category)} prices across Tesco, Dunnes Stores and SuperValu in Ireland.`,
    keywords: meta?.keywords,
    openGraph: {
      title: catName,
      description: meta?.description,
    },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const categoryName = slugToCategory(category);
  const meta = CATEGORY_META[category];

  const products = await getCategoryProducts(categoryName);
  if (!products) notFound();
  // Allow the page even if no products yet — show empty state
  const hasProducts = products.length > 0;

  // Store totals across category
  const storeTotals: Record<string, number> = { tesco: 0, dunnes: 0, supervalu: 0 };
  for (const { stores } of products) {
    for (const [store, { price }] of stores) {
      storeTotals[store] = (storeTotals[store] ?? 0) + price;
    }
  }
  const rankedStores = [...STORES].filter(s => storeTotals[s] > 0).sort((a, b) => storeTotals[a] - storeTotals[b]);
  const cheapest = rankedStores[0];

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 pb-16">
        {/* Breadcrumb */}
        <nav className="pt-6 pb-2 text-xs text-[#B2BEC3]">
          <Link href="/" className="hover:text-[#5c5b5b]">Home</Link>
          {' · '}
          <Link href="/shop" className="hover:text-[#5c5b5b]">Shop by category</Link>
          {' · '}
          <span className="text-[#5c5b5b]">{categoryName}</span>
        </nav>

        {/* Hero */}
        <div className="pt-4 pb-6">
          <div className="text-4xl mb-3">{meta?.emoji ?? '🛒'}</div>
          <h1 className="text-3xl font-bold text-[#2F2F2E] mb-2">
            {categoryName} prices in Ireland
          </h1>
          <p className="text-[#5c5b5b]">
            {meta?.description ?? `Live ${categoryName.toLowerCase()} prices from Tesco, Dunnes Stores and SuperValu. Updated twice weekly.`}
          </p>
        </div>

        {/* Cheapest store banner */}
        {cheapest && hasProducts && (
          <div className="rounded-2xl p-5 mb-6 text-white" style={{ background: STORE_INFO[cheapest].color }}>
            <div className="text-sm opacity-80 mb-1">Cheapest for {categoryName.toLowerCase()}</div>
            <div className="text-2xl font-bold mb-1">{STORE_INFO[cheapest].name}</div>
            <div className="text-base opacity-90">
              {fmt(storeTotals[cheapest])} total across {products.filter(p => p.stores.has(cheapest)).length} products
            </div>
          </div>
        )}

        {/* Store comparison bar */}
        {rankedStores.length > 1 && (
          <div className="grid grid-cols-3 gap-2 mb-8">
            {rankedStores.map((store, i) => {
              const info = STORE_INFO[store];
              const isBest = i === 0;
              return (
                <div key={store} className="rounded-xl p-3 border-2 text-center"
                  style={{ borderColor: isBest ? info.color : 'rgba(175,173,172,0.2)', background: isBest ? info.light : '#fff' }}>
                  <div className="text-xs font-bold mb-1" style={{ color: isBest ? info.color : '#2F2F2E' }}>
                    {info.name.split(' ')[0]}
                  </div>
                  <div className="text-lg font-bold" style={{ color: isBest ? info.color : '#2F2F2E' }}>
                    {fmt(storeTotals[store])}
                  </div>
                  {isBest && <div className="text-[10px] font-bold text-white rounded-full px-2 py-0.5 mt-1 inline-block" style={{ background: info.color }}>Cheapest ✓</div>}
                </div>
              );
            })}
          </div>
        )}

        {/* Product list */}
        {hasProducts ? (
          <>
            <h2 className="text-lg font-bold text-[#2F2F2E] mb-3">{products.length} {categoryName.toLowerCase()} products</h2>
            <div className="bg-white rounded-2xl divide-y divide-[#F3F0EF] mb-8" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
              {products.map(({ canonical, stores }) => {
                const sorted = [...stores.entries()].sort((a, b) => a[1].price - b[1].price);
                const best = sorted[0];
                return (
                  <div key={canonical} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-sm font-medium text-[#2F2F2E]">{canonical}</div>
                          {best && best[1].on_promotion && (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#004a23] px-1.5 py-0.5 rounded-md" style={{ background: '#6BFE9C' }}>🏷️ Offer</span>
                          )}
                        </div>
                        {best && (
                          <div className="text-xs text-[#5c5b5b] mt-0.5">
                            Best: <span style={{ color: STORE_INFO[best[0] as keyof typeof STORE_INFO]?.color }}>{STORE_INFO[best[0] as keyof typeof STORE_INFO]?.name}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        {best && (
                          <div className="text-sm font-bold text-[#2F2F2E]">{fmt(best[1].price)}</div>
                        )}
                        {best && best[1].was_price && (
                          <div className="text-xs text-[#B2BEC3] line-through">{fmt(best[1].was_price)}</div>
                        )}
                      </div>
                    </div>
                    {sorted.length > 1 && (
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                        {sorted.map(([store, { price, on_promotion }]) => (
                          <span key={store} className="text-xs text-[#B2BEC3]">
                            {STORE_INFO[store as keyof typeof STORE_INFO]?.name.split(' ')[0]} {fmt(price)}
                            {on_promotion && <span className="ml-0.5 text-[#006A35]">🏷️</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="bg-white rounded-2xl p-8 text-center text-[#5c5b5b] mb-8" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
            <p className="text-lg mb-2">Prices coming soon</p>
            <p className="text-sm">We're adding {categoryName.toLowerCase()} products — check back shortly.</p>
          </div>
        )}

        {/* CTA */}
        <div className="rounded-2xl p-6 text-center mb-10" style={{ background: '#EAE7E7' }}>
          <div className="text-2xl mb-2">{meta?.emoji ?? '🛒'}</div>
          <h3 className="font-bold text-[#2F2F2E] mb-1">Build your full weekly list</h3>
          <p className="text-sm text-[#5c5b5b] mb-4">
            Tell our AI what you want to cook and get a complete shopping list with live prices across all three stores.
          </p>
          <Link href="/"
            className="inline-block px-6 py-3 rounded-full font-semibold transition text-[#004a23]"
            style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
            Try the AI planner free →
          </Link>
        </div>

        {/* Other categories */}
        <h2 className="text-lg font-bold text-[#2F2F2E] mb-4">Browse other categories</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(CATEGORY_META)
            .filter(([slug]) => slug !== category)
            .slice(0, 9)
            .map(([slug, m]) => (
              <Link key={slug} href={`/shop/${slug}`}
                className="bg-white rounded-xl p-3 flex items-center gap-2 transition hover:shadow-sm" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
                <span className="text-xl">{m.emoji}</span>
                <span className="text-sm font-medium text-[#2F2F2E]">{slugToCategory(slug)}</span>
              </Link>
            ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
