import { MetadataRoute } from 'next';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.supermarket.ie').trim();

const BLOG_SLUGS = [
  'is-it-worth-shopping-at-multiple-supermarkets-ireland',
  'cheapest-supermarket-ireland-2026',
  'save-money-weekly-shop-ireland',
  'spaghetti-bolognese-ireland-cheapest',
  'tesco-clubcard-ireland-guide',
];

const CATEGORY_SLUGS = [
  'dairy', 'meat', 'vegetables', 'fruit', 'bakery', 'breakfast',
  'pasta-and-rice', 'tinned', 'condiments', 'beverages', 'snacks',
  'frozen', 'dairy-alternatives', 'household', 'personal-care',
  'baking', 'spreads', 'fish',
];

const MATCHUP_SLUGS = [
  'tesco-vs-dunnes', 'tesco-vs-supervalu', 'dunnes-vs-supervalu',
  'tesco-vs-aldi', 'dunnes-vs-aldi', 'supervalu-vs-aldi',
];

const STORE_SLUGS = ['tesco', 'dunnes', 'supervalu', 'aldi'];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'weekly', priority: 1.0 },
    { url: `${BASE_URL}/compare/supermarket-prices-ireland`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/deals`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/cost-of-weekly-shop-ireland`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    ...MATCHUP_SLUGS.map(slug => ({
      url: `${BASE_URL}/compare/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    })),
    ...STORE_SLUGS.map(store => ({
      url: `${BASE_URL}/deals/${store}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    })),
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    ...BLOG_SLUGS.map(slug => ({
      url: `${BASE_URL}/blog/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    { url: `${BASE_URL}/shop`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    ...CATEGORY_SLUGS.map(slug => ({
      url: `${BASE_URL}/shop/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    { url: `${BASE_URL}/list/request`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/api/products`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.6 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
  ];
}
