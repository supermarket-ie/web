import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { ProductCatalogueList } from '@/components/ProductCatalogueList';
import { getProductCatalogue } from '@/lib/product-catalogue-data';
import { catalogueItemList } from '@/lib/product-catalogue';
import { CATALOGUE_CATEGORIES, catalogueCategory } from '@/lib/catalogue-categories';
import { SHOP_BUILDER_PATH } from '@/lib/shop-builder';

export const revalidate = 1800;
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();
export function generateStaticParams() { return CATALOGUE_CATEGORIES.map(category => ({ category: category.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const category = catalogueCategory((await params).category);
  if (!category) return { title: 'Category not found' };
  const title = `${category.name} Prices Ireland`;
  const description = `${category.description}. Browse matched Irish supermarket prices, check pack sizes and add products to your household shop.`;
  return { title, description, alternates: { canonical: `${BASE_URL}/shop/${category.slug}` }, openGraph: { title, description } };
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const slug = (await params).category;
  const category = catalogueCategory(slug);
  if (!category) notFound();
  if (category.slug !== slug) permanentRedirect(`/shop/${category.slug}`);
  const products = (await getProductCatalogue()).filter(product => product.category === category.name && product.updatedAt);
  return <>
    <SiteHeader />
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <Breadcrumbs items={[{ label: 'Shop by category', href: '/shop' }, { label: category.name, href: `/shop/${category.slug}` }]} />
      <header className="py-6">
        <p className="mb-3 text-3xl" aria-hidden="true">{category.emoji}</p>
        <h1 className="text-3xl font-bold tracking-tight text-[#173525]">{category.name} for your household shop</h1>
        <p className="mt-3 text-sm leading-6 text-[#526c5b]">{category.description}. Open a product to see matched prices, retailer pack details and when each price was checked.</p>
        <p className="mt-2 text-sm text-[#607065]">{products.length} products with current prices. Coverage varies by product; missing prices are shown clearly.</p>
      </header>
      {products.length ? <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(catalogueItemList(products, `${category.name} products`, `/shop/${category.slug}`, BASE_URL)).replace(/</g, '\\u003c') }} />
        <ProductCatalogueList products={products} />
      </> : <p className="rounded-2xl border border-[#dce6de] bg-white p-6 text-[#607065]">We don’t currently have fresh matched prices in this category. You can still describe what you need to your agent.</p>}
      <section className="my-8 rounded-2xl bg-[#edf7ef] p-6">
        <h2 className="text-lg font-semibold text-[#173525]">Bring your household shop together</h2>
        <p className="mt-2 text-sm leading-6 text-[#526c5b]">Add food and household essentials, adjust quantities and review the list with your agent. Register to save your shop.</p>
        <Link href={`${SHOP_BUILDER_PATH}#build-your-shop`} className="mt-4 inline-block rounded-xl bg-[#21603b] px-5 py-3 text-sm font-semibold text-white">Build my shop →</Link>
      </section>
      <h2 className="mb-3 text-lg font-semibold text-[#173525]">Browse other categories</h2>
      <div className="flex flex-wrap gap-2">{CATALOGUE_CATEGORIES.filter(item => item.slug !== category.slug).map(item => <Link key={item.slug} href={`/shop/${item.slug}`} className="rounded-full border border-[#dce6de] bg-white px-4 py-2 text-sm text-[#21603b]">{item.name}</Link>)}</div>
    </main>
    <SiteFooter />
  </>;
}
