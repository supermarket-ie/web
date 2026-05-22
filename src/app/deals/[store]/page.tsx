import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { getAllLatestPrices, STORE_INFO, fmt, pct, type StoreKey } from '@/lib/price-data';

export const revalidate = 43200; // 12h

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://supermarket.ie';

const VALID_STORES: StoreKey[] = ['tesco', 'dunnes', 'supervalu', 'aldi'];

export async function generateStaticParams() {
  return VALID_STORES.map(store => ({ store }));
}

export async function generateMetadata({ params }: { params: Promise<{ store: string }> }): Promise<Metadata> {
  const { store } = await params;
  const info = STORE_INFO[store as StoreKey];
  if (!info) return {};
  return {
    title: `${info.name} Deals & Offers This Week Ireland | supermarket.ie`,
    description: `This week's ${info.name} deals and special offers in Ireland. Live promotion data updated twice weekly — see every current offer at ${info.name}.`,
    keywords: [`${info.name} deals this week`, `${info.name} offers Ireland`, `${info.name} promotions`, `${info.name} special offers this week Ireland`],
    alternates: { canonical: `${BASE_URL}/deals/${store}` },
    openGraph: {
      title: `${info.name} Deals & Offers This Week — Ireland`,
      description: `Live ${info.name} offers updated twice weekly.`,
    },
  };
}

export default async function StoreDealsPage({ params }: { params: Promise<{ store: string }> }) {
  const { store } = await params;
  if (!VALID_STORES.includes(store as StoreKey)) notFound();

  const storeKey = store as StoreKey;
  const info = STORE_INFO[storeKey];

  const allPrices = await getAllLatestPrices();
  const storeDeals = allPrices.filter(p => p.store === storeKey && p.on_promotion);

  const byCategory = new Map<string, typeof storeDeals>();
  for (const deal of storeDeals) {
    if (!byCategory.has(deal.category)) byCategory.set(deal.category, []);
    byCategory.get(deal.category)!.push(deal);
  }
  const sortedCats = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

  const withSavings = storeDeals
    .filter(d => d.was_price && d.was_price > d.price)
    .map(d => ({ ...d, saving: d.was_price! - d.price, pctOff: pct(d.was_price!, d.price) }))
    .sort((a, b) => b.pctOff - a.pctOff);

  const topSavings = withSavings.slice(0, 8);

  const updatedLabel = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

  const otherStores = VALID_STORES.filter(s => s !== storeKey);

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-6 pb-16">
        <Breadcrumbs items={[
          { label: 'Deals', href: '/deals' },
          { label: `${info.name} Deals`, href: `/deals/${store}` },
        ]} />

        {/* Hero */}
        <div className="pt-4 pb-8">
          <h1 className="text-3xl font-bold text-[#2F2F2E] mb-2">
            🏷️ {info.name} Deals This Week
          </h1>
          <p className="text-[#5c5b5b] max-w-2xl">
            {storeDeals.length} current offers at {info.name} in Ireland.
            {withSavings.length > 0 ? ` ${withSavings.length} with confirmed savings.` : ''}
            {' '}Updated {updatedLabel}.
          </p>
        </div>

        {/* Summary banner */}
        <div className="rounded-2xl p-5 mb-8 text-white" style={{ background: info.color }}>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-3xl font-bold">{storeDeals.length}</div>
              <div className="text-sm opacity-80">Offers</div>
            </div>
            <div>
              <div className="text-3xl font-bold">{sortedCats.length}</div>
              <div className="text-sm opacity-80">Categories</div>
            </div>
            <div>
              <div className="text-3xl font-bold">{withSavings.length}</div>
              <div className="text-sm opacity-80">With savings</div>
            </div>
          </div>
        </div>

        {/* Top savings */}
        {topSavings.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-bold text-[#2F2F2E] mb-4">🔥 Best Savings at {info.name}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {topSavings.map((deal, i) => (
                <div key={`${deal.canonical_name}-${i}`} className="bg-white rounded-xl p-4 border" style={{ borderColor: 'rgba(175,173,172,0.2)' }}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-xs text-[#B2BEC3]">{deal.category}</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-[#004a23]" style={{ background: '#6BFE9C' }}>
                      {deal.pctOff}% off
                    </span>
                  </div>
                  <div className="text-sm font-medium text-[#2F2F2E] mb-2">{deal.canonical_name}</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-[#2F2F2E]">{fmt(deal.price)}</span>
                    <span className="text-sm text-[#B2BEC3] line-through">{fmt(deal.was_price!)}</span>
                    <span className="text-xs font-semibold text-[#006A35]">Save {fmt(deal.saving)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* All deals by category */}
        <h2 className="text-xl font-bold text-[#2F2F2E] mb-4">All {info.name} Offers</h2>
        {sortedCats.map(([cat, catDeals]) => (
          <div key={cat} className="mb-6">
            <h3 className="text-sm font-bold text-[#5c5b5b] uppercase tracking-wide mb-2">{cat} ({catDeals.length})</h3>
            <div className="bg-white rounded-xl divide-y divide-[#F3F0EF]" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
              {catDeals.sort((a, b) => a.price - b.price).map((deal, i) => (
                <div key={`${deal.canonical_name}-${i}`} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#2F2F2E]">{deal.canonical_name}</span>
                      {deal.was_price && deal.was_price > deal.price && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md text-[#004a23]" style={{ background: '#6BFE9C' }}>
                          {pct(deal.was_price, deal.price)}% off
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 flex items-baseline gap-2">
                    <span className="text-sm font-bold text-[#2F2F2E]">{fmt(deal.price)}</span>
                    {deal.was_price && deal.was_price > deal.price && (
                      <span className="text-xs text-[#B2BEC3] line-through">{fmt(deal.was_price)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {storeDeals.length === 0 && (
          <div className="bg-white rounded-2xl p-8 text-center text-[#5c5b5b] mb-8" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
            <p className="text-lg mb-2">No current offers</p>
            <p className="text-sm">Check back after our next price update for {info.name} deals.</p>
          </div>
        )}

        {/* Other store deals */}
        <h2 className="text-lg font-bold text-[#2F2F2E] mb-4 mt-10">Deals at other stores</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
          {otherStores.map(s => {
            const sInfo = STORE_INFO[s];
            return (
              <Link key={s} href={`/deals/${s}`}
                className="bg-white rounded-xl p-4 border border-[rgba(175,173,172,0.2)] hover:shadow-sm transition flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: sInfo.color }}>{sInfo.name}</span>
                <span className="text-xs text-[#006A35]">View deals →</span>
              </Link>
            );
          })}
        </div>

        {/* AI agent CTA */}
        <div className="rounded-2xl p-6 text-center" style={{ background: '#EAE7E7' }}>
          <div className="text-2xl mb-2">🛒</div>
          <h3 className="font-bold text-[#2F2F2E] mb-1">Let your AI agent handle this →</h3>
          <p className="text-sm text-[#5c5b5b] mb-4">
            Our AI planner uses live offer data to find you the cheapest meals and ingredients.
          </p>
          <Link href="/"
            className="inline-block px-6 py-3 rounded-full font-semibold transition text-white"
            style={{ background: 'linear-gradient(135deg, #006A35, #00944A)' }}>
            Try the AI planner free →
          </Link>
        </div>

        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: `${info.name} Deals & Offers This Week — Ireland`,
          description: `${storeDeals.length} current ${info.name} offers in Ireland.`,
          url: `${BASE_URL}/deals/${store}`,
        }) }} />
      </main>
      <SiteFooter />
    </div>
  );
}
