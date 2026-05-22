const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://supermarket.ie';

export interface BreadcrumbItem {
  label: string;
  href: string;
}

/**
 * Generate BreadcrumbList JSON-LD for a given path array.
 * Always prepends Home.
 */
export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  const all = [{ label: 'Home', href: '/' }, ...items];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: all.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.label,
      item: `${BASE_URL}${item.href}`,
    })),
  };
}

/**
 * Generate Article JSON-LD for a blog post.
 */
export function articleJsonLd({
  title,
  description,
  datePublished,
  url,
}: {
  title: string;
  description: string;
  datePublished: string;
  url: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    datePublished,
    dateModified: datePublished,
    author: {
      '@type': 'Organization',
      name: 'supermarket.ie',
      url: BASE_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: 'supermarket.ie',
      url: BASE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${BASE_URL}/icon.svg`,
      },
    },
    url: `${BASE_URL}${url}`,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${BASE_URL}${url}`,
    },
  };
}

/**
 * Generate ItemList JSON-LD for a shop category page.
 */
export function itemListJsonLd({
  name,
  description,
  url,
  items,
}: {
  name: string;
  description: string;
  url: string;
  items: { name: string; price?: number }[];
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    description,
    url: `${BASE_URL}${url}`,
    numberOfItems: items.length,
    itemListElement: items.slice(0, 20).map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      ...(item.price != null
        ? {
            item: {
              '@type': 'Product',
              name: item.name,
              offers: {
                '@type': 'Offer',
                price: item.price.toFixed(2),
                priceCurrency: 'EUR',
                availability: 'https://schema.org/InStock',
              },
            },
          }
        : {}),
    })),
  };
}
