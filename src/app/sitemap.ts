import { MetadataRoute } from 'next';
import { POSTS } from '@/lib/blog';
import { getProductCatalogue } from '@/lib/product-catalogue-data';
import { CATALOGUE_CATEGORIES } from '@/lib/catalogue-categories';

export const revalidate = 1800;

// ── Source of truth ──────────────────────────────────────────────────────────
// Blog slugs + dates: src/lib/blog.ts (POSTS array)
// Category slugs:     src/lib/catalogue-categories.ts
// Product identities: shared trusted product catalogue
// Matchup/store slugs: static (update manually if stores change)
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.supermarket.ie').trim();

const MATCHUP_SLUGS = [
  'tesco-vs-dunnes', 'tesco-vs-supervalu', 'dunnes-vs-supervalu',
  'tesco-vs-aldi', 'dunnes-vs-aldi', 'supervalu-vs-aldi',
];

const STORE_SLUGS = ['tesco', 'dunnes', 'supervalu', 'aldi'];

const TEMPLATE_UPDATED = new Date('2026-09-26');

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = (await getProductCatalogue()).filter(product => product.updatedAt);
  return [
    { url: BASE_URL, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${BASE_URL}/compare/supermarket-prices-ireland`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/deals`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/cost-of-weekly-shop-ireland`, lastModified: new Date('2026-09-26'), changeFrequency: 'weekly', priority: 0.9 },

    ...MATCHUP_SLUGS.map(slug => ({
      url: `${BASE_URL}/compare/${slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    })),

    ...STORE_SLUGS.map(store => ({
      url: `${BASE_URL}/deals/${store}`,
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    })),

    { url: `${BASE_URL}/blog`, changeFrequency: 'weekly' as const, priority: 0.8 },

    // Blog posts — dates from POSTS in src/lib/blog.ts (single source of truth)
    ...POSTS.map(post => ({
      url: `${BASE_URL}/blog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),

    { url: `${BASE_URL}/browse`, changeFrequency: 'daily' as const, priority: 0.8 },
    { url: `${BASE_URL}/shop`, lastModified: TEMPLATE_UPDATED, changeFrequency: 'weekly' as const, priority: 0.9 },

    ...CATALOGUE_CATEGORIES.map(category => ({
      url: `${BASE_URL}/shop/${category.slug}`,
      lastModified: TEMPLATE_UPDATED,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),

    { url: `${BASE_URL}/list/request`, changeFrequency: 'monthly' as const, priority: 0.7 },
    // /api/products removed — JSON API endpoints should not be in the sitemap
    { url: `${BASE_URL}/privacy`, changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${BASE_URL}/terms`, changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${BASE_URL}/contact-us`, changeFrequency: 'yearly' as const, priority: 0.3 },

    // Product pages — server-rendered with live public prices (/browse/[slug])
    // Source: canonical identities with at least one guarded, fresh trusted offer
    ...products.map(product => ({
      url: `${BASE_URL}/browse/${product.slug}`,
      lastModified: new Date(Math.max(TEMPLATE_UPDATED.getTime(), Date.parse(product.updatedAt!))),
      changeFrequency: 'weekly' as const,
      priority: 0.75,
    })),
  ];
}
