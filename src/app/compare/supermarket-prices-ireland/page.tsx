import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export const revalidate = 43200; // Revalidate every 12 hours

export const metadata: Metadata = {
  title: 'Supermarket Price Comparison Ireland — Tesco, Dunnes, SuperValu, Aldi, Lidl',
  description: 'Compare grocery prices across all 5 major Irish supermarkets: Tesco, Dunnes Stores, SuperValu, Aldi & Lidl. See which is cheapest for your weekly shop with live price data.',
  keywords: ['supermarket prices Ireland', 'cheapest supermarket Ireland', 'Tesco vs Dunnes Ireland', 'Aldi prices Ireland', 'Lidl prices Ireland', 'grocery comparison Ireland', 'SuperValu price comparison'],
  openGraph: {
    title: 'Supermarket Price Comparison Ireland — Which is Cheapest?',
    description: 'Live prices compared across Tesco, Dunnes, SuperValu, Aldi & Lidl. Updated twice weekly with real prices.',
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

const ALL_STORES: StoreKey[] = ['tesco', 'dunnes', 'supervalu', 'aldi', 'lidl'];

const BASKET_CATEGORIES = [
  'Dairy', 'Bakery', 'Meat', 'Fruit', 'Vegetables',
  'Breakfast', 'Pasta & Rice', 'Tinned', 'Beverages', 'Snacks',
  'Condiments', 'Fish', 'Baking', 'Frozen',
];

async function getComparisonData() {
  const { data: priceRows } = await supabaseAdmin
    .from('price_observations')
    .select('price, store_products(store, products(canonical_name, category))')
    .order('observed_at', { ascending: false })
    .limit(5000);

  if (!priceRows) return null;

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
  const storeCounts: Record<string, number> = {};
  for (const [, { stores }] of byProduct) {
    for (const store of stores.keys()) {
      storeCounts[store] = (storeCounts[store] ?? 0) + 1;
    }
  }
  const activeStores = ALL_STORES.filter(s => (storeCounts[s] ?? 0) > 10);

  // Category totals per store (products available in at least 3 stores)
  const minStoresForComparison = Math.min(3, activeStores.length);
  const categoryTotals: Record<string, Record<string, number>> = {};
  const categoryCount: Record<string, number> = {};
  const overallTotals: Record<string, number> = {};
  for (const s of activeStores) overallTotals[s] = 0;
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
      overallTotals[s] += price;
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

  return { categoryTotals, categoryCount, overallTotals, overallCount, samples, activeStores };
}

export default async function ComparePage() {
  const data = await getComparisonData();
  if (!data) return <div>Loading...</div>;

  const { categoryTotals, overallTotals, overallCount, samples, activeStores } = data;

  // Rank stores by overall total (only stores with data)
  const ranked = [...activeStores].sort((a, b) => (overallTotals[a] ?? 0) - (overallTotals[b] ?? 0));
  const cheapest = ranked[0];
  const saving = (overallTotals[ranked[ranked.length - 1]] ?? 0) - (overallTotals[cheapest] ?? 0);

  const now = new Date();
  const updatedLabel = now.toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

  const storeNames = activeStores.map(s => STORE_INFO[s].name).join(', ').replace(/, ([^,]+)$/, ' & $1');

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 pb-16">
        {/* Hero */}
        <div className="pt-10 pb-8">
          <div className="text-xs font-semibold text-[#006A35] uppercase tracking-widest mb-3">Live Price Comparison · Ireland</div>
          <h1 className="text-3xl font-bold text-[#2F2F2E] mb-3 leading-tight">
            Supermarket Price Comparison Ireland<br/>
            <span className="text-[#006A35]">Which is cheapest?</span>
          </h1>
          <p className="text-[#5c5b5b] text-base max-w-xl">
            Live prices compared across {storeNames} in Ireland.
            Based on {overallCount} products. Last updated {updatedLabel}.
          </p>
        </div>

        {/* Winner banner */}
        <div
          className="rounded-2xl p-6 mb-8 text-white"
          style={{ background: STORE_INFO[cheapest].color }}
        >
          <div className="text-sm opacity-80 mb-1 font-medium">Cheapest overall basket</div>
          <div className="text-3xl font-bold mb-1">{STORE_INFO[cheapest].name}</div>
          <div className="text-lg opacity-90">
            {fmt(overallTotals[cheapest])} for a standard weekly basket
          </div>
          {saving > 0.01 && (
            <div className="mt-3 inline-block bg-white/20 rounded-xl px-4 py-2">
              <span className="font-bold">{fmt(saving)} cheaper</span> than the most expensive option
            </div>
          )}
        </div>

        {/* Store totals grid */}
        <div className={`grid gap-3 mb-10`} style={{ gridTemplateColumns: `repeat(${Math.min(ranked.length, 5)}, minmax(0, 1fr))` }}>
          {ranked.map((store, i) => {
            const info = STORE_INFO[store];
            const isCheapest = i === 0;
            return (
              <div key={store} className="rounded-2xl p-4 border-2 text-center"
                style={{ borderColor: isCheapest ? info.color : '#E8E2DC', background: isCheapest ? info.light : '#fff' }}>
                <div className="font-bold text-sm mb-2" style={{ color: isCheapest ? info.color : '#1D2324' }}>{info.name}</div>
                <div className="text-2xl font-bold mb-1" style={{ color: isCheapest ? info.color : '#1D2324' }}>
                  {fmt(overallTotals[store] ?? 0)}
                </div>
                <div className="text-xs text-[#5c5b5b]">{info.tagline}</div>
                {isCheapest && (
                  <div className="mt-2 text-[10px] font-bold uppercase rounded-full px-2 py-0.5 inline-block text-white" style={{ background: info.color }}>
                    Cheapest ✓
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Category breakdown */}
        <h2 className="text-xl font-bold text-[#2F2F2E] mb-4">Price comparison by category</h2>
        <div className="space-y-3 mb-10">
          {BASKET_CATEGORIES.filter(cat => categoryTotals[cat]).map(cat => {
            const totals = categoryTotals[cat];
            // Only show stores that have data in this category
            const storesWithData = activeStores.filter(s => (totals[s] ?? 0) > 0);
            const catRanked = [...storesWithData].sort((a, b) => (totals[a] ?? 0) - (totals[b] ?? 0));
            const catCheapest = catRanked[0];
            if (!catCheapest) return null;
            return (
              <div key={cat} className="bg-white rounded-2xl border border-[rgba(175,173,172,0.2)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-[#2F2F2E]">{cat}</h3>
                  <span className="text-xs text-[#006A35] font-semibold">
                    Best: {STORE_INFO[catCheapest].name} {fmt(totals[catCheapest] ?? 0)}
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                  {catRanked.map((store, i) => {
                    const info = STORE_INFO[store];
                    const isBest = i === 0;
                    return (
                      <div key={store} className="flex-1 min-w-0 text-center rounded-xl py-2 px-1"
                        style={{ background: isBest ? info.light : '#F9F7F5' }}>
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
        <div className="rounded-2xl p-8 text-center" style={{ background: '#EAE7E7' }}>
          <div className="text-3xl mb-3">🛒</div>
          <h2 className="text-xl font-bold text-[#2F2F2E] mb-2">Get a personalised price comparison</h2>
          <p className="text-[#5c5b5b] mb-5 max-w-md mx-auto">
            Tell our AI what you need this week and get a shopping list with live prices from all {activeStores.length} stores — so you know exactly where to shop.
          </p>
          <Link href="/"
            className="inline-block px-8 py-3.5 rounded-full font-semibold text-base transition text-[#004a23]"
            style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
            Build my weekly list free →
          </Link>
          <p className="text-xs mt-3" style={{ color: 'rgba(175,173,172,0.8)' }}>No signup required to get started</p>
        </div>

      </main>

      <SiteFooter />
    </div>
  );
}
