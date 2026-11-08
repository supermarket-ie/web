import { describe, expect, it } from 'vitest';
import { fetchTescoCollectedPageViaBrowser } from './tesco-browser-fetch';

const URL = 'https://www.tesco.ie/shop/en-IE/products/254877356';

// A genuine Tesco IE product page carries the discover JSON marker.
const genuineHtml = '<html><head><title>Tesco</title></head><body><script type="application/discover+json">{"product":{}}</script></body></html>';
const challengeHtml = '<html><head><title>Access Denied</title></head><body>Please complete the security checks</body></html>';

function renderer(result: { status: number | null; finalUrl?: string; html: string; retryAfter?: string | null }) {
  return async (url: string) => ({ status: result.status, finalUrl: result.finalUrl ?? url, html: result.html, retryAfter: result.retryAfter ?? null });
}

describe('tesco browser fetch — mirrors the fetch path classification', () => {
  it('classifies a genuine 200 product page as ok', async () => {
    const r = await fetchTescoCollectedPageViaBrowser(URL, { renderer: renderer({ status: 200, html: genuineHtml }) });
    expect(r.outcome).toBe('ok');
    expect(r.status).toBe(200);
    expect(r.html).toContain('application/discover+json');
  });

  it('treats an Akamai/challenge page as a hard access block even on HTTP 200', async () => {
    const r = await fetchTescoCollectedPageViaBrowser(URL, { renderer: renderer({ status: 200, html: challengeHtml }) });
    expect(r.outcome).toBe('access_block');
  });

  it('treats HTTP 403 as an access block', async () => {
    const r = await fetchTescoCollectedPageViaBrowser(URL, { renderer: renderer({ status: 403, html: '<html>denied</html>' }) });
    expect(r.outcome).toBe('access_block');
  });

  it('treats HTTP 429 as rate limited and preserves Retry-After', async () => {
    const r = await fetchTescoCollectedPageViaBrowser(URL, { renderer: renderer({ status: 429, html: '<html>slow down</html>', retryAfter: '120' }) });
    expect(r.outcome).toBe('rate_limited');
    expect(r.retryAfter).toBe('120');
  });

  it('treats an off-site final URL as an unsafe redirect (no trust in the destination)', async () => {
    const r = await fetchTescoCollectedPageViaBrowser(URL, { renderer: renderer({ status: 200, finalUrl: 'https://login.tesco.com/challenge', html: genuineHtml }) });
    expect(r.outcome).toBe('unsafe_redirect');
    expect(r.redirectUrl).toBe('https://login.tesco.com/challenge');
    expect(r.html).toBe('');
  });

  it('maps a renderer failure to a network_error (one attempt, no retry)', async () => {
    const r = await fetchTescoCollectedPageViaBrowser(URL, { renderer: async () => { const e = new Error('nav timeout'); e.name = 'TimeoutError'; throw e; } });
    expect(r.outcome).toBe('network_error');
    expect(r.transport?.timedOut).toBe(true);
  });

  it('rejects an unsafe collection URL before rendering', async () => {
    await expect(fetchTescoCollectedPageViaBrowser('https://evil.example/x', { renderer: renderer({ status: 200, html: genuineHtml }) }))
      .rejects.toThrow('Unsafe Tesco collection URL');
  });

  it('surfaces the browser ACTUAL identity (UA + Chromium version) via onBrowserIdentity', async () => {
    const identityRenderer = async (url: string) => ({
      status: 200, finalUrl: url, html: genuineHtml, retryAfter: null,
      browserIdentity: { userAgent: 'Mozilla/5.0 ... HeadlessChrome/140.0.0.0 ...', chromiumVersion: '140.0.7259.5' },
    });
    let captured: { userAgent: string | null; chromiumVersion: string | null } | null = null;
    await fetchTescoCollectedPageViaBrowser(URL, { renderer: identityRenderer, onBrowserIdentity: (id) => { captured = id; } });
    expect(captured).toEqual({ userAgent: 'Mozilla/5.0 ... HeadlessChrome/140.0.0.0 ...', chromiumVersion: '140.0.7259.5' });
  });
});
