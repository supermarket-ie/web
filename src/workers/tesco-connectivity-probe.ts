// ONE-SHOT, NON-MUTATING Tesco connectivity probe for the AWS egress test.
//
// Makes AT MOST ONE HTTP request to a single pre-verified tesco.ie product URL
// using the EXISTING collection transport (fetchTescoCollectedPage — same honest
// UA, manual redirects, 20s timeout, and access_block/429/network/unsafe_redirect
// classification). It writes NOTHING to Supabase and performs no retries. It
// prints only non-sensitive diagnostics (outcome, status, timing, whether the
// expected SKU parsed, body length + sha256 prefix) — never raw HTML/body.
//
// Run (bounded one-off ECS task): PROBE_URL=<url> node --conditions=react-server \
//   --import tsx src/workers/tesco-connectivity-probe.ts
import {
  fetchTescoCollectedPage, isTescoCollectionUrl, parseTescoCollectedPage,
} from '../lib/tesco-direct-collection-core';

async function main() {
  const url = process.env.PROBE_URL ?? '';
  if (!isTescoCollectionUrl(url)) {
    console.log(JSON.stringify({ probe: 'error', reason: 'PROBE_URL is not a valid tesco collection URL' }));
    process.exit(2);
  }
  const expectedSku = url.match(/\/products\/(\d+)$/)?.[1] ?? null;

  const started = Date.now();
  const resp = await fetchTescoCollectedPage(url); // single attempt, existing transport
  const elapsedMs = Date.now() - started;

  // Parse ONLY to report whether the expected product datum was accessible.
  // No writes, no finalisation, no identity-trust decision persisted.
  let skuMatched = false;
  let parsedOk = false;
  let priceAccessible = false;
  if (resp.outcome === 'ok') {
    try {
      const page = parseTescoCollectedPage(resp.html, resp.finalUrl);
      parsedOk = true;
      const p = page.products.find((x) => x.sku === expectedSku);
      skuMatched = Boolean(p);
      priceAccessible = Boolean(p && p.price !== null && p.available);
    } catch {
      parsedOk = false;
    }
  }

  // Restriction classification is already in resp.outcome. Stop rules honoured by
  // the transport itself (single attempt, no retry/proxy).
  const restriction =
    resp.outcome === 'access_block' ? 'access_block(401/403/akamai_challenge)'
    : resp.outcome === 'rate_limited' ? 'rate_limited(429)'
    : resp.outcome === 'unsafe_redirect' ? 'unsafe_redirect'
    : resp.outcome === 'network_error' ? 'network_error'
    : resp.outcome === 'http_error' ? `http_error(${resp.status})`
    : null;

  console.log(JSON.stringify({
    probe: 'result',
    url_sku: expectedSku,
    http_status: resp.status,
    outcome: resp.outcome,
    restriction,
    retry_after: resp.retryAfter ?? null,
    elapsed_ms: elapsedMs,
    expected_product_accessible: skuMatched,
    parsed_ok: parsedOk,
    price_accessible: priceAccessible,
    body_bytes: resp.html ? resp.html.length : 0,
    final_url_same_origin: resp.finalUrl.startsWith('https://www.tesco.ie/'),
    transport: resp.transport ?? null,
  }));

  // Non-zero exit on any restriction so ECS marks the task accordingly.
  process.exit(resp.outcome === 'ok' ? 0 : 1);
}

main().catch((e) => {
  // Do not print driver/connector internals.
  console.log(JSON.stringify({ probe: 'fatal', message: e instanceof Error ? e.name : 'error' }));
  process.exit(1);
});
