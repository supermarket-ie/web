import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { getAllLatestPrices, STORE_INFO, fmt, type StoreKey } from '@/lib/price-data';
import { buildMatchup } from '@/lib/matchup-comparison';
import { getCurrentPairReviews } from '@/lib/comparison-reviews';

export const revalidate = 43200; // 12h

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();

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
    title: `${nameA} vs ${nameB} Prices Ireland — Product-by-Product | supermarket.ie`,
    description: `Live prices at ${nameA} and ${nameB} in Ireland, product by product. Stores are only ranked on products independently verified as identical at both.`,
    keywords: [`${nameA} vs ${nameB}`, `${nameA} vs ${nameB} prices Ireland`, `supermarket comparison Ireland`],
    alternates: { canonical: `${BASE_URL}/compare/${slug}` },
    openGraph: {
      title: `${nameA} vs ${nameB} — live prices in Ireland`,
      description: `Product-by-product prices; ranked only on independently verified identical products.`,
    },
  };
}


export default async function MatchupPage({ params }: { params: Promise<{ matchup: string }> }) {
  const { matchup: slug } = await params;
  const m = getMatchup(slug);
  if (!m) notFound();

  const [storeA, storeB] = m.stores;
  const infoA = STORE_INFO[storeA];
  const infoB = STORE_INFO[storeB];

  const [allPrices, reviews] = await Promise.all([getAllLatestPrices(), getCurrentPairReviews()]);
  // Only products verified as identical at BOTH stores are ranked (shared comparison rule); the rest are listed.
  const mx = buildMatchup(allPrices, storeA, storeB, reviews);
  const verifiedCount = mx.verified.length;
  const sideStore = (side: 'a' | 'b' | null): StoreKey | null => (side === 'a' ? storeA : side === 'b' ? storeB : null);
  const overallWinner = sideStore(mx.overallWinner);
  const { winsA, winsB, totalA, totalB, saving } = mx;
  const catData = mx.categories.map(c => ({ ...c, winner: sideStore(c.winner) }));
  const diffs = mx.diffs.map(d => ({ name: d.name, category: d.category, priceA: d.a.price, priceB: d.b.price, diff: d.diff, cheaper: sideStore(d.cheaper)! }));
  const shared = [...mx.verified, ...mx.unverified];
  const updatedLabel = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-6 pb-16">
        <Breadcrumbs items={[
          { label: 'Compare', href: '/compare/supermarket-prices-ireland' },
          { label: `${infoA.name} vs ${infoB.name}`, href: `/compare/${slug}` },
        ]} />

        {/* Hero */}
        <div className="pt-4 pb-8">
          <h1 className="text-3xl font-bold text-[#2F2F2E] mb-2">
            {infoA.name} vs {infoB.name} — live prices
          </h1>
          <p className="text-[#5c5b5b] max-w-2xl">
            {shared.length} products are sold at both stores. {verifiedCount > 0
              ? `${verifiedCount} of them are independently verified as the identical product at both, and only those are used to compare the stores.`
              : 'None is yet independently verified as the identical product at both stores, so we don’t say which store is cheaper.'}{' '}
            Updated {updatedLabel}.
          </p>
        </div>

        {verifiedCount > 0 && <>
        {/* Scoreboard: verified identical products only */}
        <h2 className="text-xl font-bold text-[#2F2F2E] mb-3">On {verifiedCount} verified identical products</h2>
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="rounded-2xl p-5 border-2 text-center" style={{ borderColor: overallWinner === storeA ? infoA.color : 'rgba(175,173,172,0.2)', background: overallWinner === storeA ? infoA.light : '#fff' }}>
            <div className="text-sm font-bold mb-1" style={{ color: infoA.color }}>{infoA.name}</div>
            <div className="text-2xl font-bold mb-1" style={{ color: infoA.color }}>{fmt(totalA)}</div>
            <div className="text-sm text-[#5c5b5b]">Cheaper on <strong>{winsA}</strong> products</div>
            {overallWinner === storeA && (
              <div className="mt-2 text-[10px] font-bold uppercase rounded-full px-2 py-0.5 inline-block text-white" style={{ background: infoA.color }}>
                Cheaper on verified products ✓
              </div>
            )}
          </div>
          <div className="rounded-2xl p-5 border-2 text-center" style={{ borderColor: overallWinner === storeB ? infoB.color : 'rgba(175,173,172,0.2)', background: overallWinner === storeB ? infoB.light : '#fff' }}>
            <div className="text-sm font-bold mb-1" style={{ color: infoB.color }}>{infoB.name}</div>
            <div className="text-2xl font-bold mb-1" style={{ color: infoB.color }}>{fmt(totalB)}</div>
            <div className="text-sm text-[#5c5b5b]">Cheaper on <strong>{winsB}</strong> products</div>
            {overallWinner === storeB && (
              <div className="mt-2 text-[10px] font-bold uppercase rounded-full px-2 py-0.5 inline-block text-white" style={{ background: infoB.color }}>
                Cheaper on verified products ✓
              </div>
            )}
          </div>
        </div>
        </>}

        {verifiedCount > 0 && overallWinner && saving > 0.01 && (
          <div className="rounded-xl p-4 mb-8 text-center text-sm" style={{ background: '#E8F5E9', color: '#1B5E20' }}>
            <strong>{STORE_INFO[overallWinner].name}</strong> is <strong>{fmt(saving)}</strong> cheaper across the {verifiedCount} verified identical products
          </div>
        )}

        {/* Category breakdown */}
        {catData.length > 0 && <h2 className="text-xl font-bold text-[#2F2F2E] mb-4">By category (verified products)</h2>}
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
            <h2 className="text-xl font-bold text-[#2F2F2E] mb-4">Biggest differences on verified products</h2>
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

        {/* Not verified as identical: individual prices only, never ranked */}
        {mx.unverified.length > 0 && (
          <section className="mb-10" aria-labelledby="unverified-heading">
            <h2 id="unverified-heading" className="text-xl font-bold text-[#2F2F2E] mb-1">Other products at both stores</h2>
            <p className="text-sm text-[#5c5b5b] mb-4">Each store’s own product and current price. These are not verified as the identical product (or are a different product or pack), so they are not used to say which store is cheaper.</p>
            <div className="bg-white rounded-2xl divide-y divide-[#F3F0EF]" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
              {mx.unverified.slice(0, 60).map(p => (
                <div key={p.name} className="px-4 py-3 grid gap-1 sm:grid-cols-[1fr_1fr_1fr] sm:items-center text-sm">
                  <div><div className="font-medium text-[#2F2F2E]">{p.name}</div><div className="text-xs text-[#5c675f]">{p.category}</div></div>
                  <div className="text-xs text-[#455049]"><strong style={{ color: infoA.color }}>{infoA.name.split(' ')[0]} {fmt(p.a.price)}</strong> · {p.a.title}{p.a.label ? ` · ${p.a.label}` : ''}</div>
                  <div className="text-xs text-[#455049]"><strong style={{ color: infoB.color }}>{infoB.name.split(' ')[0]} {fmt(p.b.price)}</strong> · {p.b.title}{p.b.label ? ` · ${p.b.label}` : ''}</div>
                </div>
              ))}
            </div>
            {mx.unverified.length > 60 && <p className="mt-2 text-xs text-[#5c675f]">Showing 60 of {mx.unverified.length}.</p>}
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

        {/* AI agent CTA */}
        <div className="rounded-2xl p-6 text-center" style={{ background: '#EAE7E7' }}>
          <div className="text-2xl mb-2">🛒</div>
          <h3 className="font-bold text-[#2F2F2E] mb-1">Let your AI agent handle this →</h3>
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
          description: `Live prices for ${shared.length} grocery products at ${infoA.name} and ${infoB.name} in Ireland; ${verifiedCount} verified as identical at both.`,
          url: `${BASE_URL}/compare/${slug}`,
        }) }} />
      </main>
      <SiteFooter />
    </div>
  );
}
