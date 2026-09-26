import type { ProductPrice } from './price-data';
import { buildShopCatalogue } from './shop-builder-catalogue';
import type { ShopProduct } from './shop-builder';
import { WEEKLY_STORES, WEEKLY_STORE_NAMES, type WeeklyStore } from './weekly-shop';

export interface CatalogueRecord {
  id: string;
  canonical_name: string;
  category: string | null;
  description: string | null;
  image_url: string | null;
  brand: string | null;
  created_at: string;
}

export type CatalogueOffer = NonNullable<ShopProduct['offers'][WeeklyStore]> & {
  storeUrl: string | null;
  wasPrice: number | null;
};

export type CatalogueProduct = Omit<ShopProduct, 'offers'> & {
  slug: string;
  description: string | null;
  imageUrl: string | null;
  brand: string | null;
  offers: Partial<Record<WeeklyStore, CatalogueOffer>>;
  updatedAt: string | null;
};

export const productSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function httpUrl(value: string | null): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

export function buildProductCatalogue(records: CatalogueRecord[], prices: ProductPrice[], now = Date.now()): CatalogueProduct[] {
  const trusted = new Map(buildShopCatalogue(prices, now).map(product => [product.id, product]));
  const priceRows = new Map(prices.map(row => [`${row.canonical_product_id}:${row.store}:${row.observed_at}`, row]));
  const seenSlugs = new Set<string>();
  // Stable URLs do not depend on retailer coverage. Resolve any future name collision by identity.
  return [...records].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map(record => {
    const base = productSlug(record.canonical_name) || record.id;
    const slug = seenSlugs.has(base) ? `${base}-${record.id}` : base;
    seenSlugs.add(slug);
    const offers: CatalogueProduct['offers'] = {};
    for (const store of WEEKLY_STORES) {
      const matched = trusted.get(record.id);
      const offer = matched?.name === record.canonical_name ? matched.offers[store] : undefined;
      if (!offer) continue;
      const row = priceRows.get(`${record.id}:${store}:${offer.observedAt}`);
      offers[store] = {
        ...offer,
        storeUrl: httpUrl(row?.store_url ?? null),
        wasPrice: row?.on_promotion && Number.isFinite(row.was_price) && row.was_price! > offer.price ? row.was_price : null,
      };
    }
    const dates = Object.values(offers).map(offer => offer.observedAt).sort();
    return {
      id: record.id, name: record.canonical_name, category: record.category ?? 'Other', quantity: 1,
      slug, description: record.description, imageUrl: httpUrl(record.image_url), brand: record.brand,
      offers, updatedAt: dates.at(-1) ?? null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function catalogueOffers(product: CatalogueProduct) {
  return WEEKLY_STORES.flatMap(store => product.offers[store] ? [{ store, ...product.offers[store]! }] : [])
    .sort((a, b) => a.price - b.price);
}

export function productStructuredData(product: CatalogueProduct, baseUrl: string) {
  const prices = catalogueOffers(product);
  const offers = prices.map(offer => ({
    '@type': 'Offer', price: offer.price.toFixed(2), priceCurrency: 'EUR',
    seller: { '@type': 'Organization', name: WEEKLY_STORE_NAMES[offer.store] },
    ...(offer.storeUrl ? { url: offer.storeUrl } : {}),
  }));
  return {
    '@context': 'https://schema.org', '@type': 'Product', name: product.name,
    url: `${baseUrl}/browse/${product.slug}`,
    ...(product.description ? { description: product.description } : {}),
    ...(product.imageUrl ? { image: product.imageUrl } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    category: product.category,
    // A price observation does not establish stock or a future promotion end date.
    ...(offers.length ? { offers: offers.length === 1 ? offers[0] : {
      '@type': 'AggregateOffer', priceCurrency: 'EUR', offerCount: offers.length,
      lowPrice: prices[0].price.toFixed(2), highPrice: prices.at(-1)!.price.toFixed(2), offers,
    } } : {}),
  };
}

export function catalogueItemList(products: CatalogueProduct[], name: string, url: string, baseUrl: string) {
  return {
    '@context': 'https://schema.org', '@type': 'ItemList', name, url: `${baseUrl}${url}`,
    numberOfItems: products.length,
    itemListElement: products.map((product, index) => ({
      '@type': 'ListItem', position: index + 1, name: product.name, url: `${baseUrl}/browse/${product.slug}`,
    })),
  };
}
