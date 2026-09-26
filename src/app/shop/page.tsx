import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { CATALOGUE_CATEGORIES } from '@/lib/catalogue-categories';
import { getProductCatalogue } from '@/lib/product-catalogue-data';
import { SHOP_BUILDER_PATH } from '@/lib/shop-builder';

export const revalidate = 1800;
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();
export const metadata: Metadata = {
  title: 'Shop by Category — Grocery Prices Ireland',
  description: 'Browse food and household essentials with current matched prices from Irish supermarkets. Check product and pack details, then build your household shop.',
  alternates: { canonical: `${BASE_URL}/shop` },
};

export default async function ShopPage() {
  const products = (await getProductCatalogue()).filter(product => product.updatedAt);
  const counts = new Map<string, number>();
  for (const product of products) counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  return <>
    <SiteHeader />
    <main className="mx-auto max-w-6xl px-4 pb-16">
      <header className="my-8 rounded-3xl bg-[#21603b] px-6 py-8 text-white">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#c9e4d1]">Explore the catalogue</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Browse supermarket products</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[#dbede0]">{products.length} products with current matched prices. Explore food and household essentials, check retailer packs and add what you need to your shop.</p>
        <Link href="/browse" className="mt-4 inline-block text-sm font-semibold underline underline-offset-4">Find a product →</Link>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {CATALOGUE_CATEGORIES.map(category => <Link key={category.slug} href={`/shop/${category.slug}`} className="rounded-2xl border border-[#dce6de] bg-white p-4 transition-colors hover:bg-[#f1f8f3]">
          <span className="text-3xl" aria-hidden="true">{category.emoji}</span>
          <h2 className="mt-3 text-sm font-semibold text-[#173525]">{category.name}</h2>
          <p className="mt-1 text-xs leading-5 text-[#607065]">{category.description}</p>
          <p className="mt-2 text-xs font-semibold text-[#397250]">{counts.get(category.name) ?? 0} products with prices</p>
        </Link>)}
      </div>
      <section className="mt-10 rounded-2xl bg-[#edf7ef] p-6">
        <h2 className="text-xl font-semibold text-[#173525]">Build a shop around your household</h2>
        <p className="mt-2 text-sm leading-6 text-[#526c5b]">Add products, set quantities and review your list with your agent. Register when you’re ready to save it.</p>
        <Link href={`${SHOP_BUILDER_PATH}#build-your-shop`} className="mt-4 inline-block rounded-xl bg-[#21603b] px-5 py-3 text-sm font-semibold text-white">Build my shop →</Link>
      </section>
    </main>
    <SiteFooter />
  </>;
}
