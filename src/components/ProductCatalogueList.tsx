import Link from 'next/link';
import { catalogueOffers, type CatalogueProduct } from '@/lib/product-catalogue';

export function ProductCatalogueList({ products }: { products: CatalogueProduct[] }) {
  return <div className="divide-y divide-[#e4ebe6] overflow-hidden rounded-2xl border border-[#dce6de] bg-white">
    {products.map(product => {
      const offers = catalogueOffers(product);
      return <Link key={product.id} href={`/browse/${product.slug}`} prefetch={false} className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-[#f1f8f3] focus-visible:outline-2 focus-visible:outline-[#287246]">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#173525]">{product.name}</h3>
          <p className="mt-1 text-xs text-[#607065]">Prices from {offers.length} of 3 supermarkets · View product and pack details</p>
        </div>
        <span className="shrink-0 text-right text-sm font-bold text-[#21603b]">{offers[0] ? `From €${offers[0].price.toFixed(2)}` : 'View product'} <span aria-hidden="true">→</span></span>
      </Link>;
    })}
  </div>;
}
