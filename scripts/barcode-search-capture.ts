// READ-ONLY barcode-search capture for barcode-led discovery (one-off ECS task on the worker image).
// Input env G: base64(brotli(JSON [[key, form1, form2?], ...])) where forms come from normaliseGtin().queryForms.
// For each barcode it queries the Dunnes and SuperValu public storefront search through the existing retailer request
// governor, stops at the first query form that returns items, and logs ONE line per barcode:
//   BCAP {key, at, dunnes:{form,status,total,items[],sha256}, supervalu:{...}}
// It writes NOTHING to the database (no mappings, prices, receipts or evidence rows). Classification is done
// separately with src/lib/barcode-matching.ts.
import { brotliDecompressSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { withRetailerRequestSlot, RetailerBlockedError } from '@/lib/retailer-request-governor';

type Store = 'dunnes' | 'supervalu';
const GW: Record<Store, [string, string]> = {
  dunnes: ['https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258', 'https://www.dunnesstoresgrocery.com'],
  supervalu: ['https://storefrontgateway.supervalu.ie/api/stores/5550', 'https://shop.supervalu.ie'],
};
const headers = (site: string) => ({ Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  'x-site-host': site, 'x-site-location': 'HeadersBuilderInterceptor', 'x-correlation-id': randomUUID(), 'x-shopping-mode': '22222222-2222-2222-2222-222222222222' });
type Item = { sku?: unknown; name?: unknown; brand?: unknown; unitOfSize?: unknown; price?: unknown; available?: unknown };

async function search(store: Store, forms: string[]) {
  const [gw, site] = GW[store];
  let last: Record<string, unknown> = { status: null, total: 0, items: [] };
  for (const form of forms) {
    const url = `${gw}/search?q=${encodeURIComponent(form)}&take=5&page=1&skip=0`;
    const r = await withRetailerRequestSlot(store, async () => {
      const res = await fetch(url, { headers: headers(site), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const body = await res.text();
      if (res.status === 403 || res.status === 429 || res.status >= 500) throw new Error(`${store} HTTP ${res.status}`);
      return { status: res.status, body };
    });
    let j: { total?: number; items?: Item[] } = {};
    try { j = JSON.parse(r.body); } catch { j = {}; }
    const items = (j.items ?? []).slice(0, 5).map(i => ({ sku: String(i.sku ?? ''), name: String(i.name ?? ''), brand: typeof i.brand === 'string' ? i.brand : null,
      unitOfSize: i.unitOfSize ?? null, price: i.price ?? null, available: i.available ?? null }));
    last = { form, endpoint: url, status: r.status, total: Number(j.total ?? items.length), items, sha256: createHash('sha256').update(r.body).digest('hex') };
    if (items.length) break;
  }
  return last;
}

async function main() {
  const list = JSON.parse(brotliDecompressSync(Buffer.from(process.env.G ?? '', 'base64')).toString('utf8')) as string[][];
  let blocked: string | null = null;
  for (const [key, ...forms] of list) {
    const out: Record<string, unknown> = { key, at: new Date().toISOString() };
    for (const store of ['dunnes', 'supervalu'] as Store[]) {
      try { out[store] = await search(store, forms); }
      catch (e) {
        out[store] = { error: e instanceof Error ? e.message.slice(0, 120) : 'error' };
        if (e instanceof RetailerBlockedError) blocked = store;
      }
    }
    console.log('BCAP ' + JSON.stringify(out));
    if (blocked) { console.log(`BCAP_STOPPED ${blocked} circuit breaker open`); break; }
  }
  console.log('BCAP_DONE');
}
main().catch(e => { console.error(e); process.exit(1); });
