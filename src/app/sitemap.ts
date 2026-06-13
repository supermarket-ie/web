import { MetadataRoute } from 'next';
import { POSTS } from '@/lib/blog';
import { supabaseAdmin } from '@/lib/supabase';

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

// Fetch product slugs for /browse/[slug] pages (products in all 3 main stores)
async function getBrowseSlugs(): Promise<string[]> {
  const MAIN = ['tesco', 'dunnes', 'supervalu'];
  const storeMap = new Map<string, Set<string>>();
  let from = 0;
  while (true) {
    const { data } = await supabaseAdmin
      .from('store_products')
      .select('product_id, store')
      .eq('url_status', 'resolved')
      .in('store', MAIN)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (!storeMap.has(r.product_id)) storeMap.set(r.product_id, new Set());
      storeMap.get(r.product_id)!.add(r.store);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  const ids = [...storeMap.entries()].filter(([, s]) => MAIN.every(m => s.has(m))).map(([id]) => id);
  if (ids.length === 0) return [];
  const slugs: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data: products } = await supabaseAdmin.from('products').select('canonical_name').in('id', ids.slice(i, i + 500));
    for (const p of products ?? []) {
      const s = p.canonical_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!seen.has(s)) { seen.add(s); slugs.push(s); }
    }
  }
  return slugs;
}

// Site-wide last-scraped date — updated when data refreshes (Mon/Thu).
// More meaningful than new Date() on every build.
const DATA_FRESHNESS = new Date('2026-06-10');

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const browseSlugs = await getBrowseSlugs();
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

    // Product pages — server-rendered with live public prices (/browse/[slug])
    // Source: store_products with url_status=resolved in all 3 main stores
    ...browseSlugs.map(slug => ({
      url: `${BASE_URL}/browse/${slug}`,
      lastModified: DATA_FRESHNESS,
      changeFrequency: 'weekly' as const,
      priority: 0.75,
    })),
  ];
}
