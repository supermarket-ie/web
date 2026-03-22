import type { Metadata } from 'next';
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export const revalidate = 43200; // Revalidate every 12 hours — data updates twice weekly

export const metadata: Metadata = {
  title: 'Tesco vs Dunnes Stores vs SuperValu — Price Comparison Ireland',
  description: 'Compare grocery prices across Tesco, Dunnes Stores and SuperValu in Ireland. See which supermarket is cheapest for your weekly shop with live price data updated twice weekly.',
  keywords: ['Tesco vs Dunnes Ireland', 'cheapest supermarket Ireland', 'SuperValu price comparison', 'Irish supermarket prices', 'grocery comparison Ireland'],
  openGraph: {
    title: 'Tesco vs Dunnes vs SuperValu — Which is Cheapest in Ireland?',
    description: 'Live price comparison across Ireland\'s three main supermarkets. Updated twice weekly with real prices.',
  },
};

function fmt(n: number) { return `€${n.toFixed(2)}`; }

const STORE_INFO = {
  tesco:     { name: 'Tesco',          color: '#003A8C', light: '#EEF3FB', tagline: 'Largest range' },
  dunnes:    { name: 'Dunnes Stores',  color: '#7B0017', light: '#FAEAEC', tagline: 'Strong on own-brand' },
  supervalu: { name: 'SuperValu',      color: '#D4400F', light: '#FEF0E8', tagline: 'Premium fresh range' },
};

const BASKET_CATEGORIES = [
  'Dairy', 'Bakery', 'Meat', 'Fruit', 'Vegetables',
  'Breakfast', 'Pasta & Rice', 'Tinned', 'Beverages', 'Snacks',
];

async function getComparisonData() {
  const { data: priceRows } = await supabaseAdmin
    .from('price_observations')
    .select('price, store_products(store, products(canonical_name, category))')
    .order('observed_at', { ascending: false })
    .limit(3000);

  if (!priceRows) return null;

  // latest price per product per store
  const latest = new Map<string, number>(); // "productId:store" → price
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

  // Category totals per store (products available in all 3 stores)
  const categoryTotals: Record<string, Record<string, number>> = {};
  const categoryCount: Record<string, number> = {};
  let overallTotals: Record<string, number> = { tesco: 0, dunnes: 0, supervalu: 0 };
  let overallCount = 0;

  for (const [, { category, stores }] of byProduct) {
    if (stores.size < 3) continue; // only products in all 3 stores
    if (!BASKET_CATEGORIES.includes(category)) continue;

    if (!categoryTotals[category]) {
      categoryTotals[category] = { tesco: 0, dunnes: 0, supervalu: 0 };
      categoryCount[category] = 0;
    }

    for (const [store, price] of stores) {
      categoryTotals[category][store] = (categoryTotals[category][store] ?? 0) + price;
      overallTotals[store] = (overallTotals[store] ?? 0) + price;
    }
    categoryCount[category]++;
    overallCount++;
  }

  // Sample products per category for the table
  const samples: Record<string, { name: string; prices: Record<string, number> }[]> = {};
  for (const [name, { category, stores }] of byProduct) {
    if (stores.size < 2) continue;
    if (!BASKET_CATEGORIES.includes(category)) continue;
    if (!samples[category]) samples[category] = [];
    if (samples[category].length < 5) {
      samples[category].push({ name, prices: Object.fromEntries(stores) });
    }
  }

  return { categoryTotals, categoryCount, overallTotals, overallCount, samples };
}

export default async function ComparePage() {
  const data = await getComparisonData();
  if (!data) return <div>Loading...</div>;

  const { categoryTotals, overallTotals, overallCount, samples } = data;
  const stores = ['tesco', 'dunnes', 'supervalu'] as const;

  // Rank stores by overall total
  const ranked = [...stores].sort((a, b) => (overallTotals[a] ?? 0) - (overallTotals[b] ?? 0));
  const cheapest = ranked[0];
  const saving = (overallTotals[ranked[ranked.length - 1]] ?? 0) - (overallTotals[cheapest] ?? 0);

  const now = new Date();
  const updatedLabel = now.toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 pb-16">
        {/* Hero */}
        <div className="pt-10 pb-8">
          <div className="text-xs font-semibold text-[#006A35] uppercase tracking-widest mb-3">Live Price Comparison · Ireland</div>
          <h1 className="text-3xl font-bold text-[#2F2F2E] mb-3 leading-tight">
            Tesco vs Dunnes Stores vs SuperValu<br/>
            <span className="text-[#006A35]">Which is cheapest in Ireland?</span>
          </h1>
          <p className="text-[#5c5b5b] text-base max-w-xl">
            We track live prices across {overallCount}+ products at Ireland's three main supermarkets.
            Last updated {updatedLabel}.
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
        <div className="grid grid-cols-3 gap-3 mb-10">
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
            const catRanked = [...stores].sort((a, b) => (totals[a] ?? 0) - (totals[b] ?? 0));
            const catCheapest = catRanked[0];
            return (
              <div key={cat} className="bg-white rounded-2xl border border-[rgba(175,173,172,0.2)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-[#2F2F2E]">{cat}</h3>
                  <span className="text-xs text-[#006A35] font-semibold">
                    Best: {STORE_INFO[catCheapest].name} {fmt(totals[catCheapest] ?? 0)}
                  </span>
                </div>
                <div className="flex gap-2">
                  {catRanked.map((store, i) => {
                    const info = STORE_INFO[store];
                    const isBest = i === 0;
                    return (
                      <div key={store} className="flex-1 text-center rounded-xl py-2 px-1"
                        style={{ background: isBest ? info.light : '#F9F7F5' }}>
                        <div className="text-[11px] font-medium mb-0.5" style={{ color: isBest ? info.color : '#636E72' }}>
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
                        <div className="flex gap-2 flex-shrink-0 ml-2">
                          {stores.filter(s => p.prices[s]).map(s => (
                            <span key={s} className="text-[#2F2F2E]">
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
            Tell our AI what you want to cook this week and get a shopping list with live prices from all three stores — so you know exactly where to shop.
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
