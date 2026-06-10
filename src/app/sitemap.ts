import { MetadataRoute } from 'next';
import { POSTS } from '@/lib/blog';

// ── Source of truth ──────────────────────────────────────────────────────────
// Blog slugs + dates: src/lib/blog.ts (POSTS array)
// Category slugs:     src/app/shop/[category]/page.tsx (CATEGORY_META keys)
//                     — keep these two lists in sync when adding a new category
// Matchup/store slugs: static (update manually if stores change)
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.supermarket.ie').trim();

// Canonical category slugs — must match CATEGORY_META keys in shop/[category]/page.tsx
// Spaces in CATEGORY_META keys are URL-encoded; sitemap uses the slug form with hyphens.
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

// Site-wide last-scraped date — updated when data refreshes (Mon/Thu).
// More meaningful than new Date() on every build.
const DATA_FRESHNESS = new Date('2026-06-10');

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE_URL, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${BASE_URL}/compare/supermarket-prices-ireland`, lastModified: DATA_FRESHNESS, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/deals`, lastModified: DATA_FRESHNESS, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${BASE_URL}/cost-of-weekly-shop-ireland`, lastModified: DATA_FRESHNESS, changeFrequency: 'weekly', priority: 0.9 },

    ...MATCHUP_SLUGS.map(slug => ({
      url: `${BASE_URL}/compare/${slug}`,
      lastModified: DATA_FRESHNESS,
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    })),

    ...STORE_SLUGS.map(store => ({
      url: `${BASE_URL}/deals/${store}`,
      lastModified: DATA_FRESHNESS,
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

    { url: `${BASE_URL}/shop`, lastModified: DATA_FRESHNESS, changeFrequency: 'weekly' as const, priority: 0.9 },

    ...CATEGORY_SLUGS.map(slug => ({
      url: `${BASE_URL}/shop/${slug}`,
      lastModified: DATA_FRESHNESS,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),

    { url: `${BASE_URL}/list/request`, changeFrequency: 'monthly' as const, priority: 0.7 },
    // /api/products removed — JSON API endpoints should not be in the sitemap
    { url: `${BASE_URL}/privacy`, changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${BASE_URL}/terms`, changeFrequency: 'yearly' as const, priority: 0.3 },
  ];
}
