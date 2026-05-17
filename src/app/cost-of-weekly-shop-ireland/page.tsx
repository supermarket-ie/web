import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { getAllLatestPrices, groupByProduct, STORE_INFO, ALL_STORES, fmt, type StoreKey } from '@/lib/price-data';

export const revalidate = 43200; // 12h

export const metadata: Metadata = {
  title: 'Cost of a Weekly Shop in Ireland 2026 — Tesco, Dunnes, SuperValu, Aldi | supermarket.ie',
  description: 'How much does a weekly grocery shop cost in Ireland? Live prices from Tesco, Dunnes Stores, SuperValu and Aldi compared. See which supermarket is cheapest for a typical Irish weekly shop.',
  keywords: ['cost of weekly shop Ireland', 'how much is a weekly shop in Ireland', 'cheapest weekly shop Ireland', 'grocery prices Ireland 2026', 'average weekly grocery spend Ireland'],
  openGraph: {
    title: 'Cost of a Weekly Shop in Ireland — Which Store is Cheapest?',
    description: 'Real basket costs compared across Tesco, Dunnes, SuperValu & Aldi. Updated twice weekly.',
  },
};

// A "standard weekly basket" — common items most Irish households buy
const BASKET_ITEMS = [
  // Dairy
  'Whole Milk 2L', 'Kerrygold Pure Irish Butter 227g', 'Mature Cheddar Cheese 200g',
  'Free Range Eggs 10 Pack', 'Natural Yoghurt 500g',
  // Bakery
  'White Sliced Pan 800g', 'Wholemeal Bread 800g',
  // Meat
  'Chicken Breast Fillets 500g', 'Beef Mince 500g', 'Pork Sausages 454g',
  // Fruit & Veg
  'Bananas 5 Pack', 'Braeburn Apples 6 Pack', 'Carrots 1kg', 'Onions 1kg',
  'Rooster Potatoes 2kg', 'Iceberg Lettuce',
  // Staples
  'Penne Pasta 500g', 'Basmati Rice 1kg', 'Chopped Tomatoes 400g', 'Baked Beans 420g',
  // Beverages
  'Barry\'s Tea 80 Bags', 'Nescafé Gold Blend Coffee 100g',
  // Household
  'Fairy Washing Up Liquid 900ml',
  // Breakfast
  'Flahavan\'s Porridge Oats 1kg',
];

