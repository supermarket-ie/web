import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalise, safeProductUrl, type Evidence } from './branded-product-identity';

export const RESPONSE_PARSER_VERSION = 'retailer-identity-response-v1';
export type IdentityResponse = {
  store: 'supervalu' | 'dunnes'; sku: string; product_url: string;
  requested_url: string; final_url: string; retrieved_at: string;
  content_type: string; body_text: string; body_sha256: string;
  parser_version: string; source_kind: 'captured_product' | 'captured_listing';
  source_path: string; identity: Record<string, unknown>;
};
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
function label(v: unknown): string | null {
  if (typeof v === 'string') return v;
  const o = object(v); return typeof o?.name === 'string' ? o.name : null;
}
export const responseHash = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex');
function sources(body: string): { value: unknown; path: string }[] {
  try { return [{ value: JSON.parse(body), path: '$' }]; } catch { /* HTML */ }
  const result: { value: unknown; path: string }[] = [];
  for (const [i, match] of [...body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
    const raw = match[1].trim();
    try { result.push({ value: JSON.parse(raw), path: `script[${i}]` }); continue; } catch { /* assigned state */ }
    const start = raw.indexOf('__PRELOADED_STATE__');
    if (start < 0) continue;
    const jsonStart = raw.indexOf('{', start), jsonEnd = raw.lastIndexOf('}');
    try { result.push({ value: JSON.parse(raw.slice(jsonStart, jsonEnd + 1)), path: `script[${i}].__PRELOADED_STATE__` }); } catch { /* not a complete JSON state */ }
  }
  return result;
}
/** Reparse the actual decoded HTTP response. Never construct proof from a mapped title. */
export function captureIdentityResponse(args: {
  store: IdentityResponse['store']; sku: string | null; title: string; productUrl: string | null | undefined;
  requestedUrl: string; finalUrl: string; contentType: string; body: string; retrievedAt?: string;
}): IdentityResponse | null {
  const { store, sku, body } = args;
  if (!sku || !args.productUrl || !safeProductUrl({ store, sku, url: args.productUrl }) || Buffer.byteLength(body, 'utf8') > 4 * 1024 * 1024) return null;
  const hosts = store === 'supervalu' ? ['shop.supervalu.ie', 'storefrontgateway.supervalu.ie'] : ['www.dunnesstoresgrocery.com', 'storefrontgateway.dunnesstoresgrocery.com'];
  for (const value of [args.requestedUrl, args.finalUrl]) {
    try { const u = new URL(value); if (u.protocol !== 'https:' || !hosts.includes(u.host) || u.username || u.password || u.hash) return null; } catch { return null; }
  }
  const found: { node: Record<string, unknown>; path: string }[] = [];
  let visited = 0;
  function walk(value: unknown, path: string, depth = 0) {
    if (++visited > 20000 || depth > 30) return;
    if (Array.isArray(value)) { value.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1)); return; }
    const node = object(value); if (!node) return;
    const nodeSku = node.sku ?? node.productId;
    if (nodeSku != null && String(nodeSku) === sku && typeof node.name === 'string') found.push({ node, path });
    for (const [key, child] of Object.entries(node)) if (typeof child === 'object') walk(child, `${path}.${key}`, depth + 1);
  }
  for (const root of sources(body)) walk(root.value, root.path);
  if (!found.length || visited > 20000) return null;
  // Multiple copies must agree on their identity attributes, not only their SKU.
  const attrs = (n: Record<string, unknown>) => ({ title: label(n.name), brand: label(n.brand), manufacturer: label(n.manufacturer),
    gtin: label(n.gtin13 ?? n.gtin ?? n.ean ?? n.barcode), description: label(n.description), ingredients: label(n.ingredients),
    quantity: n.quantity ?? null, packSize: n.packSize ?? n.size ?? null, packCount: n.packCount ?? null,
    variant: n.variant ?? null, flavour: n.flavour ?? n.flavor ?? null, formulation: n.formulation ?? null });
  const identities = found.map(x => attrs(x.node));
  if (new Set(identities.map(x => JSON.stringify(x))).size !== 1 || normalise(identities[0].title ?? '') !== normalise(args.title)) return null;
  const direct = args.requestedUrl === args.productUrl && args.finalUrl === args.productUrl;
  return { store, sku, product_url: args.productUrl, requested_url: args.requestedUrl, final_url: args.finalUrl,
    retrieved_at: args.retrievedAt ?? new Date().toISOString(), content_type: args.contentType.slice(0, 120),
    body_text: body, body_sha256: responseHash(body), parser_version: RESPONSE_PARSER_VERSION,
    source_kind: direct ? 'captured_product' : 'captured_listing', source_path: found[0].path, identity: identities[0] };
}
export function evidenceFromResponse(row: IdentityResponse & { id: string }): Omit<Evidence, 'id' | 'mappingIds' | 'canonicalIds' | 'conflicts'> | null {
  if (row.body_sha256 !== responseHash(row.body_text) || row.parser_version !== RESPONSE_PARSER_VERSION) return null;
  const parsed = captureIdentityResponse({ store: row.store, sku: row.sku, title: String(row.identity.title ?? ''), productUrl: row.product_url,
    requestedUrl: row.requested_url, finalUrl: row.final_url, contentType: row.content_type, body: row.body_text, retrievedAt: row.retrieved_at });
  if (!parsed || parsed.source_path !== row.source_path || !isDeepStrictEqual(parsed.identity, row.identity) || parsed.source_kind !== row.source_kind) return null;
  const i = parsed.identity;
  return { store: row.store, sku: row.sku, url: row.product_url, title: String(i.title), brand: label(i.brand), manufacturer: label(i.manufacturer),
    gtin: label(i.gtin), description: label(i.description), ingredients: label(i.ingredients),
    source: { kind: parsed.source_kind, ref: row.id, at: row.retrieved_at, url: row.requested_url, hash: row.body_sha256, archiveRef: `retailer_identity_responses:${row.id}` },
    lastLiveVerifiedAt: parsed.source_kind === 'captured_product' ? row.retrieved_at : null };
}
