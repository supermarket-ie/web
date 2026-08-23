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
  // Paginate price observations to get all data
  let priceRows: { price: number; observed_at: string; store_products: unknown }[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data } = await supabaseAdmin
      .from('price_observations')
      .select('price, observed_at, store_products(store, products(canonical_name, category))')
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

  const MAIN_3: StoreKey[] = ['tesco', 'dunnes', 'supervalu'];
  
  // Filter to products available in all 3 main stores
  for (const [name, { stores }] of byProduct) {
    if (!MAIN_3.every(s => stores.has(s))) {
      byProduct.delete(name);
    }
  }

  // Only compare stores across the same matched product set. Aldi currently has
  // useful live evidence, but not equivalent catalogue coverage on this page;
  // including its partial totals would produce a misleading "cheapest" claim.
  const activeStores = MAIN_3;
  const products: EvidenceProduct[] = [];
  for (const [name, { category, stores }] of byProduct) {
    if (!EVIDENCE_CATEGORIES.includes(category)) continue;
    products.push({ name, category, prices: Object.fromEntries(stores) });
  }

  // Put familiar household staples first, while keeping the visible examples
  // varied. Prefer mappings that identify a pack size so the visible evidence
  // is more useful than a broad product-family comparison.
  const staplePattern = /milk|bread|butter|egg|chicken|beef|banana|apple|potato|pasta|rice|coffee|tea/i;
  const packSizePattern = /\b\d+(?:\.\d+)?\s?(?:g|kg|ml|l|pack|pk)\b/i;
  products.sort((a, b) => {
    const packSizeDifference = Number(packSizePattern.test(b.name)) - Number(packSizePattern.test(a.name));
    if (packSizeDifference) return packSizeDifference;
    const stapleDifference = Number(staplePattern.test(b.name)) - Number(staplePattern.test(a.name));
    if (stapleDifference) return stapleDifference;
    return a.name.length - b.name.length || a.name.localeCompare(b.name);
  });

  const featured: EvidenceProduct[] = [];
  for (const category of EVIDENCE_CATEGORIES) {
    const candidate = products.find(product => product.category === category && !featured.includes(product));
    if (candidate) featured.push(candidate);
    if (featured.length === 6) break;
  }
  for (const product of products) {
    if (featured.length === 6) break;
    if (!featured.includes(product)) featured.push(product);
  }

  const moreEvidence = products.filter(product => !featured.includes(product)).slice(0, 18);
  const latestObservation = priceRows[0]?.observed_at ?? null;

  return {
    overallCount: products.length,
    featured,
    moreEvidence,
    activeStores,
    latestObservation,
  };
}

export default async function ComparePage() {
  const data = await getComparisonData();
  if (!data) return <div>Loading...</div>;

  const { overallCount, featured, moreEvidence, activeStores, latestObservation } = data;

  const updatedLabel = latestObservation
    ? new Date(latestObservation).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'recently';

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

        {/* Compact, indexable evidence of the data available to the agent. */}
        <section className="mb-10 border-t border-[#e3e8e4] pt-9" aria-labelledby="catalogue-evidence-heading">
        <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#397250]">Grounded in current data</p>
            <h2 id="catalogue-evidence-heading" className="text-2xl font-extrabold tracking-[-0.035em] text-[#152219]">What the agent currently understands</h2>
          </div>
          <p className="max-w-xl text-sm leading-6 text-[#667169]">Examples from {overallCount} products matched across {storeNames}. Prices are evidence the agent can use alongside pack size, preferences, meals and budget.</p>
        </div>
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
