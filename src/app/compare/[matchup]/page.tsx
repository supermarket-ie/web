import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { getAllLatestPrices, groupByProduct, filterToMain3, STORE_INFO, ALL_STORES, fmt, type StoreKey } from '@/lib/price-data';

export const revalidate = 43200; // 12h

// All valid matchups
const MATCHUPS: { slug: string; stores: [StoreKey, StoreKey] }[] = [
  { slug: 'tesco-vs-dunnes', stores: ['tesco', 'dunnes'] },
  { slug: 'tesco-vs-supervalu', stores: ['tesco', 'supervalu'] },
  { slug: 'dunnes-vs-supervalu', stores: ['dunnes', 'supervalu'] },
  { slug: 'tesco-vs-aldi', stores: ['tesco', 'aldi'] },
  { slug: 'dunnes-vs-aldi', stores: ['dunnes', 'aldi'] },
  { slug: 'supervalu-vs-aldi', stores: ['supervalu', 'aldi'] },
];

function getMatchup(slug: string) {
  return MATCHUPS.find(m => m.slug === slug);
}

export async function generateStaticParams() {
  return MATCHUPS.map(m => ({ matchup: m.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ matchup: string }> }): Promise<Metadata> {
  const { matchup: slug } = await params;
  const m = getMatchup(slug);
  if (!m) return {};
  const [a, b] = m.stores;
  const nameA = STORE_INFO[a].name;
  const nameB = STORE_INFO[b].name;
  return {
    title: `${nameA} vs ${nameB} Prices Ireland — Which is Cheaper? | supermarket.ie`,
    description: `Live price comparison between ${nameA} and ${nameB} in Ireland. See which supermarket is cheaper across ${CATEGORIES.length}+ categories with real, updated prices.`,
    keywords: [`${nameA} vs ${nameB}`, `${nameA} vs ${nameB} prices Ireland`, `${nameA} or ${nameB} cheaper`, `supermarket comparison Ireland`],
    openGraph: {
      title: `${nameA} vs ${nameB} — Which is Cheaper in Ireland?`,
      description: `Head-to-head grocery price comparison with live data. Updated twice weekly.`,
    },
  };
}

const CATEGORIES = [
  'Dairy', 'Bakery', 'Meat', 'Fruit', 'Vegetables', 'Breakfast',
  'Pasta & Rice', 'Tinned', 'Beverages', 'Snacks', 'Condiments',
  'Fish', 'Baking', 'Frozen', 'Household', 'Personal Care',
];

export default async function MatchupPage({ params }: { params: Promise<{ matchup: string }> }) {
  const { matchup: slug } = await params;
  const m = getMatchup(slug);
  if (!m) notFound();

  const [storeA, storeB] = m.stores;
  const infoA = STORE_INFO[storeA];
  const infoB = STORE_INFO[storeB];

  const allPrices = await getAllLatestPrices();
  const byProduct = filterToMain3(groupByProduct(allPrices));

  // Only products available in BOTH stores being compared
  const shared: { name: string; category: string; priceA: number; priceB: number }[] = [];
  for (const [name, { category, stores }] of byProduct) {
    const pA = stores.get(storeA);
    const pB = stores.get(storeB);
    if (!pA || !pB) continue;
    shared.push({ name, category, priceA: pA.price, priceB: pB.price });
  }

  // Overall: who wins more products
  let winsA = 0, winsB = 0, ties = 0;
  let totalA = 0, totalB = 0;
  for (const p of shared) {
    totalA += p.priceA;
    totalB += p.priceB;
    if (p.priceA < p.priceB) winsA++;
    else if (p.priceB < p.priceA) winsB++;
    else ties++;
  }

  const overallWinner: StoreKey | null = totalA < totalB ? storeA : totalB < totalA ? storeB : null;
  const saving = Math.abs(totalA - totalB);

  // Category breakdown
  const catData: { category: string; totalA: number; totalB: number; count: number; winner: StoreKey | null }[] = [];
  for (const cat of CATEGORIES) {
    const items = shared.filter(p => p.category === cat);
    if (items.length < 2) continue;
    const cTotalA = items.reduce((s, p) => s + p.priceA, 0);
    const cTotalB = items.reduce((s, p) => s + p.priceB, 0);
    catData.push({
      category: cat,
      totalA: cTotalA,
      totalB: cTotalB,
      count: items.length,
      winner: cTotalA < cTotalB ? storeA : cTotalB < cTotalA ? storeB : null,
    });
  }

  // Biggest price differences (most interesting for users)
  const diffs = shared
    .map(p => ({ ...p, diff: Math.abs(p.priceA - p.priceB), cheaper: p.priceA < p.priceB ? storeA : storeB }))
    .filter(p => p.diff > 0.10)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 15);

  const updatedLabel = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-6 pb-16">
        {/* Breadcrumb */}
        <nav className="pt-6 pb-2 text-xs text-[#B2BEC3]">
          <Link href="/" className="hover:text-[#5c5b5b]">Home</Link>
          {' · '}
          <Link href="/compare/supermarket-prices-ireland" className="hover:text-[#5c5b5b]">Compare</Link>
          {' · '}
          <span className="text-[#5c5b5b]">{infoA.name} vs {infoB.name}</span>
        </nav>

        {/* Hero */}
        <div className="pt-4 pb-8">
          <h1 className="text-3xl font-bold text-[#2F2F2E] mb-2">
            {infoA.name} vs {infoB.name} — Which is Cheaper?
          </h1>
          <p className="text-[#5c5b5b] max-w-2xl">
            Head-to-head price comparison across {shared.length} products available in both stores.
            Based on live data, updated {updatedLabel}.
          </p>
        </div>

        {/* Scoreboard */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="rounded-2xl p-5 border-2 text-center" style={{ borderColor: overallWinner === storeA ? infoA.color : 'rgba(175,173,172,0.2)', background: overallWinner === storeA ? infoA.light : '#fff' }}>
            <div className="text-sm font-bold mb-1" style={{ color: infoA.color }}>{infoA.name}</div>
            <div className="text-2xl font-bold mb-1" style={{ color: infoA.color }}>{fmt(totalA)}</div>
            <div className="text-sm text-[#5c5b5b]">Cheaper on <strong>{winsA}</strong> products</div>
            {overallWinner === storeA && (
              <div className="mt-2 text-[10px] font-bold uppercase rounded-full px-2 py-0.5 inline-block text-white" style={{ background: infoA.color }}>
                Cheaper overall ✓
              </div>
            )}
          </div>
          <div className="rounded-2xl p-5 border-2 text-center" style={{ borderColor: overallWinner === storeB ? infoB.color : 'rgba(175,173,172,0.2)', background: overallWinner === storeB ? infoB.light : '#fff' }}>
            <div className="text-sm font-bold mb-1" style={{ color: infoB.color }}>{infoB.name}</div>
            <div className="text-2xl font-bold mb-1" style={{ color: infoB.color }}>{fmt(totalB)}</div>
            <div className="text-sm text-[#5c5b5b]">Cheaper on <strong>{winsB}</strong> products</div>
            {overallWinner === storeB && (
              <div className="mt-2 text-[10px] font-bold uppercase rounded-full px-2 py-0.5 inline-block text-white" style={{ background: infoB.color }}>
                Cheaper overall ✓
              </div>
            )}
          </div>
        </div>

        {saving > 0.01 && (
          <div className="rounded-xl p-4 mb-8 text-center text-sm" style={{ background: '#E8F5E9', color: '#1B5E20' }}>
            Shopping at <strong>{overallWinner ? STORE_INFO[overallWinner].name : 'either'}</strong> saves you <strong>{fmt(saving)}</strong> across {shared.length} comparable products
          </div>
        )}

        {/* Category breakdown */}
        <h2 className="text-xl font-bold text-[#2F2F2E] mb-4">By Category</h2>
        <div className="space-y-3 mb-10">
          {catData.map(({ category, totalA: cA, totalB: cB, count, winner }) => {
            const winnerInfo = winner ? STORE_INFO[winner] : null;
            return (
              <div key={category} className="bg-white rounded-xl border border-[rgba(175,173,172,0.2)] p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-[#2F2F2E]">{category} <span className="text-xs text-[#B2BEC3] font-normal">({count} products)</span></h3>
                  {winnerInfo && (
                    <span className="text-xs font-semibold" style={{ color: winnerInfo.color }}>
                      {winnerInfo.name} cheaper
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center rounded-lg py-2" style={{ background: winner === storeA ? infoA.light : '#F9F7F5' }}>
                    <div className="text-xs text-[#5c5b5b] mb-0.5">{infoA.name.split(' ')[0]}</div>
                    <div className="text-base font-bold" style={{ color: winner === storeA ? infoA.color : '#2F2F2E' }}>{fmt(cA)}</div>
                  </div>
                  <div className="text-center rounded-lg py-2" style={{ background: winner === storeB ? infoB.light : '#F9F7F5' }}>
                    <div className="text-xs text-[#5c5b5b] mb-0.5">{infoB.name.split(' ')[0]}</div>
                    <div className="text-base font-bold" style={{ color: winner === storeB ? infoB.color : '#2F2F2E' }}>{fmt(cB)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Biggest price differences */}
        {diffs.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-bold text-[#2F2F2E] mb-4">Biggest Price Differences</h2>
            <div className="bg-white rounded-2xl divide-y divide-[#F3F0EF]" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
              {diffs.map((d, i) => {
                const cheaperInfo = STORE_INFO[d.cheaper as StoreKey];
                return (
                  <div key={`${d.name}-${i}`} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#2F2F2E]">{d.name}</div>
                      <div className="text-xs text-[#B2BEC3]">{d.category}</div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm" style={{ color: infoA.color, fontWeight: d.cheaper === storeA ? 700 : 400 }}>{fmt(d.priceA)}</span>
                      <span className="text-xs text-[#B2BEC3]">vs</span>
                      <span className="text-sm" style={{ color: infoB.color, fontWeight: d.cheaper === storeB ? 700 : 400 }}>{fmt(d.priceB)}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-white" style={{ background: cheaperInfo.color }}>
                        Save {fmt(d.diff)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Other comparisons */}
        <h2 className="text-lg font-bold text-[#2F2F2E] mb-4">More comparisons</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10">
          {MATCHUPS.filter(mm => mm.slug !== slug).map(mm => {
            const [s1, s2] = mm.stores;
            return (
              <Link key={mm.slug} href={`/compare/${mm.slug}`}
                className="bg-white rounded-xl p-4 border border-[rgba(175,173,172,0.2)] hover:shadow-sm transition flex items-center justify-between">
                <span className="text-sm font-medium text-[#2F2F2E]">{STORE_INFO[s1].name} vs {STORE_INFO[s2].name}</span>
                <span className="text-xs text-[#006A35]">Compare →</span>
              </Link>
            );
          })}
          <Link href="/compare/supermarket-prices-ireland"
            className="bg-white rounded-xl p-4 border border-[rgba(175,173,172,0.2)] hover:shadow-sm transition flex items-center justify-between">
            <span className="text-sm font-medium text-[#2F2F2E]">All stores comparison</span>
            <span className="text-xs text-[#006A35]">Compare →</span>
          </Link>
        </div>

        {/* CTA */}
        <div className="rounded-2xl p-6 text-center" style={{ background: '#EAE7E7' }}>
          <div className="text-2xl mb-2">🛒</div>
          <h3 className="font-bold text-[#2F2F2E] mb-1">Find out which store is cheapest for your shop</h3>
          <p className="text-sm text-[#5c5b5b] mb-4">
            Tell our AI what you need and get a personalised price comparison across all stores.
          </p>
          <Link href="/"
            className="inline-block px-6 py-3 rounded-full font-semibold transition text-white"
            style={{ background: 'linear-gradient(135deg, #006A35, #00944A)' }}>
            Try the AI planner free →
          </Link>
        </div>

        {/* Schema.org */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: `${infoA.name} vs ${infoB.name} Price Comparison Ireland`,
          description: `Comparing ${shared.length} grocery products between ${infoA.name} and ${infoB.name} in Ireland.`,
          url: `https://supermarket.ie/compare/${slug}`,
        }) }} />
      </main>
      <SiteFooter />
    </div>
  );
}
