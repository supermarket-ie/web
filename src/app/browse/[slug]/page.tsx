import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { supabaseAdmin } from '@/lib/supabase';
import { storeDisplayName } from '@/lib/store-utils';
import { ProductPrices } from '@/components/ProductPrices';

export const revalidate = 43200; // 12h
export const dynamicParams = true; // render unknown slugs on-demand (ISR) instead of 404

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();

// ── Slug helpers ─────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getProduct(slug: string) {
  // Fetch all products in batches and match by slug
  let allProducts: { id: string; canonical_name: string; category: string | null; description: string | null; image_url: string | null; brand: string | null }[] = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('id, canonical_name, category, description, image_url, brand')
      .range(from, from + batchSize - 1);
    if (error || !data || data.length === 0) break;
    allProducts = allProducts.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  const product = allProducts.find(p => toSlug(p.canonical_name) === slug);
  if (!product) return null;

  const { data: storeRows } = await supabaseAdmin
    .from('store_products')
    .select('store, brand, is_own_brand, store_product_name, calories_per_100, protein_per_100, carbs_per_100, fat_per_100, saturated_fat_per_100, sugar_per_100, fibre_per_100, salt_per_100')
    .eq('product_id', product.id)
    .eq('url_status', 'resolved');

  const stores = [...new Set((storeRows ?? []).map(r => r.store))];

  // Only show products available in at least one main store (Tesco, Dunnes, SuperValu)
  const MAIN_STORES = ['tesco', 'dunnes', 'supervalu'];
  const hasMainStore = stores.some(s => MAIN_STORES.includes(s));
  if (!hasMainStore) return null;

  const withNutrition = (storeRows ?? []).filter(r => r.calories_per_100 != null);
  const bestNutrition = withNutrition.sort((a, b) => {
    const score = (r: typeof a) => [r.protein_per_100, r.carbs_per_100, r.fat_per_100, r.fibre_per_100, r.salt_per_100].filter(v => v != null).length;
    return score(b) - score(a);
  })[0] ?? null;

  const brand = product.brand ?? (storeRows ?? []).find(r => !r.is_own_brand && r.brand)?.brand ?? null;

  return { product, stores, nutrition: bestNutrition, brand };
}

// ── Static params ─────────────────────────────────────────────────────────────

export async function generateStaticParams() {
  // Only pre-build pages for products in at least one main store (Tesco, Dunnes, SuperValu)
  const MAIN_STORES = ['tesco', 'dunnes', 'supervalu'];
  const seen = new Set<string>();
  const slugs: { slug: string }[] = [];
  let from = 0;
  const batchSize = 1000;
  while (true) {
    const { data } = await supabaseAdmin
      .from('store_products')
      .select('product_id')
      .eq('url_status', 'resolved')
      .in('store', MAIN_STORES)
      .range(from, from + batchSize - 1);
    if (!data || data.length === 0) break;
    const productIds = [...new Set(data.map(r => r.product_id))];
    // Fetch canonical names for these product ids
    const { data: products } = await supabaseAdmin
      .from('products')
      .select('canonical_name')
      .in('id', productIds);
    for (const p of products ?? []) {
      const slug = toSlug(p.canonical_name);
      if (!seen.has(slug)) { seen.add(slug); slugs.push({ slug }); }
    }
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return slugs;
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await getProduct(slug);
  if (!result) return { title: 'Product not found' };

  const { product, stores, brand } = result;
  const storeList = stores.map(storeDisplayName).join(', ');
  const title = `${product.canonical_name} — Price in Ireland | supermarket.ie`;
  const description = `${product.canonical_name}${brand ? ` by ${brand}` : ''} available at ${storeList || 'Irish supermarkets'}. Compare live prices across Tesco, Dunnes, SuperValu and Aldi.`;

  return {
    title,
    description,
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

function productJsonLd(product: { canonical_name: string; category: string | null; description: string | null; image_url: string | null }, brand: string | null, slug: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.canonical_name,
    ...(product.description ? { description: product.description } : {}),
    ...(product.image_url ? { image: product.image_url } : {}),
    ...(product.category ? { category: product.category } : {}),
    ...(brand ? { brand: { '@type': 'Brand', name: brand } } : {}),
    url: `${BASE_URL}/browse/${slug}`,
    offers: {
      '@type': 'AggregateOffer',
      availability: 'https://schema.org/InStock',
      priceCurrency: 'EUR',
      seller: { '@type': 'Organization', name: 'supermarket.ie' },
    },
  };
}

// ── Store colours ─────────────────────────────────────────────────────────────

const STORE_COLOURS: Record<string, string> = {
  tesco: '#006A35',
  dunnes: '#e31837',
  supervalu: '#e31837',
  aldi: '#003399',
  lidl: '#0050aa',
};

// ── Nutrition table ───────────────────────────────────────────────────────────

function NutritionTable({ n }: { n: { calories_per_100: number | null; protein_per_100: number | null; carbs_per_100: number | null; fat_per_100: number | null; saturated_fat_per_100: number | null; sugar_per_100: number | null; fibre_per_100: number | null; salt_per_100: number | null } }) {
  const rows = [
    { label: 'Energy', value: n.calories_per_100, unit: 'kcal' },
    { label: 'Fat', value: n.fat_per_100, unit: 'g' },
    { label: 'of which saturates', value: n.saturated_fat_per_100, unit: 'g', indent: true },
    { label: 'Carbohydrates', value: n.carbs_per_100, unit: 'g' },
    { label: 'of which sugars', value: n.sugar_per_100, unit: 'g', indent: true },
    { label: 'Fibre', value: n.fibre_per_100, unit: 'g' },
    { label: 'Protein', value: n.protein_per_100, unit: 'g' },
    { label: 'Salt', value: n.salt_per_100, unit: 'g' },
  ].filter(r => r.value != null);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--surface-container)' }}>
      <div className="px-4 py-3" style={{ background: 'var(--surface-container-low)' }}>
        <h2 className="text-sm font-bold" style={{ color: 'var(--on-surface)' }}>Nutrition per 100g</h2>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--surface-container)' : undefined, background: 'var(--surface-container-lowest)' }}>
              <td className="px-4 py-2" style={{ color: 'var(--on-surface-variant)', paddingLeft: row.indent ? '2rem' : undefined }}>
                {row.label}
              </td>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getProduct(slug);
  if (!result) notFound();

  const { product, stores, nutrition, brand } = result;

  return (
    <>
      <SiteHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd(product, brand, slug)) }}
      />

      <main className="max-w-2xl mx-auto px-4 pb-16 pt-6">
        {/* Breadcrumb */}
        <nav className="text-xs mb-4 flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--on-surface-variant)' }}>
          <Link href="/shop" className="hover:underline">Browse</Link>
          <span>›</span>
          {product.category && (
            <>
              <Link href={`/browse?category=${encodeURIComponent(product.category)}`} className="hover:underline">
                {product.category}
              </Link>
              <span>›</span>
            </>
          )}
          <span style={{ color: 'var(--on-background)' }}>{product.canonical_name}</span>
        </nav>

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

        {nutrition && (
          <div className="mb-6">
            <NutritionTable n={nutrition} />
          </div>
        )}

        {/* Prices — shows live prices if logged in, gate if not */}
        <ProductPrices productId={product.id} stores={stores} />

        <div className="text-center">
          <Link href={product.category ? `/browse?category=${encodeURIComponent(product.category)}` : '/browse'}
            className="text-sm font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--primary)' }}>
            ← Back to {product.category ?? 'browse'}
          </Link>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
