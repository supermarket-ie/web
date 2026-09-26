import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { ShopBuilder } from '@/components/ShopBuilder';
import { getAllLatestPrices } from '@/lib/price-data';
import { buildShopCatalogue } from '@/lib/shop-builder-catalogue';
import { EXAMPLE_WEEKLY_ITEMS } from '@/lib/weekly-shop';

export const revalidate = 1800;

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

const EVIDENCE_CATEGORIES = [
  'Dairy', 'Bakery', 'Meat', 'Fruit', 'Vegetables',
  'Breakfast', 'Pasta & Rice', 'Tinned', 'Beverages', 'Snacks',
  'Condiments', 'Fish', 'Baking', 'Frozen',
];

type EvidenceProduct = {
  name: string;
  category: string;
  prices: Record<string, number>;
};

async function getComparisonData() {
  // This page only needs the current trusted retailer price for each mapped
  // product/store. Reading the historical observations table here previously
  // paginated the full observation history during static generation and could
  // push Vercel builds over the 60-second page timeout.
  const priceRows = await getAllLatestPrices();
  const catalogue = buildShopCatalogue(priceRows);
  const catalogueById = new Map(catalogue.map(product => [product.id, product]));
  const suggestions = [0, 3, 6, 10, 11, 16].map(index => catalogueById.get(EXAMPLE_WEEKLY_ITEMS[index].id)).filter(product => product !== undefined);

  const byProduct = new Map<string, { category: string; stores: Map<string, number> }>();
  for (const product of catalogue) {
    byProduct.set(product.id, { category: product.category, stores: new Map(Object.entries(product.offers).map(([store, offer]) => [store, offer.price])) });
  }

  const MAIN_3: StoreKey[] = ['tesco', 'dunnes', 'supervalu'];

  for (const [name, { stores }] of byProduct) {
    if (!MAIN_3.every(s => stores.has(s))) byProduct.delete(name);
  }

  const activeStores = MAIN_3;
  const products: EvidenceProduct[] = [];
  for (const [id, { category, stores }] of byProduct) {
    if (!EVIDENCE_CATEGORIES.includes(category)) continue;
    products.push({ name: catalogueById.get(id)!.name, category, prices: Object.fromEntries(stores) });
  }

  const staplePattern = /milk|bread|butter|egg|chicken|beef|banana|apple|potato|pasta|rice|coffee|tea/i;
  const packSizePattern = /\b\d+(?:\.\d+)?\s?(?:g|kg|ml|l|pack|pk)\b/i;
  products.sort((a, b) => {
    const packSizeDifference = Number(packSizePattern.test(b.name)) - Number(packSizePattern.test(a.name));
    if (packSizeDifference) return packSizeDifference;
    const stapleDifference = Number(staplePattern.test(b.name)) - Number(staplePattern.test(a.name));
    if (stapleDifference) return stapleDifference;
    return a.name.length - b.name.length || a.name.localeCompare(b.name);
  });

  const displayProducts = products.filter(product => {
    const prices = activeStores.map(store => product.prices[store]).filter(Boolean);
    const lowest = Math.min(...prices);
    const highest = Math.max(...prices);
    return prices.length === activeStores.length && highest / lowest <= 1.6;
  });

  const featured: EvidenceProduct[] = [];
  for (const category of EVIDENCE_CATEGORIES) {
    const candidate = displayProducts.find(product => product.category === category && !featured.includes(product));
    if (candidate) featured.push(candidate);
    if (featured.length === 6) break;
  }
  for (const product of displayProducts) {
    if (featured.length === 6) break;
    if (!featured.includes(product)) featured.push(product);
  }

  const moreEvidence = displayProducts.filter(product => !featured.includes(product)).slice(0, 18);
  const latestObservation = priceRows.reduce<string | null>((latest, row) => {
    if (!row.observed_at) return latest;
    if (!latest || Date.parse(row.observed_at) > Date.parse(latest)) return row.observed_at;
    return latest;
  }, null);

  return { featured, moreEvidence, activeStores, latestObservation, suggestions };
}

