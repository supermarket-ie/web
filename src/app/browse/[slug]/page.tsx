import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { AddProductToShop } from '@/components/AddProductToShop';
import { ProductCatalogueList } from '@/components/ProductCatalogueList';
import { getProductCatalogue } from '@/lib/product-catalogue-data';
import { catalogueOffers, productStructuredData } from '@/lib/product-catalogue';
import { catalogueCategory } from '@/lib/catalogue-categories';
import { WEEKLY_STORES, WEEKLY_STORE_NAMES } from '@/lib/weekly-shop';
import { supabaseAdmin } from '@/lib/supabase';

export const revalidate = 1800;
export const dynamicParams = true;
// Generate on first visit. Avoid rebuilding every product with repeated full-catalogue reads.
export function generateStaticParams() { return []; }
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();
const date = (value: string) => new Date(value).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = (await getProductCatalogue()).find(item => item.slug === slug);
  if (!product) return { title: 'Product not found' };
  const prices = catalogueOffers(product);
  const title = `${product.name} Price Ireland`;
  const description = prices.length
    ? `${product.name} from €${prices[0].price.toFixed(2)} at ${WEEKLY_STORE_NAMES[prices[0].store]}. See ${prices.length} matched supermarket price${prices.length === 1 ? '' : 's'}, pack details and check dates. Add it to your household shop.`
    : `Explore ${product.name} for your household shop. A current matched price is unavailable; browse related products or add it to a list for your agent to review.`;
  return { title, description, alternates: { canonical: `${BASE_URL}/browse/${slug}` },
    openGraph: { title, description, url: `${BASE_URL}/browse/${slug}`, ...(product.imageUrl ? { images: [{ url: product.imageUrl }] } : {}) } };
}

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
        <h2 className="text-sm font-bold" style={{ color: 'var(--on-surface)' }}>Nutrition per 100g / 100ml</h2>
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

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const catalogue = await getProductCatalogue();
  const product = catalogue.find(item => item.slug === slug);
  if (!product) notFound();
  const category = catalogueCategory(product.category);
  const prices = catalogueOffers(product);
  const related = catalogue.filter(item => item.id !== product.id && item.category === product.category && item.updatedAt).slice(0, 6);
  // Nutrition is labelled with its retailer source and only taken from a currently matched offer.
  const { data: nutritionRows } = prices.length ? await supabaseAdmin.from('store_products')
    .select('store,store_product_name,calories_per_100,protein_per_100,carbs_per_100,fat_per_100,saturated_fat_per_100,sugar_per_100,fibre_per_100,salt_per_100')
    .eq('product_id', product.id).eq('url_status', 'resolved').in('store', prices.map(offer => offer.store))
    : { data: [] };
  const nutrition = nutritionRows?.find(row => row.calories_per_100 != null && prices.some(offer => offer.store === row.store && offer.name === row.store_product_name));

  return <>
    <SiteHeader />
    {prices.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productStructuredData(product, BASE_URL)).replace(/</g, '\\u003c') }} />}
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, ...(category ? [{ label: category.name, href: `/shop/${category.slug}` }] : []), { label: product.name, href: `/browse/${slug}` }]} />
      <div className="my-6 flex items-center gap-4">
        {product.imageUrl && <div className="size-24 shrink-0 rounded-2xl border border-[#e0e7e1] bg-white p-2">
          {/* Retailer images use diverse hosts; preserve their original URLs. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={product.imageUrl} alt={product.name} className="size-full object-contain" />
        </div>}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#397250]">{product.category}</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#173525] sm:text-3xl">{product.name}</h1>
          {product.brand && <p className="mt-1 text-sm text-[#607065]">{product.brand}</p>}
          <p className="mt-2 text-sm text-[#607065]">{prices.length ? `Current matched prices from ${prices.length} of 3 supermarkets in Ireland` : 'No current matched price available'}</p>
        </div>
      </div>
      {product.description && <p className="mb-6 max-w-3xl text-sm leading-6 text-[#526c5b]">{product.description}</p>}
      <div className="grid items-start gap-6 lg:grid-cols-[1.15fr_1fr]">
        <section aria-labelledby="product-prices-title">
          <h2 id="product-prices-title" className="mb-3 text-lg font-semibold text-[#173525]">Prices and retailer products</h2>
          <div className="divide-y divide-[#e4ebe6] overflow-hidden rounded-2xl border border-[#dce6de] bg-white">
            {WEEKLY_STORES.map(store => {
              const offer = product.offers[store];
              return <div key={store} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[#173525]">{WEEKLY_STORE_NAMES[store]}</h3>
                  <span className="shrink-0 text-base font-bold text-[#21603b]">{offer ? `€${offer.price.toFixed(2)}` : 'Unavailable'}</span>
                </div>
                {offer ? <>
                  <p className="mt-1 text-sm leading-5 text-[#526c5b]">{offer.name}</p>
                  <p className="mt-2 text-xs text-[#607065]">Checked <time dateTime={offer.observedAt}>{date(offer.observedAt)}</time>{offer.wasPrice ? ` · Was €${offer.wasPrice.toFixed(2)}` : ''}</p>
                  {offer.storeUrl && <a href={offer.storeUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-[#21603b] underline underline-offset-2">View at {WEEKLY_STORE_NAMES[store]} ↗</a>}
                </> : <p className="mt-1 text-xs leading-5 text-[#607065]">We don’t have a fresh matched price for this product.</p>}
              </div>;
            })}
          </div>
          <p className="mt-3 text-xs leading-5 text-[#607065]">Prices are per pack or item as named and were checked within the last seven days. A missing price does not mean a product is out of stock. Check the retailer for current availability, loyalty conditions and delivery charges.</p>
        </section>
        <AddProductToShop id={product.id} name={product.name} slug={product.slug} />
      </div>
      {nutrition && <section className="mt-8 max-w-xl">
        <p className="mb-2 text-xs leading-5 text-[#607065]">Nutrition supplied for {nutrition.store_product_name} at {WEEKLY_STORE_NAMES[nutrition.store as keyof typeof WEEKLY_STORE_NAMES]}. Check the label for ingredients, allergens and the applicable weight or volume basis.</p>
        <NutritionTable n={nutrition} />
      </section>}
      {related.length > 0 && <section className="mt-10" aria-labelledby="related-products-title">
        <h2 id="related-products-title" className="mb-3 text-lg font-semibold text-[#173525]">More {product.category.toLowerCase()} for your shop</h2>
        <ProductCatalogueList products={related} />
      </section>}
      <div className="mt-6 flex flex-wrap gap-5 text-sm font-semibold text-[#21603b]">
        <Link href={category ? `/shop/${category.slug}` : '/shop'} className="underline underline-offset-2">Browse {category?.name.toLowerCase() ?? 'categories'} →</Link>
        <Link href="/cost-of-weekly-shop-ireland" className="underline underline-offset-2">Explore a weekly shop →</Link>
      </div>
    </main>
    <SiteFooter />
  </>;
}
