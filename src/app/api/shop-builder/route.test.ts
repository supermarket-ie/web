import { beforeEach, describe, expect, it, vi } from 'vitest';

const readPrices = vi.hoisted(() => vi.fn());
vi.mock('@/lib/price-data', () => ({ getAllLatestPrices: readPrices }));
import { GET } from './route';

beforeEach(() => { readPrices.mockReset(); });

describe('public shop builder search', () => {
  it('rejects unbounded searches and invalid restoration IDs before reading prices', async () => {
    for (const query of ['', 'q=a', `q=${'x'.repeat(81)}`, 'ids=not-a-product']) {
      expect((await GET(new Request(`https://supermarket.ie/api/shop-builder?${query}`))).status).toBe(400);
    }
    expect(readPrices).not.toHaveBeenCalled();
  });

  it('fails closed when trusted prices are unavailable', async () => {
    readPrices.mockRejectedValue(new Error('unavailable'));
    const response = await GET(new Request('https://supermarket.ie/api/shop-builder?q=milk'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).not.toHaveProperty('products');
  });

  it('returns a bounded product selection and refreshes by exact canonical ID', async () => {
    const id = 'fbf1ad4d-fecd-4303-9d12-0add3b6f6e6c';
    readPrices.mockResolvedValue([{ canonical_product_id: id, canonical_name: 'Whole Milk 2L', category: 'Dairy', store_product_name: 'Whole Milk 2L', store: 'dunnes', price: 2.25, relationship_type: 'exact', freshness_state: 'fresh', observed_at: new Date().toISOString() }]);
    const response = await GET(new Request(`https://supermarket.ie/api/shop-builder?ids=${id}`));
    expect(response.status).toBe(200);
    expect((await response.json()).products).toMatchObject([{ id, name: 'Whole Milk 2L', offers: { dunnes: { price: 2.25 } } }]);
  });
});
