import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreRefreshRow } from './store-refresh-selector';

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: mock }));
import { selectStoreProductsForRefresh } from './store-refresh-selector';

function rows(count: number): StoreRefreshRow[] {
  return Array.from({ length: count }, (_, i) => ({
    store_product_id: `product-${i}`, canonical_name: `Product ${i}`,
    store_product_name: `Product ${i}`, store_url: `https://retailer/product/${i}`,
    store_sku: String(i), previous_price: 2, last_observed_at: '2026-11-02T05:30:00Z',
  }));
}

function serve(data: StoreRefreshRow[], failAt?: number) {
  const ranges: number[][] = [];
  mock.rpc.mockImplementation((_name, args) => ({ order: () => ({
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      return from === failAt
        ? { data: null, error: { message: 'page unavailable' } }
        : { data: data.slice(0, args.p_limit).slice(from, to + 1), error: null };
    },
  }) }));
  return ranges;
}

beforeEach(() => vi.clearAllMocks());

describe('complete retailer refresh selection', () => {
  it('includes all 1,851 eligible SuperValu products past the API row cap', async () => {
    const inventory = rows(1851);
    const ranges = serve(inventory);
    const result = await selectStoreProductsForRefresh('supervalu', 2500, { productUrlOnly: true });
    expect(result).toEqual(inventory);
    expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499], [1500, 1999]]);
    expect(mock.rpc).toHaveBeenCalledWith('select_store_products_for_refresh', {
      p_store: 'supervalu', p_limit: 2500, p_product_url_only: true, p_query: null,
    });
  });

  it('retains a small manual limit and query without reading the full inventory', async () => {
    const ranges = serve(rows(1851));
    expect(await selectStoreProductsForRefresh('supervalu', 25, { query: ' milk ' })).toHaveLength(25);
    expect(ranges).toEqual([[0, 24]]);
    expect(mock.rpc.mock.calls[0][1].p_query).toBe('milk');
  });

  it('stops at the database maximum, including an exact final page', async () => {
    const ranges = serve(rows(3000));
    expect(await selectStoreProductsForRefresh('dunnes', 5000)).toHaveLength(2500);
    expect(ranges).toHaveLength(5);
    expect(ranges.at(-1)).toEqual([2000, 2499]);
  });

  it('rejects a later-page error instead of returning a misleading partial inventory', async () => {
    serve(rows(1851), 1000);
    await expect(selectStoreProductsForRefresh('supervalu', 2500)).rejects.toThrow('page unavailable');
  });

  it('rejects duplicate products when a concurrent refresh changes page ordering', async () => {
    const inventory = rows(1053);
    inventory[500] = inventory[0];
    serve(inventory);
    await expect(selectStoreProductsForRefresh('dunnes', 2500)).rejects.toThrow('Unstable dunnes refresh selection');
  });

  it('finds a targeted failure beyond both the failure and inventory first pages', async () => {
    serve(rows(1851));
    const failures = rows(1201).map((row) => ({ store_product_id: row.store_product_id }));
    const ranges: number[][] = [];
    mock.from.mockImplementation(() => {
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder,
        range: async (from: number, to: number) => {
          ranges.push([from, to]);
          return { data: failures.slice(from, to + 1), error: null };
        },
      };
      return builder;
    });
    const selected = await selectStoreProductsForRefresh('supervalu', 2500, { failureRunId: 'failed-run' });
    expect(selected).toHaveLength(1201);
    expect(selected.at(-1)?.store_product_id).toBe('product-1200');
    expect(ranges).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });
});
