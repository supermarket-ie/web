// Supervised one-page collector. No database credentials and no retry/failover.
// Public page evidence goes to stdout; caller persists it privately before continuing.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const core = (await import(pathToFileURL(process.argv[2]).href)).default;
const mappings = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const url = process.argv[4];
if (!core.isTescoCollectionUrl(url)) throw new Error('Invalid Tesco URL');
(async () => {
  const response = await core.fetchTescoCollectedPage(url);
  const observedAt = new Date().toISOString();
  let parsed = null;
  let outcome = response.outcome;
  let detail = null;
  try {
    if (outcome === 'ok') parsed = core.parseTescoCollectedPage(response.html, response.finalUrl);
  } catch (error) { outcome = 'parse_error'; detail = error.message; }
  const identities = (parsed?.products ?? []).flatMap(product => mappings.filter(m => m.store_sku === product.sku).map(row => {
    const peers = mappings.filter(m => m.store_sku === row.store_sku);
    const mapping = {
      storeProductId: row.id, canonicalName: row.canonical_name, canonicalBrand: row.canonical_brand,
      storeProductName: row.store_product_name, storeBrand: row.store_brand, isOwnBrand: row.is_own_brand,
      storeSku: row.store_sku, storeUrl: row.store_url, duplicateSkuCount: peers.length,
      duplicateCanonicalNames: peers.map(m => m.canonical_name), isFresh: false,
    };
    return { storeProductId: row.id, sku: product.sku,
      reasons: row.url_status === 'resolved' ? core.validateTescoCollectedIdentity(mapping, product) : ['mapping_not_resolved'] };
  }));
  const resourceUnavailable = core.tescoResourceUnavailable(response);
  const stopCollection = outcome !== 'ok' && !resourceUnavailable;
  console.log(JSON.stringify({ requestedUrl: url, finalUrl: response.finalUrl, redirectUrl: response.redirectUrl, outcome, observedAt,
    status: response.status, retryAfter: response.retryAfter, elapsedMs: response.elapsedMs,
    bodySha256: createHash('sha256').update(response.html).digest('hex'), parsed, identities,
    detail: detail ?? (resourceUnavailable ? 'resource_unavailable; redirect not followed' : response.redirectUrl ? `rejected_redirect: ${response.redirectUrl}` : null),
    resourceUnavailable, stopCollection,
    pauseUntil: stopCollection ? core.tescoPauseUntil(response.outcome === 'ok' ? 'http_error' : response.outcome, response.retryAfter) : null }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
