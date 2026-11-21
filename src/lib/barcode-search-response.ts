// Parsing of one Dunnes/SuperValu storefront search response for barcode-led discovery (used by
// scripts/barcode-search-capture.ts). Small on purpose: it is bundled into the one-off ECS runner, with the governor
// left external (it is already in the deployed image).
import { denialReason, parseRetryAfterMs, type ErrorClassification } from '@/lib/retailer-request-governor';

/** A 200 whose body is not the search JSON (bot challenge / interstitial). Callers report it to the governor as a denial. */
export class ChallengeError extends Error {
  constructor(detail: string) { super(`challenge_page ${detail}`); this.name = 'ChallengeError'; }
}
/** A non-200 response, with its Retry-After header. */
export class HttpStatusError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null) { super(`HTTP ${status}`); this.name = 'HttpStatusError'; }
}
/**
 * Governor classification of a thrown capture error: 403/429/5xx, timeouts/network errors and challenge pages are
 * denials (they count toward the circuit breaker); anything else (e.g. 404) is an error but not a denial.
 */
export function classifyCaptureError(e: unknown): ErrorClassification {
  if (e instanceof HttpStatusError) return { reason: denialReason({ status: e.status }), retryAfterMs: parseRetryAfterMs(e.retryAfter) };
  if (e instanceof ChallengeError) return { reason: 'challenge_page' };
  return { reason: denialReason({ errorReason: e instanceof Error ? `${e.name} ${e.message}` : String(e) }) };
}

export type CapturedItem = { sku: string; name: string; brand: string | null; unitOfSize: unknown; price: unknown; available: unknown };

/** A SKU is a non-empty string or a finite number. Anything else (object, array, boolean) is unattributable: ''. */
export function skuOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Parse a 200 body. Throws ChallengeError for a non-JSON body or a body without an `items` array. */
export function parseSearchBody(text: string): { total: number; items: CapturedItem[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ChallengeError('non_json_200'); }
  const j = parsed as { total?: unknown; items?: unknown } | null;
  if (!j || typeof j !== 'object' || !Array.isArray(j.items)) throw new ChallengeError('unexpected_search_shape');
  const items = (j.items as Array<Record<string, unknown> | null>).slice(0, 5).map(i => ({
    sku: skuOf(i?.sku), name: typeof i?.name === 'string' ? i.name : '', brand: typeof i?.brand === 'string' ? i.brand : null,
    unitOfSize: i?.unitOfSize ?? null, price: i?.price ?? null, available: i?.available ?? null,
  }));
  return { total: Number.isFinite(Number(j.total)) ? Number(j.total) : items.length, items };
}

/**
 * Merge items across every query form: one entry per SKU (first seen wins), and EVERY SKU-less item kept, so the
 * classifier holds an unattributable response instead of reading it as not found or as one clean hit.
 */
export function mergeFormItems(perForm: Array<{ items: CapturedItem[] }>): CapturedItem[] {
  const all = perForm.flatMap(f => f.items);
  const bySku = new Map<string, CapturedItem>();
  for (const i of all) if (i.sku && !bySku.has(i.sku)) bySku.set(i.sku, i);
  return [...bySku.values(), ...all.filter(i => !i.sku)];
}
