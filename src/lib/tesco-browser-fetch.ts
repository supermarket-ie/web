// Headless-browser transport for Tesco page retrieval (assessment / bounded
// test only). It renders the public product page with Playwright/Chromium and
// returns the SAME TescoPageResponse shape as the plain-fetch path, so the
// existing parser (parseTescoCollectedPage) and identity checks are reused
// verbatim — this module replaces ONLY the fetch, nothing downstream.
//
// It keeps the collector's contract: one attempt, no cookies/login/proxy
// rotation/challenge solving; a challenge or 401/403 is a hard access block;
// 429 is rate limited (Retry-After preserved). Chromium is NOT in the default
// worker image; this runs only in a browser-enabled image built for the test.

import {
  classifyTescoHtmlOutcome,
  isTescoCollectionUrl,
  type TescoPageResponse,
  type TescoFetchOutcome,
} from './tesco-direct-collection-core';

// Minimal structural types so we don't hard-import playwright at module load
// (the default worker image has the npm package but no browser binary).
type BrowserPageResult = {
  status: number | null;
  finalUrl: string;
  html: string;
  retryAfter: string | null;
  // The browser's ACTUAL identity used for the request (no spoofing), recorded
  // for the diagnostic: Chromium's own default user-agent and version.
  browserIdentity?: { userAgent: string | null; chromiumVersion: string | null };
};
export type BrowserRenderer = (url: string, timeoutMs: number) => Promise<BrowserPageResult>;

// Default renderer: launch headless Chromium, load the URL, return rendered HTML.
// Imported dynamically so importing THIS module never requires the browser.
async function playwrightRenderer(url: string, timeoutMs: number): Promise<BrowserPageResult> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    // Use Chromium's ACTUAL identity: do NOT set a userAgent or spoof headers.
    // Only locale is set (en-IE) for the Irish store; the UA, TLS/JA3 and all
    // headers are Playwright/Chromium's genuine defaults.
    const context = await browser.newContext({ locale: 'en-IE' });
    const page = await context.newPage();
    // Capture the browser's real identity for the diagnostic record.
    const chromiumVersion = browser.version();
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => null);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Give client-rendered product JSON a brief chance to settle (bounded).
    await page.waitForTimeout(Math.min(3_000, Math.max(0, timeoutMs - 1_000))).catch(() => {});
    const html = await page.content();
    return {
      status: response ? response.status() : null,
      finalUrl: page.url(),
      html,
      retryAfter: response ? response.headers()['retry-after'] ?? null : null,
      browserIdentity: { userAgent, chromiumVersion },
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Retrieve a Tesco page via a headless browser, returning the shared
 * TescoPageResponse. One attempt; classification identical to the fetch path.
 * `renderer` is injectable for tests (no real browser needed).
 */
export async function fetchTescoCollectedPageViaBrowser(
  url: string,
  options: {
    renderer?: BrowserRenderer;
    timeoutMs?: number;
    // Optional sink for the browser's ACTUAL identity (UA + Chromium version),
    // so a caller can record it in diagnostics without changing the shared
    // TescoPageResponse shape.
    onBrowserIdentity?: (identity: { userAgent: string | null; chromiumVersion: string | null }) => void;
  } = {},
): Promise<TescoPageResponse> {
  if (!isTescoCollectionUrl(url)) throw new Error('Unsafe Tesco collection URL');
  const renderer = options.renderer ?? playwrightRenderer;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const start = Date.now();
  try {
    const r = await renderer(url, timeoutMs);
    if (r.browserIdentity && options.onBrowserIdentity) options.onBrowserIdentity(r.browserIdentity);
    // A cross-origin / out-of-scope final URL is treated as an unsafe redirect,
    // exactly as the fetch path refuses to trust an off-site destination.
    if (!isTescoCollectionUrl(r.finalUrl)) {
      return { outcome: 'unsafe_redirect', status: r.status, finalUrl: url, redirectUrl: r.finalUrl,
        html: '', retryAfter: r.retryAfter, elapsedMs: Date.now() - start };
    }
    const outcome = classifyTescoHtmlOutcome(r.status, r.html);
    return { outcome, status: r.status, finalUrl: r.finalUrl, html: r.html,
      retryAfter: r.retryAfter, elapsedMs: Date.now() - start };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const timedOut = /timeout/i.test(name) || /timeout/i.test(error instanceof Error ? error.message : '');
    const outcome: TescoFetchOutcome = 'network_error';
    return { outcome, status: null, finalUrl: url, html: '', retryAfter: null, elapsedMs: Date.now() - start,
      transport: { phase: 'headers', timedOut, headersElapsedMs: null, redirectCount: 0,
        errorName: ['AbortError', 'TimeoutError', 'TypeError', 'Error'].includes(name) ? name : 'UnknownError',
        errorCode: null } };
  }
}
