import { beforeEach, describe, expect, it, vi } from 'vitest';

// Captures what the public share route persists. Client totals and "verified" labels are forgeable.
const insert = vi.hoisted(() => vi.fn<(row: Record<string, unknown>) => Promise<{ error: null }>>(async () => ({ error: null })));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: () => ({ insert }) } }));
import { POST } from './route';

const post = (body: unknown) => POST(new Request('https://example.test/api/share', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/share', () => {
  beforeEach(() => insert.mockClear());
  it('drops client-supplied store totals even when they claim a verified basis', async () => {
    const res = await post({ family_size: '2', items: [{ canonical_name: 'Muesli', price_comparison: 'indicative' }],
      store_totals: [{ store: 'supervalu', total: 1, basis: 'verified_exact' }] });
    expect(res.status).toBe(200);
    expect(insert.mock.calls[0][0].store_totals).toEqual([]);
  });
  it('stores a client-claimed verified item label as indicative', async () => {
    await post({ family_size: '2', items: [{ canonical_name: 'Chilli', price_comparison: 'verified_exact' }, { canonical_name: 'Muesli', price_comparison: 'different_products' }] });
    expect(insert.mock.calls[0][0].items).toEqual([
      { canonical_name: 'Chilli', price_comparison: 'indicative' },
      { canonical_name: 'Muesli', price_comparison: 'different_products' },
    ]);
  });
  it('no longer requires store totals, but still requires items', async () => {
    expect((await post({ family_size: '2', items: [] })).status).toBe(400);
    expect((await post({ family_size: '2', items: 'x' })).status).toBe(400);
  });
});
