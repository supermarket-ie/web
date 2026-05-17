import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { supabaseAdmin } from '@/lib/supabase';

export const revalidate = 43200; // 12h — matches scrape cycle

export const metadata: Metadata = {
  title: 'Supermarket Deals & Offers This Week Ireland | supermarket.ie',
  description: 'This week\'s best grocery deals and offers across Tesco, Dunnes Stores, SuperValu and Aldi in Ireland. Updated twice weekly with live promotion data.',
  keywords: ['supermarket deals Ireland', 'Tesco deals this week', 'Dunnes offers this week', 'SuperValu offers', 'grocery offers Ireland', 'best supermarket deals Ireland'],
  openGraph: {
    title: 'Supermarket Deals & Offers This Week — Ireland',
    description: 'Live grocery offers across Tesco, Dunnes, SuperValu & Aldi. Updated twice weekly.',
  },
};

const STORE_INFO: Record<string, { name: string; color: string; light: string }> = {
  tesco:     { name: 'Tesco',         color: '#003A8C', light: '#EEF3FB' },
  dunnes:    { name: 'Dunnes Stores', color: '#7B0017', light: '#FAEAEC' },
  supervalu: { name: 'SuperValu',     color: '#D4400F', light: '#FEF0E8' },
  aldi:      { name: 'Aldi',          color: '#00447C', light: '#EDF3FA' },
};

const STORE_ORDER = ['tesco', 'dunnes', 'supervalu', 'aldi'];

type Deal = {
  canonical_name: string;
  category: string;
  store: string;
  price: number;
  was_price: number | null;
  store_product_name: string;
};

function fmt(n: number) { return `€${n.toFixed(2)}`; }
function pct(was: number, now: number) { return Math.round(((was - now) / was) * 100); }

