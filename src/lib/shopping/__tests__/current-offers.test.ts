import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// Fake PostgREST builder: records filters and serves pages from a fixed row set.
const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, filters: [] as string[], error: null as unknown, ranges: [] as Array<[number, number]> }));
vi.mock('@/lib/supabase', () => {
  const builder = {
    select: () => builder,
    in: (col: string) => { state.filters.push(`in:${col}`); return builder; },
    eq: (col: string, value: string) => { state.filters.push(`eq:${col}=${value}`); return builder; },
    order: () => builder,
    range: async (from: number, to: number) => { state.ranges.push([from, to]); return { data: state.error ? null : state.rows.slice(from, to + 1), error: state.error }; },
  };
  return { supabaseAdmin: { from: () => builder } };
});
import { fetchCurrentExactOffers } from '../current-offers';

describe('fetchCurrentExactOffers', () => {
  beforeEach(() => { state.rows = []; state.filters = []; state.ranges = []; state.error = null; });
  it('filters to exact, fresh rows and pages past 1,000 rows', async () => {
    state.rows = Array.from({ length: 2300 }, (_, i) => ({ canonical_name: 'Milk', store: 'tesco', price: i }));
    const rows = await fetchCurrentExactOffers(['Milk', 'Milk'], 'canonical_name, store, price', ['tesco']);
    expect(rows).toHaveLength(2300);
    expect(state.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(state.filters).toEqual(expect.arrayContaining(['eq:relationship_type=exact', 'eq:freshness_state=fresh', 'in:store']));
  });
  it('makes no query for an empty basket', async () => {
    expect(await fetchCurrentExactOffers([], 'canonical_name')).toEqual([]);
    expect(state.ranges).toHaveLength(0);
  });
  it('throws on a read error so callers fail closed', async () => {
    state.error = { message: 'timeout' };
    await expect(fetchCurrentExactOffers(['Milk'], 'canonical_name')).rejects.toThrow('latest_prices lookup failed: timeout');
  });
});
