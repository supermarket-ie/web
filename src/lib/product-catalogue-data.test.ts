import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ prices: 0, reviews: 0, build: 0, fail: false }));
vi.mock('server-only', () => ({}));
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(f: T) => f }));
vi.mock('next/cache', () => ({ unstable_cache: <T,>(f: T) => f }));
vi.mock('./supabase', () => ({ supabaseAdmin: { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) } }));
vi.mock('./runtime-env', () => ({ isPreviewEnv: () => false }));
vi.mock('./price-data', () => ({ getAllLatestPrices: async () => { calls.prices++; if (calls.fail) throw new Error('db down'); return []; } }));
vi.mock('./comparison-reviews', () => ({ getCurrentPairReviews: async () => { calls.reviews++; return []; } }));
vi.mock('./product-catalogue', () => ({ buildProductCatalogue: (_r: unknown, _p: unknown, at: number) => { calls.build++; return [{ id: 'x', builtAt: at }]; } }));
import { CATALOGUE_TTL_MS, getProductCatalogue, resetProductCatalogueCache } from './product-catalogue-data';

describe('getProductCatalogue (shared across requests)', () => {
  beforeEach(() => { resetProductCatalogueCache(); calls.prices = calls.reviews = calls.build = 0; calls.fail = false; vi.useRealTimers(); });
  it('concurrent renders share one build', async () => {
    const all = await Promise.all(Array.from({ length: 10 }, () => getProductCatalogue()));
    expect(new Set(all).size).toBe(1);
    expect(calls).toMatchObject({ prices: 1, reviews: 1, build: 1 });
  });
  it('reuses the build within the TTL and rebuilds (re-evaluating freshness) after it', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-22T12:00:00Z'));
    const a = await getProductCatalogue();
    vi.setSystemTime(Date.now() + CATALOGUE_TTL_MS - 1);
    expect(await getProductCatalogue()).toBe(a);
    vi.setSystemTime(Date.now() + 2);
    const b = await getProductCatalogue();
    expect(b).not.toBe(a);
    expect(calls.build).toBe(2);
  });
  it('a failed build is not cached', async () => {
    calls.fail = true;
    await expect(getProductCatalogue()).rejects.toThrow('db down');
    calls.fail = false;
    expect(await getProductCatalogue()).toHaveLength(1);
    expect(calls.build).toBe(1);
  });
});
