import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), release: vi.fn(), success: vi.fn(), rpc: vi.fn(), from: vi.fn(), cache: [] as unknown[], gateCount: 1,
}));
vi.mock('@/lib/tesco-egress', () => ({ claimTescoEgress: mocks.claim, releaseTescoEgress: mocks.release, markTescoEgressSuccess: mocks.success }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }));
import { collectTescoDirect } from './tesco-direct-collection';

const product = { id: '123456789', tpnc: '123456789', title: 'Tesco Whole Milk 1L', brandName: 'TESCO', price: { actual: 1.15 }, isForSale: true, status: 'AvailableForSale' };
const html = `<p>€1.15</p><script type="application/discover+json">${JSON.stringify({ 'mfe-orchestrator': { props: { config: { global: { locale: 'en-IE' } }, apolloCache: { ROOT_QUERY: { 'product({"tpnc":"123456789"})': { __ref: 'ProductType:123456789' } }, 'ProductType:123456789': product } } } })}</script>`;

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  mocks.cache = [];
  mocks.gateCount = 1;
  mocks.claim.mockResolvedValue({ egressKey: 'test', label: 'test' });
  mocks.release.mockResolvedValue(undefined);
  mocks.success.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.from.mockImplementation((table: string) => {
    let action = 'select';
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'order', 'range', 'insert', 'update', 'single']) {
      builder[method] = () => { if (method === 'insert' || method === 'update') action = method; return builder; };
    }
    builder.then = (resolve: (value: unknown) => void) => {
      let data: unknown = [];
      if (table === 'store_products') data = [{ id: 'mapping', product_id: 'canonical', store_sku: '123456789', store_url: 'https://www.tesco.ie/shop/en-IE/products/123456789', store_product_name: product.title, brand: 'TESCO', is_own_brand: true, url_status: 'resolved', products: { canonical_name: 'Whole Milk 1L', brand: null } }];
      if (table === 'tesco_direct_collection_pages') data = action === 'insert' ? { id: 'page' } : action === 'select' ? mocks.cache : null;
      if (table === 'scrape_runs' && action === 'insert') data = { id: 'run' };
      resolve({ data, error: null, count: mocks.gateCount });
    };
    return builder;
  });
});

describe('Tesco collection orchestration', () => {
  it('makes no outbound request when disabled or cooling down', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    mocks.claim.mockResolvedValue(null);
    expect((await collectTescoDirect({ mode: 'probe' })).status).toBe('cooldown_or_disabled');
    expect(fetcher).not.toHaveBeenCalled();
    mocks.gateCount = 2;
    await collectTescoDirect({ mode: 'probe' });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });
  it('stops the entire probe at the first 403 and persists quarantine without writing prices', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })); vi.stubGlobal('fetch', fetcher);
    const result = await collectTescoDirect({ mode: 'probe' });
    expect(result).toMatchObject({ status: 'access_block', requests: 1, pricesWritten: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('pause_tesco_collection_egress', expect.objectContaining({ p_blocked: true, p_egress_key: 'test' }));
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it('stops on 429 instead of retrying or requesting the listing', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('Limited', { status: 429, headers: { 'Retry-After': '7200' } })); vi.stubGlobal('fetch', fetcher);
    const before = Date.now();
    expect((await collectTescoDirect({ mode: 'probe' })).status).toBe('rate_limited');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const pause = mocks.rpc.mock.calls.find(c => c[0] === 'pause_tesco_collection_egress')![1];
    expect(Date.parse(pause.p_until)).toBeGreaterThanOrEqual(before + 7200_000);
    expect(pause.p_blocked).toBe(false);
  });
  it('writes a validated direct observation through the idempotent finaliser and releases once', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(html)); vi.stubGlobal('fetch', fetcher);
    expect(await collectTescoDirect({ mode: 'products', maxPages: 1 })).toMatchObject({ status: 'complete', requests: 1, pricesWritten: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith('finalize_store_scrape_product', expect.objectContaining({ p_store: 'tesco', p_store_product_id: 'mapping', p_price: 1.15, p_on_promotion: false }));
    expect(mocks.claim).toHaveBeenCalledWith(600);
    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it('does not refetch or redate cached product evidence', async () => {
    mocks.cache = [{ requested_url: 'https://www.tesco.ie/shop/en-IE/products/123456789', outcome: 'ok', parsed: null }];
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await collectTescoDirect({ mode: 'products', maxPages: 1 })).status).toBe('no_due_products');
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});