async function getDeals(): Promise<Deal[]> {
  // Get all current promotions with product info
  // Paginate to get everything
  let allRows: Deal[] = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const { data } = await supabaseAdmin
      .from('price_observations')
      .select('price, was_price, store_product_id, store_products!inner(store, store_product_name, products!inner(canonical_name, category))')
      .eq('on_promotion', true)
      .order('observed_at', { ascending: false })
      .range(offset, offset + PAGE - 1);

    if (!data || data.length === 0) break;

    for (const row of data) {
      const sp = row.store_products as unknown as { store: string; store_product_name: string; products: { canonical_name: string; category: string } };
      allRows.push({
        canonical_name: sp.products.canonical_name,
        category: sp.products.category,
        store: sp.store,
        price: row.price,
        was_price: row.was_price,
        store_product_name: sp.store_product_name,
      });
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // Deduplicate: keep latest per (canonical_name, store)
  const seen = new Map<string, Deal>();
  for (const deal of allRows) {
    const key = `${deal.canonical_name}::${deal.store}`;
    if (!seen.has(key)) seen.set(key, deal);
  }

  return Array.from(seen.values());
}

export default async function DealsPage() {
  const deals = await getDeals();

  // Group by store
  const byStore = new Map<string, Deal[]>();
  for (const deal of deals) {
    if (!byStore.has(deal.store)) byStore.set(deal.store, []);
    byStore.get(deal.store)!.push(deal);
  }

  // Group by category (across all stores)
  const byCategory = new Map<string, Deal[]>();
  for (const deal of deals) {
    if (!byCategory.has(deal.category)) byCategory.set(deal.category, []);
    byCategory.get(deal.category)!.push(deal);
  }

  // Sort categories by deal count
  const sortedCategories = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

  // Top deals: biggest savings (need was_price)
  const withSavings = deals
    .filter(d => d.was_price && d.was_price > d.price)
    .map(d => ({ ...d, saving: d.was_price! - d.price, pctOff: pct(d.was_price!, d.price) }))
    .sort((a, b) => b.pctOff - a.pctOff);

  const topDeals = withSavings.slice(0, 12);

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 pb-16">
        {/* Breadcrumb */}
        <nav className="pt-6 pb-2 text-xs text-[#B2BEC3]">
          <Link href="/" className="hover:text-[#5c5b5b]">Home</Link>
          {' · '}
          <span className="text-[#5c5b5b]">Deals & Offers</span>
        </nav>

        {/* Hero */}
        <div className="pt-4 pb-8">
          <h1 className="text-3xl font-bold text-[#2F2F2E] mb-2">
            🏷️ Supermarket Deals This Week
          </h1>
          <p className="text-[#5c5b5b] max-w-2xl">
            Live offers across Tesco, Dunnes Stores, SuperValu and Aldi in Ireland. 
            Updated twice weekly from real store data — {deals.length} deals right now.
          </p>
        </div>

        {/* Store summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          {STORE_ORDER.filter(s => byStore.has(s)).map(store => {
            const info = STORE_INFO[store];
            const storeDeals = byStore.get(store)!;
            const withWas = storeDeals.filter(d => d.was_price && d.was_price > d.price);
            return (
              <a key={store} href={`#${store}`} className="rounded-xl p-4 border-2 transition hover:shadow-md"
                style={{ borderColor: info.color, background: info.light }}>
                <div className="text-xs font-bold mb-1" style={{ color: info.color }}>{info.name}</div>
                <div className="text-2xl font-bold" style={{ color: info.color }}>{storeDeals.length}</div>
                <div className="text-xs text-[#5c5b5b]">
                  deals{withWas.length > 0 ? ` · ${withWas.length} with savings` : ''}
                </div>
              </a>
            );
          })}
        </div>

        {/* Top deals — biggest % off */}
        {topDeals.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xl font-bold text-[#2F2F2E] mb-4">🔥 Biggest Savings</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topDeals.map((deal, i) => {
                const info = STORE_INFO[deal.store];
                return (
                  <div key={`${deal.canonical_name}-${deal.store}-${i}`}
                    className="bg-white rounded-xl p-4 border"
                    style={{ borderColor: 'rgba(175,173,172,0.2)' }}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: info.color }}>
                        {info.name.split(' ')[0]}
                      </span>
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-[#004a23]" style={{ background: '#6BFE9C' }}>
                        {deal.pctOff}% off
                      </span>
                    </div>
                    <div className="text-sm font-medium text-[#2F2F2E] mb-1">{deal.canonical_name}</div>
                    <div className="text-xs text-[#B2BEC3] mb-2">{deal.category}</div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-bold text-[#2F2F2E]">{fmt(deal.price)}</span>
                      <span className="text-sm text-[#B2BEC3] line-through">{fmt(deal.was_price!)}</span>
                      <span className="text-xs font-semibold text-[#006A35]">Save {fmt(deal.saving)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Deals by store */}
        {STORE_ORDER.filter(s => byStore.has(s)).map(store => {
          const info = STORE_INFO[store];
          const storeDeals = byStore.get(store)!;

          // Group by category within store
          const storeCats = new Map<string, Deal[]>();
          for (const d of storeDeals) {
            if (!storeCats.has(d.category)) storeCats.set(d.category, []);
            storeCats.get(d.category)!.push(d);
          }
          const sortedCats = [...storeCats.entries()].sort((a, b) => b[1].length - a[1].length);

          return (
            <section key={store} id={store} className="mb-12 scroll-mt-20">
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xl font-bold" style={{ color: info.color }}>{info.name} Deals</h2>
                <span className="text-sm text-[#B2BEC3]">{storeDeals.length} offers</span>
              </div>

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
            </section>
          );
        })}

        {/* CTA */}
        <div className="rounded-2xl p-6 text-center mb-10" style={{ background: '#EAE7E7' }}>
          <div className="text-2xl mb-2">🛒</div>
          <h3 className="font-bold text-[#2F2F2E] mb-1">Build a shopping list around this week&apos;s deals</h3>
          <p className="text-sm text-[#5c5b5b] mb-4">
            Our AI planner uses live promotion data to find you the cheapest meals and ingredients across all stores.
          </p>
          <Link href="/"
            className="inline-block px-6 py-3 rounded-full font-semibold transition text-white"
            style={{ background: 'linear-gradient(135deg, #006A35, #00944A)' }}>
            Try the AI planner free →
          </Link>
        </div>

        {/* Schema.org for SEO */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: 'Supermarket Deals & Offers This Week — Ireland',
          description: `${deals.length} live grocery deals across Irish supermarkets. Updated twice weekly.`,
          url: 'https://supermarket.ie/deals',
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: deals.length,
            itemListElement: topDeals.slice(0, 5).map((d, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              item: {
                '@type': 'Offer',
                name: d.canonical_name,
                price: d.price,
                priceCurrency: 'EUR',
                seller: { '@type': 'Organization', name: STORE_INFO[d.store].name },
              },
            })),
          },
        }) }} />
      </main>

      <SiteFooter />
    </div>
  );
}
