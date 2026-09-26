import { beforeEach, describe, expect, it, vi } from 'vitest';

const { range, order, from } = vi.hoisted(() => ({ range: vi.fn(), order: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  const query = { select: vi.fn().mockReturnThis(), order, range };
  from.mockReturnValue(query);
  order.mockReturnValue(query);
});

const row = (id: number, store = 'tesco') => ({ canonical_product_id: `product-${id}`, canonical_name: `Product ${id}`, store, price: 1 });

describe('complete trusted price loading', () => {
  it('loads products after the API row cap and caches only the complete result', async () => {
    range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => row(i)), error: null })
      .mockResolvedValueOnce({ data: [row(1000), row(1000, 'dunnes')], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { getAllLatestPrices } = await import('../price-data');
    const prices = await getAllLatestPrices();
    expect(prices).toHaveLength(1002);
    expect(prices.at(-1)?.store).toBe('dunnes');
    expect(range.mock.calls).toEqual([[0, 999], [1000, 1999], [1002, 2001]]);
    expect(order.mock.calls.slice(0, 2)).toEqual([['canonical_product_id'], ['store']]);
    expect(await getAllLatestPrices()).toBe(prices);
    expect(range).toHaveBeenCalledTimes(3);
  });

  it('continues after a shorter server cap and preserves distinct identities with the same name', async () => {
    range.mockResolvedValueOnce({ data: [row(1)], error: null })
      .mockResolvedValueOnce({ data: [{ ...row(2), canonical_name: 'Product 1' }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { getAllLatestPrices } = await import('../price-data');
    expect(await getAllLatestPrices()).toHaveLength(2);
    expect(range.mock.calls).toEqual([[0, 999], [1, 1000], [2, 1001]]);
  });

  it('refuses a partial catalogue when a later page fails and does not cache it', async () => {
    range.mockResolvedValueOnce({ data: [row(1)], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'query rejected', code: '42501' } });
    const { getAllLatestPrices } = await import('../price-data');
    await expect(getAllLatestPrices()).rejects.toThrow('query rejected');
    range.mockResolvedValueOnce({ data: [row(2)], error: null }).mockResolvedValueOnce({ data: [], error: null });
    expect((await getAllLatestPrices()).map(price => price.canonical_product_id)).toEqual(['product-2']);
  });

  it('returns empty trusted data without inventing prices', async () => {
    range.mockResolvedValueOnce({ data: [], error: null });
    const { getAllLatestPrices } = await import('../price-data');
    expect(await getAllLatestPrices()).toEqual([]);
  });
});
