// READ-ONLY barcode-search capture for barcode-led discovery (one-off ECS task on the worker image).
// Input env G: base64(brotli(JSON [[key, form1, form2?], ...])) where forms come from normaliseGtin().queryForms.
// For each barcode it queries the Dunnes and SuperValu public storefront search through the existing retailer request
// governor, for EVERY query form (so a second form resolving to a different SKU is visible as ambiguity), and logs ONE
// line per barcode:
//   BCAP {key, at, dunnes:{forms:[{form,endpoint,status,total,items[],sha256,at}], items[]}, supervalu:{...}}
// Any non-200 response or unparseable body is recorded as an ERROR for that retailer, never as "not found".
// 403/429/5xx/timeouts and 200 challenge pages (non-JSON / unexpected shape) are reported to the governor as denials, so its circuit breaker can open; an open breaker
// stops the run (exit code 2). It writes NOTHING to the database. Classification: src/lib/barcode-matching.ts.
import { brotliDecompressSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { denialReason, parseRetryAfterMs, withRetailerRequestSlot, RetailerBlockedError } from '@/lib/retailer-request-governor';
import { ChallengeError, mergeFormItems, parseSearchBody } from '@/lib/barcode-search-response';

type Store = 'dunnes' | 'supervalu';
const GW: Record<Store, [string, string]> = {
  dunnes: ['https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258', 'https://www.dunnesstoresgrocery.com'],
  supervalu: ['https://storefrontgateway.supervalu.ie/api/stores/5550', 'https://shop.supervalu.ie'],
};
const headers = (site: string) => ({ Accept: 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  'x-site-host': site, 'x-site-location': 'HeadersBuilderInterceptor', 'x-correlation-id': randomUUID(), 'x-shopping-mode': '22222222-2222-2222-2222-222222222222' });
class HttpError extends Error { constructor(readonly status: number, readonly retryAfter: string | null) { super(`HTTP ${status}`); } }
// A 200 whose body is not the search JSON (a bot challenge / interstitial) is a DENIAL: it must reach the governor so
// repeated challenges open the circuit breaker, exactly like a 403.
const classifyError = (e: unknown) => e instanceof HttpError
  ? { reason: denialReason({ status: e.status }), retryAfterMs: parseRetryAfterMs(e.retryAfter) }
  : e instanceof ChallengeError ? { reason: 'challenge_page' }
  : { reason: denialReason({ errorReason: e instanceof Error ? `${e.name} ${e.message}` : String(e) }) };

async function searchForm(store: Store, form: string) {
  const [gw, site] = GW[store];
  const endpoint = `${gw}/search?q=${encodeURIComponent(form)}&take=5&page=1&skip=0`;
  const at = new Date().toISOString();
  const { body, parsed } = await withRetailerRequestSlot(store, async () => {
    const res = await fetch(endpoint, { headers: headers(site), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    if (res.status !== 200) throw new HttpError(res.status, res.headers.get('retry-after'));
    return { body: text, parsed: parseSearchBody(text) };   // throws ChallengeError inside the slot => a governed denial
  }, { classifyError });
  return { form, endpoint, status: 200, total: parsed.total, items: parsed.items, sha256: createHash('sha256').update(body).digest('hex'), at };
}

async function main() {
  const list = JSON.parse(brotliDecompressSync(Buffer.from(process.env.G ?? '', 'base64')).toString('utf8')) as string[][];
  let blocked: string | null = null;
  for (const [key, ...forms] of list) {
    const out: Record<string, unknown> = { key, at: new Date().toISOString() };
    for (const store of ['dunnes', 'supervalu'] as Store[]) {
      try {
        const perForm = [];
        for (const form of forms) perForm.push(await searchForm(store, form));
        const items = mergeFormItems(perForm);   // one per SKU across forms; SKU-less items kept so they are held
        out[store] = { forms: perForm, items, total: items.length };
      } catch (e) {
        out[store] = { error: e instanceof Error ? e.message.slice(0, 120) : 'error' };
        if (e instanceof RetailerBlockedError) blocked = store;
      }
    }
    console.log('BCAP ' + JSON.stringify(out));
    if (blocked) { console.log(`BCAP_STOPPED ${blocked} circuit breaker open or slot wait exhausted`); process.exitCode = 2; break; }
  }
  console.log('BCAP_DONE');
}
main().catch(e => { console.error(e); process.exit(1); });
