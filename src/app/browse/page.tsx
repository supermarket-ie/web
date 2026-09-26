import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { ProductCatalogueList } from '@/components/ProductCatalogueList';
import { getProductCatalogue } from '@/lib/product-catalogue-data';
import { catalogueCategory } from '@/lib/catalogue-categories';

type Search = { q?: string | string[]; page?: string | string[]; category?: string | string[] };
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();
const PAGE_SIZE = 48;

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const search = await searchParams;
  const q = first(search.q), page = first(search.page);
  const pageNumber = /^\d+$/.test(page ?? '') ? Number(page) : 1;
  return {
    title: `Browse Groceries & Household Products${pageNumber > 1 ? ` — Page ${pageNumber}` : ''}`,
    description: 'Find food and household essentials with current matched Irish supermarket prices. Open a product to check pack details and add it to your shop.',
    alternates: { canonical: `${BASE_URL}/browse${pageNumber > 1 ? `?page=${pageNumber}` : ''}` },
    ...(q ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function BrowsePage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const categoryName = first(search.category);
  const category = categoryName ? catalogueCategory(categoryName) : null;
  if (category) permanentRedirect(`/shop/${category.slug}`);
  const query = (first(search.q) ?? '').trim().slice(0, 80);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const products = (await getProductCatalogue()).filter(product => product.updatedAt && terms.every(term => product.name.toLowerCase().includes(term)));
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const pageParam = first(search.page);
  const page = /^\d+$/.test(pageParam ?? '') ? Number(pageParam) : 1;
  if (page < 1 || page > pages) notFound();
  const shown = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageUrl = (target: number) => `/browse?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(target > 1 ? { page: String(target) } : {}) })}`;
  return <>
    <SiteHeader />
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <Breadcrumbs items={[{ label: 'Shop', href: '/shop' }, { label: 'Browse products', href: '/browse' }]} />
      <header className="py-6">
        <h1 className="text-3xl font-bold tracking-tight text-[#173525]">Find products for your household shop</h1>
        <p className="mt-3 text-sm leading-6 text-[#526c5b]">Explore food, cleaning products, toiletries and more. Prices are public; register when you’re ready to save your shop.</p>
      </header>
      <form action="/browse" className="mb-5 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-sm font-semibold text-[#354a3b]">Find a product
          <input name="q" type="search" defaultValue={query} maxLength={80} placeholder="Search milk, bread, detergent…" className="mt-2 block w-full rounded-xl border border-[#c3d6c9] bg-white px-3 py-3 text-base font-normal" />
        </label>
        <button className="rounded-xl bg-[#21603b] px-5 py-3 text-base font-semibold text-white">Search</button>
      </form>
      <div className="mb-4 flex flex-wrap justify-between gap-2 text-sm text-[#607065]">
        <p>{products.length} {query ? 'matching' : ''} products with current prices{pages > 1 ? ` · Page ${page} of ${pages}` : ''}</p>
        <Link href="/shop" className="font-semibold text-[#21603b] underline underline-offset-2">Browse by category →</Link>
      </div>
      {shown.length ? <ProductCatalogueList products={shown} /> : <p className="rounded-2xl border border-[#dce6de] bg-white p-6 text-[#607065]">No current matched prices found for this search. Try a shorter product name or browse a category.</p>}
      {pages > 1 && <nav aria-label="Product pages" className="mt-6 flex justify-between text-sm font-semibold text-[#21603b]">
        {page > 1 ? <Link href={pageUrl(page - 1)}>← Previous</Link> : <span />}
        {page < pages && <Link href={pageUrl(page + 1)}>Next →</Link>}
      </nav>}
    </main>
    <SiteFooter />
  </>;
}