export default async function ComparePage() {
  const data = await getComparisonData();

  const { featured, moreEvidence, activeStores, latestObservation, suggestions } = data;

  const updatedLabel = latestObservation
    ? new Date(latestObservation).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'recently';

  const storeNames = activeStores.map(s => STORE_INFO[s].name).join(', ').replace(/, ([^,]+)$/, ' & $1');

  return (
    <div className="min-h-screen bg-[#f8faf8]">
      <SiteHeader />

      <main className="max-w-6xl mx-auto px-6 pb-16">
        <div className="pt-8 pb-7 sm:pt-10">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#e5f7eb] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#397250]">Irish supermarket prices, shaped around your shop</div>
          <h1 className="mb-4 max-w-4xl text-balance text-[clamp(2rem,4vw,3.25rem)] font-extrabold leading-[1.06] tracking-[-0.045em] text-[#152219]">
            Your supermarket shopping agent for Ireland
          </h1>
          <p className="max-w-2xl text-base leading-7 text-[#667169] sm:text-lg">
            Build your own shopping list using current matched prices from {storeNames}. Your agent can turn it into a household shop with your quantities, budget and preferences.
          </p>
          <p className="mt-3 text-xs font-medium text-[#8b958e]">Current price observations across {storeNames} · Updated {updatedLabel}</p>
        </div>

        <div className="mb-10">
          <ShopBuilder suggestions={suggestions} />
        </div>

        <section className="mb-10 border-t border-[#e3e8e4] pt-9" aria-label="Current supermarket price evidence">
        <p className="mb-5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#397250]">Grounded in current data</p>
        <h2 className="mb-3 text-2xl font-semibold tracking-tight text-[#173525]">Supermarket price comparison in Ireland</h2>
        <p className="mb-5 max-w-3xl text-sm leading-6 text-[#607065]">These currently matched products have prices at all three supermarkets. Your own shop may have different coverage. Compare the exact retailer product, pack size and date before deciding what works for you.</p>
        {!featured.length && <p className="mb-5 text-sm text-[#607065]">There are no current three-store examples to display. You can still describe your shopping needs above.</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map(product => (
            <article key={product.name} className="rounded-[1.25rem] border border-[#e3e8e4] bg-white p-4 shadow-[0_10px_35px_rgba(25,57,38,0.035)]">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7d8980]">{product.category}</p>
              <h3 className="mt-1 min-h-10 text-sm font-semibold leading-5 text-[#253128]">{product.name}</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {activeStores.map(store => (
                  <span key={store} className="rounded-full bg-[#f2f5f2] px-2.5 py-1 text-[11px] text-[#59645c]">
                    {STORE_INFO[store].name.split(' ')[0]} <strong className="text-[#253128]">{fmt(product.prices[store])}</strong>
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>

        {moreEvidence.length > 0 && (
          <details className="group mt-4 rounded-[1.25rem] border border-[#e3e8e4] bg-white">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-[#354139] marker:content-none">
              <span className="flex items-center justify-between gap-4">
                View more current price evidence
                <span aria-hidden="true" className="text-lg font-normal text-[#718077] transition group-open:rotate-45">+</span>
              </span>
            </summary>
            <div className="border-t border-[#edf0ed] px-5 py-2">
              {moreEvidence.map(product => (
                <div key={product.name} className="flex flex-col gap-2 border-b border-[#edf0ed] py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#354139]">{product.name}</p>
                    <p className="text-[11px] text-[#8b958e]">{product.category} · tracked at {storeNames}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#667169]">
                    {activeStores.map(store => (
                      <span key={store}>{STORE_INFO[store].name.split(' ')[0]} <strong className="text-[#354139]">{fmt(product.prices[store])}</strong></span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
        <p className="mt-3 text-xs text-[#8b958e]">Latest catalogue observation: {updatedLabel}. Prices can change; the agent checks current evidence when helping with a shop.</p>
        </section>

        <section aria-labelledby="comparison-guide-title" className="mb-10 grid gap-6 border-t border-[#e3e8e4] pt-8 sm:grid-cols-2">
          <div>
            <h2 id="comparison-guide-title" className="text-xl font-semibold text-[#173525]">Which supermarket is cheapest for your shop?</h2>
            <p className="mt-3 text-sm leading-6 text-[#607065]">It depends on the products and quantities you buy. Build your list above to see each retailer’s coverage and subtotal. A total is only complete when every selected product has a current matched price; partial subtotals cannot establish the cheapest complete shop.</p>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[#173525]">What is included in these prices?</h2>
            <p className="mt-3 text-sm leading-6 text-[#607065]">We display tracked Tesco, Dunnes Stores and SuperValu prices with the retailer product names and observation dates. Missing prices do not mean a product is out of stock. Delivery fees, vouchers and unverified loyalty discounts are excluded; confirm the final price with the retailer.</p>
          </div>
          <p className="text-sm text-[#397250] sm:col-span-2">Planning a full week? Explore the <Link href="/cost-of-weekly-shop-ireland" className="font-semibold underline underline-offset-4">weekly-shop cost guide and editable example</Link>, or browse <Link href="/shop" className="font-semibold underline underline-offset-4">household products</Link>.</p>
        </section>

        <div className="rounded-[1.75rem] bg-[#0e0e0e] p-8 text-center text-white">
          <div className="text-3xl mb-3">🛒</div>
          <h2 className="mb-2 text-xl font-bold">Make Supermarket.ie your household agent</h2>
          <p className="mx-auto mb-5 max-w-md text-white/65">
            Ask it to prepare a shop, remember what matters to your household, save a list or monitor a product for a useful change.
          </p>
          <a href="#build-your-shop"
            className="inline-block px-8 py-3.5 rounded-full font-semibold text-base transition text-[#004a23]"
            style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
            Build my household shop ↑
          </a>
          <p className="mt-3 text-xs text-white/40">No signup required to get started</p>
        </div>

      </main>

      <SiteFooter />
    </div>
  );
}
