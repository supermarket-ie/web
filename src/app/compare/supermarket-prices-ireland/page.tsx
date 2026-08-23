import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { AgentLandingCTA } from '@/components/AgentLandingCTA';

export const revalidate = 43200; // Revalidate every 12 hours

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();

export const metadata: Metadata = {
  title: 'Supermarket Price Comparison Ireland | Ask Supermarket.ie',
  description: 'Ask Ireland’s supermarket shopping agent to find products, prepare a household shop and use current Tesco, Dunnes, SuperValu and Aldi price evidence in context.',
  keywords: ['supermarket prices Ireland', 'cheapest supermarket Ireland', 'Tesco vs Dunnes Ireland', 'Aldi prices Ireland', 'Lidl prices Ireland', 'grocery comparison Ireland', 'SuperValu price comparison'],
  alternates: { canonical: `${BASE_URL}/compare/supermarket-prices-ireland` },
  openGraph: {
    title: 'Supermarket.ie — Ireland’s household shopping agent',
    description: 'Ask for products, meals, a household shop or a budget. Supermarket.ie uses current Irish supermarket data to help.',
  },
};

function fmt(n: number) { return `€${n.toFixed(2)}`; }

type StoreKey = 'tesco' | 'dunnes' | 'supervalu' | 'aldi' | 'lidl';

const STORE_INFO: Record<StoreKey, { name: string; color: string; light: string; tagline: string }> = {
  tesco:     { name: 'Tesco',          color: '#003A8C', light: '#EEF3FB', tagline: 'Largest range' },
  dunnes:    { name: 'Dunnes Stores',  color: '#7B0017', light: '#FAEAEC', tagline: 'Strong on own-brand' },
  supervalu: { name: 'SuperValu',      color: '#D4400F', light: '#FEF0E8', tagline: 'Premium fresh range' },
  aldi:      { name: 'Aldi',           color: '#00457C', light: '#E8F0FA', tagline: 'Discount leader' },
  lidl:      { name: 'Lidl',           color: '#0050AA', light: '#E6F0FC', tagline: 'Weekly specials' },
};

const BASKET_CATEGORIES = [
  'Dairy', 'Bakery', 'Meat', 'Fruit', 'Vegetables',
  'Breakfast', 'Pasta & Rice', 'Tinned', 'Beverages', 'Snacks',
  'Condiments', 'Fish', 'Baking', 'Frozen',
];