export default async function WeeklyShopCostPage() {
  const allPrices = await getAllLatestPrices();
  const byProduct = groupByProduct(allPrices);

  // Match basket items to our product data (fuzzy: check if canonical_name contains the basket item or vice versa)
  const basketResults: { item: string; stores: Record<string, number> }[] = [];
  const storeTotals: Record<string, number> = {};
  const storeItemCounts: Record<string, number> = {};
  for (const s of ALL_STORES) {
    storeTotals[s] = 0;
    storeItemCounts[s] = 0;
  }

  for (const basketItem of BASKET_ITEMS) {
    const lower = basketItem.toLowerCase();
    // Find exact or close match
    let match: { category: string; stores: Map<string, { price: number; on_promotion: boolean; was_price: number | null }> } | null = null;

    // Try exact match first
    if (byProduct.has(basketItem)) {
      match = byProduct.get(basketItem)!;
    } else {
      // Fuzzy: find closest
      for (const [name, data] of byProduct) {
        if (name.toLowerCase() === lower || name.toLowerCase().includes(lower) || lower.includes(name.toLowerCase())) {
          match = data;
          break;
        }
      }
    }

    if (match) {
      const prices: Record<string, number> = {};
      for (const [store, { price }] of match.stores) {
        prices[store] = price;
        storeTotals[store] += price;
        storeItemCounts[store]++;
      }
      basketResults.push({ item: basketItem, stores: prices });
    }
  }

  // Only show stores with reasonable coverage (at least 40% of basket)
  const minItems = Math.floor(BASKET_ITEMS.length * 0.4);
  const activeStores = ALL_STORES.filter(s => storeItemCounts[s] >= minItems);
  const ranked = [...activeStores].sort((a, b) => storeTotals[a] - storeTotals[b]);
  const cheapest = ranked[0];

  const updatedLabel = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />
      <main className="max-w-6xl mx-auto px-6 pb-16">
        {/* Breadcrumb */}
        <nav className="pt-6 pb-2 text-xs text-[#B2BEC3]">
          <Link href="/" className="hover:text-[#5c5b5b]">Home</Link>
          {' · '}
          <span className="text-[#5c5b5b]">Cost of Weekly Shop</span>
        </nav>

        {/* Hero */}
        <div className="pt-4 pb-8">
          <h1 className="text-3xl font-bold text-[#2F2F2E] mb-2">
            How Much Does a Weekly Shop Cost in Ireland?
          </h1>
          <p className="text-[#5c5b5b] max-w-2xl">
            We priced a standard {BASKET_ITEMS.length}-item Irish weekly basket across {activeStores.length} supermarkets
            using live data. Last updated {updatedLabel}.
          </p>
        </div>

        {/* Store totals */}
        {cheapest && (
          <div className="rounded-2xl p-6 mb-6 text-white" style={{ background: STORE_INFO[cheapest].color }}>
            <div className="text-sm opacity-80 mb-1">Cheapest for a standard weekly shop</div>
            <div className="text-3xl font-bold mb-1">{STORE_INFO[cheapest].name}</div>
            <div className="text-lg opacity-90">
              {fmt(storeTotals[cheapest])} for {storeItemCounts[cheapest]} of {BASKET_ITEMS.length} items
            </div>
          </div>
        )}

        <div className={`grid gap-3 mb-10`} style={{ gridTemplateColumns: `repeat(${Math.min(ranked.length, 4)}, minmax(0, 1fr))` }}>
          {ranked.map((store, i) => {
            const info = STORE_INFO[store];
            const isCheapest = i === 0;
            const diff = storeTotals[store] - storeTotals[ranked[0]];
            return (
              <div key={store} className="rounded-xl p-4 border-2 text-center" style={{
                borderColor: isCheapest ? info.color : 'rgba(175,173,172,0.2)',
                background: isCheapest ? info.light : '#fff'
              }}>
                <div className="text-xs font-bold mb-1" style={{ color: info.color }}>{info.name}</div>
                <div className="text-2xl font-bold" style={{ color: info.color }}>{fmt(storeTotals[store])}</div>
                <div className="text-xs text-[#B2BEC3] mt-1">
                  {storeItemCounts[store]}/{BASKET_ITEMS.length} items
                  {diff > 0.01 && ` · +${fmt(diff)}`}
                </div>
                {isCheapest && (
                  <div className="mt-2 text-[10px] font-bold uppercase rounded-full px-2 py-0.5 inline-block text-white" style={{ background: info.color }}>
                    Cheapest ✓
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Basket breakdown */}
        <h2 className="text-xl font-bold text-[#2F2F2E] mb-4">Full Basket Breakdown</h2>
        <p className="text-sm text-[#5c5b5b] mb-4">
          A typical Irish weekly shop: milk, bread, chicken, veg, pasta, tea, and more.
          Green highlighting shows the cheapest store for each item.
        </p>
        <div className="bg-white rounded-2xl overflow-hidden mb-10" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
          {/* Header */}
          <div className="grid px-4 py-3 text-xs font-bold text-[#5c5b5b] border-b border-[#F3F0EF]"
            style={{ gridTemplateColumns: `1fr ${activeStores.map(() => '80px').join(' ')}` }}>
            <div>Item</div>
            {activeStores.map(s => (
              <div key={s} className="text-center" style={{ color: STORE_INFO[s].color }}>
                {STORE_INFO[s].name.split(' ')[0]}
              </div>
            ))}
          </div>
          {/* Rows */}
          {basketResults.map(({ item, stores: prices }) => {
            const storePrices = activeStores.map(s => prices[s] ?? null);
            const minPrice = Math.min(...storePrices.filter((p): p is number => p !== null));
            return (
              <div key={item} className="grid px-4 py-2.5 border-b border-[#F3F0EF] last:border-0 items-center text-sm"
                style={{ gridTemplateColumns: `1fr ${activeStores.map(() => '80px').join(' ')}` }}>
                <div className="text-[#2F2F2E] text-sm pr-2">{item}</div>
                {activeStores.map(s => {
                  const p = prices[s];
                  const isCheapest = p === minPrice && p !== undefined;
                  return (
                    <div key={s} className="text-center text-sm" style={{
                      fontWeight: isCheapest ? 700 : 400,
                      color: isCheapest ? '#006A35' : p ? '#2F2F2E' : '#D5D0CC',
                    }}>
                      {p ? fmt(p) : '—'}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {/* Totals row */}
          <div className="grid px-4 py-3 font-bold text-sm border-t-2 border-[#E8E2DC]"
            style={{ gridTemplateColumns: `1fr ${activeStores.map(() => '80px').join(' ')}`, background: '#FAFAFA' }}>
            <div className="text-[#2F2F2E]">Total</div>
            {activeStores.map(s => {
              const isCheapest = s === ranked[0];
              return (
                <div key={s} className="text-center" style={{ color: isCheapest ? '#006A35' : '#2F2F2E' }}>
                  {fmt(storeTotals[s])}
                </div>
              );
            })}
          </div>
        </div>

        {/* Methodology note */}
        <div className="rounded-xl p-4 mb-10 text-sm text-[#5c5b5b]" style={{ background: '#F3F0EF' }}>
          <strong>How we calculate this:</strong> We price {BASKET_ITEMS.length} common grocery items that a typical Irish household
          would buy weekly. Prices are scraped directly from each supermarket&apos;s website twice a week.
          Not all items are available at every store — we show which stores carry each product.
          This is a like-for-like comparison using the same or equivalent branded products.
        </div>

        {/* CTA */}
        <div className="rounded-2xl p-6 text-center" style={{ background: '#EAE7E7' }}>
          <div className="text-2xl mb-2">🛒</div>
          <h3 className="font-bold text-[#2F2F2E] mb-1">Get your personalised weekly shop cost</h3>
          <p className="text-sm text-[#5c5b5b] mb-4">
            Everyone&apos;s basket is different. Tell our AI what your household needs and get an exact price comparison.
          </p>
          <Link href="/"
            className="inline-block px-6 py-3 rounded-full font-semibold transition text-white"
            style={{ background: 'linear-gradient(135deg, #006A35, #00944A)' }}>
            Build my weekly list free →
          </Link>
        </div>

        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: 'Cost of a Weekly Shop in Ireland 2026',
          description: `Comparing the cost of a ${BASKET_ITEMS.length}-item weekly shop across Irish supermarkets with live prices.`,
          url: 'https://supermarket.ie/cost-of-weekly-shop-ireland',
        }) }} />
      </main>
      <SiteFooter />
    </div>
  );
}
