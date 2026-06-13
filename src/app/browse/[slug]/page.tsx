import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { supabaseAdmin } from '@/lib/supabase';
import { storeDisplayName } from '@/lib/store-utils';

export const revalidate = 43200; // 12h — matches scrape frequency
export const dynamicParams = true; // ISR for slugs not pre-built

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();

// ── Slug helpers ──────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Store display ─────────────────────────────────────────────────────────────

const STORE_COLOURS: Record<string, string> = {
  tesco:     '#006A35',
  dunnes:    '#6B2D8B',
  supervalu: '#E31837',
  aldi:      '#003399',
  lidl:      '#0050aa',
};

// ── Data fetching ─────────────────────────────────────────────────────────────

interface PriceRow {
  store: string;
  price: number;
  was_price: number | null;
  on_promotion: boolean;
  store_product_name: string | null;
}

async function getProduct(slug: string) {
  // Batch-fetch all products and match by slug
  let allProducts: { id: string; canonical_name: string; category: string | null; description: string | null; image_url: string | null; brand: string | null }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('id, canonical_name, category, description, image_url, brand')
      .range(from, from + 1000 - 1);
    if (error || !data || data.length === 0) break;
    allProducts = allProducts.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const product = allProducts.find(p => toSlug(p.canonical_name) === slug);
  if (!product) return null;

  // Store details + nutrition
  const { data: storeRows } = await supabaseAdmin
    .from('store_products')
    .select('store, brand, is_own_brand, store_product_name, calories_per_100, protein_per_100, carbs_per_100, fat_per_100, saturated_fat_per_100, sugar_per_100, fibre_per_100, salt_per_100')
    .eq('product_id', product.id)
    .eq('url_status', 'resolved');

  const stores = [...new Set((storeRows ?? []).map(r => r.store))];

  // Require at least Tesco + Dunnes + SuperValu for these pages
  const MAIN_STORES = ['tesco', 'dunnes', 'supervalu'];
  if (!MAIN_STORES.every(s => stores.includes(s))) return null;

  // Live prices from latest_prices view — public, no auth needed
  const { data: priceRows } = await supabaseAdmin
    .from('latest_prices')
    .select('store, price, was_price, on_promotion, store_product_name')
    .eq('canonical_name', product.canonical_name);

  const prices: PriceRow[] = (priceRows ?? []).sort((a, b) => a.price - b.price);

  // Nutrition — prefer store row with most fields populated
  const withNutrition = (storeRows ?? []).filter(r => r.calories_per_100 != null);
  const nutrition = withNutrition.sort((a, b) => {
    const score = (r: typeof a) => [r.protein_per_100, r.carbs_per_100, r.fat_per_100, r.fibre_per_100, r.salt_per_100].filter(v => v != null).length;
    return score(b) - score(a);
  })[0] ?? null;

  const BRAND_DENYLIST = new Set(['supervalu', 'tesco', 'dunnes stores', 'aldi', 'lidl', 'dunnes']);
  const resolvedBrand = product.brand ?? (storeRows ?? []).find(r => !r.is_own_brand && r.brand)?.brand ?? null;
  const brand = resolvedBrand && !BRAND_DENYLIST.has(resolvedBrand.toLowerCase()) ? resolvedBrand : null;

  return { product, stores, prices, nutrition, brand };
}

// ── Static params ─────────────────────────────────────────────────────────────

