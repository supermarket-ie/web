import { describe, expect, it, vi } from 'vitest';
// The governor module is server-only and imports the Supabase admin client; only its pure helpers are used here.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));
import { ChallengeError, classifyCaptureError, HttpStatusError, mergeFormItems, parseSearchBody, skuOf } from './barcode-search-response';
import { classifyBarcodeResult as classifyHits, type SearchHit } from './barcode-matching';
import type { CapturedItem } from './barcode-search-response';
// Captured items are SearchHits once unitOfSize is read back; the analysis step does the same narrowing.
const classifyBarcodeResult = (t: { name: string; brand: string | null }, items: CapturedItem[]) => classifyHits(t, items as unknown as SearchHit[]);

describe('barcode search response parsing (capture runner)', () => {
  it('a 200 challenge page or unexpected shape throws ChallengeError (reported to the governor, never not_found)', () => {
    expect(() => parseSearchBody('<html>Checking your browser</html>')).toThrow(ChallengeError);
    expect(() => parseSearchBody('{"message":"blocked"}')).toThrow(/unexpected_search_shape/);
    expect(() => parseSearchBody('null')).toThrow(ChallengeError);
  });
  it('an empty items array is a genuine not_found', () => {
    const p = parseSearchBody('{"total":0,"items":[]}');
    expect(p).toEqual({ total: 0, items: [] });
    expect(classifyBarcodeResult({ name: 'X 100g', brand: 'X' }, mergeFormItems([p])).outcome).toBe('not_found');
  });
  it('a non-string, non-number SKU is unattributable, not "[object Object]"', () => {
    expect(skuOf({ id: 1 })).toBe('');
    expect(skuOf(['1'])).toBe('');
    expect(skuOf(true)).toBe('');
    expect(skuOf(100684387)).toBe('100684387');
    expect(skuOf(' 100684387 ')).toBe('100684387');
  });
  it('a response whose only item has no SKU is held, not not_found', () => {
    const p = parseSearchBody('{"total":1,"items":[{"name":"Heinz Baked Beans 415g","brand":"Heinz"}]}');
    const items = mergeFormItems([p]);
    expect(items).toHaveLength(1);
    expect(classifyBarcodeResult({ name: 'Heinz Baked Beans 415g', brand: 'Heinz' }, items)).toMatchObject({ outcome: 'ambiguous', tier: 'held' });
  });
  it('multiple query forms: the same SKU merges to one hit; a second SKU from another form is ambiguous', () => {
    const f1 = parseSearchBody('{"total":1,"items":[{"sku":"1","name":"Heinz Baked Beans 415g","brand":"Heinz"}]}');
    const f2same = parseSearchBody('{"total":1,"items":[{"sku":"1","name":"Heinz Baked Beans 415g","brand":"Heinz"}]}');
    const f2other = parseSearchBody('{"total":1,"items":[{"sku":"2","name":"Heinz Beanz 4 Pack","brand":"Heinz"}]}');
    const t = { name: 'Heinz Baked Beans 415g', brand: 'Heinz' };
    expect(mergeFormItems([f1, f2same])).toHaveLength(1);
    expect(classifyBarcodeResult(t, mergeFormItems([f1, f2same])).tier).toBe('strong');
    expect(classifyBarcodeResult(t, mergeFormItems([f1, f2other])).outcome).toBe('ambiguous');
    expect(classifyBarcodeResult(t, mergeFormItems([f1, parseSearchBody('{"total":0,"items":[]}')])).sku).toBe('1');
  });
});

describe('capture error classification for the retailer governor', () => {
  it('challenge pages, 403/429/5xx and timeouts are denials; a 404 is not', () => {
    let challenge: unknown;
    try { parseSearchBody('<html>captcha</html>'); } catch (e) { challenge = e; }
    expect(classifyCaptureError(challenge).reason).toBe('challenge_page');
    expect(classifyCaptureError(new HttpStatusError(403, null)).reason).toBe('http_403');
    expect(classifyCaptureError(new HttpStatusError(429, '30'))).toMatchObject({ reason: 'http_429', retryAfterMs: 30000 });
    expect(classifyCaptureError(new HttpStatusError(503, null)).reason).toBe('http_503');
    const timeout = new Error('The operation was aborted due to timeout'); timeout.name = 'TimeoutError';
    expect(classifyCaptureError(timeout).reason).not.toBeNull();
    expect(classifyCaptureError(new HttpStatusError(404, null)).reason).toBeNull();
  });
});