async function getComparisonData() {
  // Paginate price observations to get all data
  let priceRows: { price: number; store_products: unknown }[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await supabaseAdmin
      .from('price_observations')
      .select('price, store_products(store, products(canonical_name, category))')
      .order('observed_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (!data || data.length === 0) break;
    priceRows = priceRows.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  if (!priceRows.length) return null;

  // latest price per product per store
  const latest = new Map<string, number>();
  const byProduct = new Map<string, { category: string; stores: Map<string, number> }>();

  for (const row of priceRows) {
    const sp = row.store_products as unknown as { store: string; products: { canonical_name: string; category: string } | null } | null;
    const name = sp?.products?.canonical_name;
    const store = sp?.store;
    const category = sp?.products?.category;
    if (!name || !store || !row.price) continue;
    const key = `${name}:${store}`;
    if (latest.has(key)) continue;
    latest.set(key, row.price);
    if (!byProduct.has(name)) byProduct.set(name, { category: category ?? 'Other', stores: new Map() });
    byProduct.get(name)!.stores.set(store, row.price);
  }

  // Find which stores have meaningful data (>10 products)
  const MAIN_3: StoreKey[] = ['tesco', 'dunnes', 'supervalu'];
  
  // Filter to products available in all 3 main stores
  for (const [name, { stores }] of byProduct) {
    if (!MAIN_3.every(s => stores.has(s))) {
      byProduct.delete(name);
    }
  }

  const storeCounts: Record<string, number> = {};
  for (const [, { stores }] of byProduct) {
    for (const store of stores.keys()) {
      storeCounts[store] = (storeCounts[store] ?? 0) + 1;
    }
  }
  // Only compare stores across the same matched product set. Aldi currently has
  // useful live evidence, but not equivalent catalogue coverage on this page;
  // including its partial totals would produce a misleading "cheapest" claim.
  const activeStores = MAIN_3.filter(s => (storeCounts[s] ?? 0) > 10);

  // Category totals per store (products available in at least 3 stores)
  const minStoresForComparison = Math.min(3, activeStores.length);
  const categoryTotals: Record<string, Record<string, number>> = {};
  const categoryCount: Record<string, number> = {};
  let overallCount = 0;

  for (const [, { category, stores }] of byProduct) {
    // Count how many active stores have this product
    const activeStoresWithProduct = activeStores.filter(s => stores.has(s));
    if (activeStoresWithProduct.length < minStoresForComparison) continue;
    if (!BASKET_CATEGORIES.includes(category)) continue;

    if (!categoryTotals[category]) {
      categoryTotals[category] = {};
      for (const s of activeStores) categoryTotals[category][s] = 0;
      categoryCount[category] = 0;
    }

    for (const s of activeStoresWithProduct) {
      const price = stores.get(s)!;
      categoryTotals[category][s] += price;
    }
    categoryCount[category]++;
    overallCount++;
  }

  // Sample products per category
  const samples: Record<string, { name: string; prices: Record<string, number> }[]> = {};
  for (const [name, { category, stores }] of byProduct) {
    if (stores.size < 2) continue;
    if (!BASKET_CATEGORIES.includes(category)) continue;
    if (!samples[category]) samples[category] = [];
    if (samples[category].length < 5) {
      samples[category].push({ name, prices: Object.fromEntries(stores) });
    }
  }

  return { categoryTotals, categoryCount, overallCount, samples, activeStores };
}

export default async function ComparePage() {
  const data = await getComparisonData();
  if (!data) return <div>Loading...</div>;

  const { categoryTotals, overallCount, samples, activeStores } = data;

  const now = new Date();
  const updatedLabel = now.toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

  const storeNames = activeStores.map(s => STORE_INFO[s].name).join(', ').replace(/, ([^,]+)$/, ' & $1');

  return (
    <div className="min-h-screen bg-[#f8faf8]">
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 pb-16">
        {/* Hero */}
        <div className="pt-12 pb-9 sm:pt-16">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#e5f7eb] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#397250]">Live Irish supermarket intelligence</div>
          <h1 className="mb-5 max-w-4xl text-balance text-[clamp(2.4rem,5vw,4.25rem)] font-extrabold leading-[1.02] tracking-[-0.055em] text-[#152219]">
            Your supermarket shopping agent for Ireland
          </h1>
          <p className="max-w-2xl text-base leading-7 text-[#667169] sm:text-lg">
            Ask for a product, meal, household shop or budget. Supermarket.ie uses current evidence from {storeNames} to work out what is useful for you—not just which single price is lowest.
          </p>
          <p className="mt-3 text-xs font-medium text-[#8b958e]">{overallCount} comparable products in this snapshot · Updated {updatedLabel}</p>
        </div>

        <div className="mb-10">
          <AgentLandingCTA
            context="comparison"
            title="Tell us what your household actually needs"
            description="A useful shop depends on pack sizes, preferences, meals, budget and what is worth buying where. Start with your real request and let the agent use the price data in context."
            prompt="Help me prepare this week’s household shop"
          />
        </div>

        {/* Category breakdown */}
        <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#397250]">Grounded in current data</p>
            <h2 className="text-2xl font-extrabold tracking-[-0.035em] text-[#152219]">Current catalogue evidence</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-[#667169]">A live product snapshot the agent can use. Category totals are catalogue observations, not a household shopping recommendation.</p>
        </div>
        <div className="space-y-3 mb-10">
          {BASKET_CATEGORIES.filter(cat => categoryTotals[cat]).map(cat => {
            const totals = categoryTotals[cat];
            // Only show stores that have data in this category
            const storesWithData = activeStores.filter(s => (totals[s] ?? 0) > 0);
            const catRanked = [...storesWithData].sort((a, b) => (totals[a] ?? 0) - (totals[b] ?? 0));
            const catCheapest = catRanked[0];
            if (!catCheapest) return null;
            return (
              <div key={cat} className="rounded-[1.35rem] border border-[#e3e8e4] bg-white p-5 shadow-[0_10px_35px_rgba(25,57,38,0.045)]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-[#2F2F2E]">{cat}</h3>
                  <span className="rounded-full bg-[#e5f7eb] px-2.5 py-1 text-[11px] font-bold text-[#397250]">
                    Lowest matched total: {STORE_INFO[catCheapest].name} {fmt(totals[catCheapest] ?? 0)}
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                  {catRanked.map((store, i) => {
                    const info = STORE_INFO[store];
                    const isBest = i === 0;
                    return (
                      <div key={store} className="flex-1 min-w-0 text-center rounded-xl py-2 px-1"
                        style={{ background: isBest ? '#eef8f1' : '#f5f8f5' }}>
                        <div className="text-[11px] font-medium mb-0.5 truncate" style={{ color: isBest ? info.color : '#636E72' }}>
                          {info.name.split(' ')[0]}
                        </div>
                        <div className="text-sm font-bold" style={{ color: isBest ? info.color : '#1D2324' }}>
                          {fmt(totals[store] ?? 0)}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Sample products */}
                {samples[cat] && (
                  <div className="mt-3 pt-3 border-t border-[#F0ECE8] space-y-1.5">
                    {samples[cat].slice(0, 3).map(p => (
                      <div key={p.name} className="flex items-center justify-between text-xs">
                        <span className="text-[#5c5b5b] truncate flex-1">{p.name}</span>
                        <div className="flex gap-2 flex-shrink-0 ml-2 overflow-x-auto">
                          {activeStores.filter(s => p.prices[s]).map(s => (
                            <span key={s} className="text-[#2F2F2E] whitespace-nowrap">
                              <span className="text-[#B2BEC3]">{STORE_INFO[s].name.split(' ')[0]} </span>
                              {fmt(p.prices[s])}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="rounded-[1.75rem] bg-[#0e0e0e] p-8 text-center text-white">
          <div className="text-3xl mb-3">🛒</div>
          <h2 className="mb-2 text-xl font-bold">Make Supermarket.ie your household agent</h2>
          <p className="mx-auto mb-5 max-w-md text-white/65">
            Ask it to prepare a shop, remember what matters to your household, save a list or monitor a product for a useful change.
          </p>
          <Link href="/"
            className="inline-block px-8 py-3.5 rounded-full font-semibold text-base transition text-[#004a23]"
            style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
            Start with the agent →
          </Link>
          <p className="mt-3 text-xs text-white/40">No signup required to get started</p>
        </div>

      </main>

      <SiteFooter />
    </div>
  );
}