export async function generateStaticParams() {
  const MAIN_STORES = ['tesco', 'dunnes', 'supervalu'];
  const storeMap = new Map<string, Set<string>>();
  let from = 0;
  while (true) {
    const { data } = await supabaseAdmin
      .from('store_products')
      .select('product_id, store')
      .eq('url_status', 'resolved')
      .in('store', MAIN_STORES)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (!storeMap.has(row.product_id)) storeMap.set(row.product_id, new Set());
      storeMap.get(row.product_id)!.add(row.store);
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  const qualifiedIds = [...storeMap.entries()]
    .filter(([, s]) => MAIN_STORES.every(m => s.has(m)))
    .map(([id]) => id);

  if (qualifiedIds.length === 0) return [];

  const seen = new Set<string>();
  const slugs: { slug: string }[] = [];
  for (let i = 0; i < qualifiedIds.length; i += 500) {
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('canonical_name')
      .in('id', qualifiedIds.slice(i, i + 500));
    for (const p of products ?? []) {
      const s = toSlug(p.canonical_name);
      if (!seen.has(s)) { seen.add(s); slugs.push({ slug: s }); }
    }
  }
  return slugs;
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await getProduct(slug);
  if (!result) return { title: 'Product not found' };

  const { product, prices, brand } = result;
  const cheapest = prices[0];
  const cheapestStr = cheapest ? ` from €${cheapest.price.toFixed(2)} at ${storeDisplayName(cheapest.store)}` : '';
  const title = `${product.canonical_name} Price Ireland — Compare Tesco, Dunnes & SuperValu | supermarket.ie`;
  const description = `${product.canonical_name}${brand ? ` by ${brand}` : ''} prices in Ireland${cheapestStr}. Compare live prices across Tesco, Dunnes Stores, SuperValu and Aldi — updated twice weekly.`;

  return {
    title,
    description,
    keywords: [
      `${product.canonical_name} price Ireland`,
      `cheapest ${product.canonical_name} Ireland`,
      `${product.canonical_name} Tesco price`,
      `${product.canonical_name} Dunnes price`,
      `${product.canonical_name} SuperValu price`,
    ],
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/browse/${slug}`,
      ...(product.image_url ? { images: [{ url: product.image_url }] } : {}),
    },
    alternates: { canonical: `${BASE_URL}/browse/${slug}` },
  };
}

// ── Schema.org ────────────────────────────────────────────────────────────────

function productJsonLd(
  product: { canonical_name: string; category: string | null; description: string | null; image_url: string | null },
  brand: string | null,
  slug: string,
  prices: PriceRow[],
) {
  const offers = prices.map(p => ({
    '@type': 'Offer',
    price: p.price.toFixed(2),
    priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    seller: { '@type': 'Organization', name: storeDisplayName(p.store) },
    ...(p.on_promotion && p.was_price ? { priceValidUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] } : {}),
  }));

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.canonical_name,
    ...(product.description ? { description: product.description } : {}),
    ...(product.image_url ? { image: product.image_url } : {}),
    ...(product.category ? { category: product.category } : {}),
    ...(brand ? { brand: { '@type': 'Brand', name: brand } } : {}),
    url: `${BASE_URL}/browse/${slug}`,
    offers: offers.length === 1 ? offers[0] : { '@type': 'AggregateOffer', offerCount: offers.length, lowPrice: prices[0]?.price.toFixed(2), highPrice: prices[prices.length - 1]?.price.toFixed(2), priceCurrency: 'EUR', offers },
  };
}

// ── Nutrition table ───────────────────────────────────────────────────────────

function NutritionTable({ n }: { n: { calories_per_100: number | null; protein_per_100: number | null; carbs_per_100: number | null; fat_per_100: number | null; saturated_fat_per_100: number | null; sugar_per_100: number | null; fibre_per_100: number | null; salt_per_100: number | null } }) {
  const rows = [
    { label: 'Energy',              value: n.calories_per_100,       unit: 'kcal' },
    { label: 'Fat',                 value: n.fat_per_100,            unit: 'g' },
    { label: 'of which saturates',  value: n.saturated_fat_per_100,  unit: 'g', indent: true },
    { label: 'Carbohydrates',       value: n.carbs_per_100,          unit: 'g' },
    { label: 'of which sugars',     value: n.sugar_per_100,          unit: 'g', indent: true },
    { label: 'Fibre',               value: n.fibre_per_100,          unit: 'g' },
    { label: 'Protein',             value: n.protein_per_100,        unit: 'g' },
    { label: 'Salt',                value: n.salt_per_100,           unit: 'g' },
  ].filter(r => r.value != null);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden mb-6" style={{ border: '1px solid var(--surface-container)' }}>
      <div className="px-4 py-3" style={{ background: 'var(--surface-container-low)' }}>
        <h2 className="text-sm font-bold" style={{ color: 'var(--on-surface)' }}>Nutrition per 100g</h2>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--surface-container)' : undefined, background: 'var(--surface-container-lowest)' }}>
              <td className="px-4 py-2" style={{ color: 'var(--on-surface-variant)', paddingLeft: row.indent ? '2rem' : undefined }}>{row.label}</td>
              <td className="px-4 py-2 text-right font-semibold" style={{ color: 'var(--on-background)' }}>
                {typeof row.value === 'number' ? row.value.toFixed(1) : row.value}{row.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Price comparison table (server-rendered, always public) ───────────────────

function PriceTable({ prices, productName }: { prices: PriceRow[]; productName: string }) {
  if (prices.length === 0) return null;
  const cheapest = prices[0];

  return (
    <div className="mb-6">
      <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#00DCFF', textShadow: '0 0 8px rgba(0,220,255,0.3)' }}>
        Current prices
      </h2>
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--surface-container)' }}>
        {prices.map((p, i) => {
          const isCheapest = p.store === cheapest.store && p.price === cheapest.price;
          const saving = p.was_price ? (p.was_price - p.price) : null;
          return (
            <div key={p.store} className="flex items-center gap-3 px-4 py-3"
              style={{
                borderTop: i > 0 ? '1px solid var(--surface-container)' : undefined,
                background: isCheapest ? 'rgba(0,148,74,0.06)' : 'var(--surface-container-lowest)',
              }}>
              {/* Store colour dot */}
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: STORE_COLOURS[p.store] ?? '#888' }} />
              <span className="flex-1 text-sm font-medium" style={{ color: 'var(--on-surface)' }}>
                {storeDisplayName(p.store)}
              </span>
              {p.on_promotion && saving && saving > 0 && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                  Save €{saving.toFixed(2)}
                </span>
              )}
              {isCheapest && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(0,148,74,0.15)', color: '#00944A' }}>
                  Cheapest
                </span>
              )}
              <span className="text-base font-bold tabular-nums" style={{ color: 'var(--on-background)' }}>
                €{p.price.toFixed(2)}
              </span>
              {p.was_price && p.was_price > p.price && (
                <span className="text-xs line-through" style={{ color: 'var(--on-surface-variant)' }}>
                  €{p.was_price.toFixed(2)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--on-surface-variant)' }}>
        Prices updated twice weekly · Last scraped from store websites
      </p>

      {/* Planner CTA */}
      <div className="mt-4 rounded-2xl p-4"
        style={{ background: 'linear-gradient(135deg, #006A35 0%, #00944A 100%)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <p className="text-sm font-semibold mb-1" style={{ color: '#fff' }}>
          Building your weekly shop?
        </p>
        <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.8)' }}>
          Our AI planner adds {productName} and everything else you need — then picks the cheapest store for your full basket.
        </p>
        <Link href="/"
          className="inline-block px-4 py-2 rounded-lg text-sm font-bold transition-opacity hover:opacity-90"
          style={{ background: '#6BFE9C', color: '#003300' }}>
          Plan my weekly shop →
        </Link>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getProduct(slug);
  if (!result) notFound();

  const { product, stores, prices, nutrition, brand } = result;

  return (
    <>
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd(product, brand, slug, prices)) }}
      />

      <main className="max-w-2xl mx-auto px-4 pb-16 pt-6">
        {/* Breadcrumb */}
        <nav className="text-xs mb-4 flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--on-surface-variant)' }}>
          <Link href="/shop" className="hover:underline">Shop</Link>
          <span>›</span>
          {product.category && (
            <>
              <Link href={`/shop/${toSlug(product.category)}`} className="hover:underline">
                {product.category}
              </Link>
              <span>›</span>
            </>
          )}
          <span style={{ color: 'var(--on-background)' }}>{product.canonical_name}</span>
        </nav>

        {/* Product header */}
        <div className="flex gap-4 mb-6 items-start">
          {product.image_url && (
            <div className="w-24 h-24 flex-shrink-0 rounded-2xl overflow-hidden"
              style={{ background: 'var(--surface-container-low)', border: '1px solid var(--surface-container)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.image_url} alt={product.canonical_name} className="w-full h-full object-contain p-2" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold leading-tight mb-1" style={{ color: 'var(--on-background)' }}>
              {product.canonical_name}
            </h1>
            {brand && <p className="text-sm mb-1" style={{ color: 'var(--on-surface-variant)' }}>{brand}</p>}
            {product.category && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full inline-block"
                style={{ background: 'var(--surface-container)', color: 'var(--on-surface-variant)' }}>
                {product.category}
              </span>
            )}
          </div>
        </div>

        {product.description && (
          <p className="text-sm mb-5 leading-relaxed" style={{ color: 'var(--on-surface)' }}>
            {product.description}
          </p>
        )}

        {/* Live price comparison — always public, server-rendered */}
        <PriceTable prices={prices} productName={product.canonical_name} />

        {/* Available at */}
        {stores.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--on-surface-variant)' }}>
              Available at
            </h2>
            <div className="flex flex-wrap gap-2">
              {stores.map(store => (
                <span key={store} className="px-3 py-1.5 rounded-full text-xs font-bold text-white"
                  style={{ background: STORE_COLOURS[store] ?? '#555' }}>
                  {storeDisplayName(store)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Nutrition */}
        {nutrition && <NutritionTable n={nutrition} />}

        <div className="text-center mt-4">
          <Link href={product.category ? `/shop/${toSlug(product.category)}` : '/shop'}
            className="text-sm font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--primary)' }}>
            ← Back to {product.category ?? 'shop'}
          </Link>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
