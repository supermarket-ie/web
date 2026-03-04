import type { ErrorCode } from './types';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function jitter(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type FetchSuccess = { ok: true; html: string; status: number; attempts: number };
export type FetchFailure = { ok: false; status: number; error: string; errorCode: ErrorCode; attempts: number };
export type FetchResult = FetchSuccess | FetchFailure;

const BLOCK_MARKERS = [
  'captcha',
  'CAPTCHA',
  'Access Denied',
  'cf-browser-verification',
  'checking your browser',
  'Enable JavaScript and cookies',
  'Please enable cookies',
];

function detectBlock(html: string): boolean {
  return BLOCK_MARKERS.some((m) => html.includes(m));
}

export async function fetchWithRetry(
  url: string,
  opts: {
    timeoutMs?: number;
    maxAttempts?: number;
    delayMinMs?: number;
    delayMaxMs?: number;
  } = {},
): Promise<FetchResult> {
  const {
    timeoutMs = 12_000,
    maxAttempts = 3,
    delayMinMs = 100,
    delayMaxMs = 600,
  } = opts;

  const proxyUrl = process.env.USE_PROXY === 'true' ? process.env.PROXY_URL : undefined;

  let lastStatus = 0;
  let lastError = '';
  let lastErrorCode: ErrorCode = 'UNKNOWN';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      // Exponential backoff: 1s, 3s, 9s + jitter
      const backoffMs = Math.pow(3, attempt - 2) * 1000 + jitter(0, 500);
      await sleep(backoffMs);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchTarget = proxyUrl ?? url;
      const headers: Record<string, string> = {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-IE,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      };
      if (proxyUrl) {
        headers['X-Proxy-Target-URL'] = url;
      }

      const resp = await fetch(fetchTarget, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeoutId);
      lastStatus = resp.status;

      if (resp.status === 404) {
        return { ok: false, status: 404, error: 'Not found', errorCode: 'NOT_FOUND', attempts: attempt };
      }

      if (resp.status === 403) {
        // Hard block — do not retry
        return { ok: false, status: 403, error: 'Access blocked (403)', errorCode: 'BLOCKED', attempts: attempt };
      }

      if (resp.status === 429) {
        // Rate limited — back off and retry
        lastError = 'Rate limited (429)';
        lastErrorCode = 'BLOCKED';
        const retryAfter = resp.headers.get('Retry-After');
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : jitter(3000, 10000);
        await sleep(waitMs);
        continue;
      }

      if (resp.status >= 500) {
        lastError = `Server error (${resp.status})`;
        lastErrorCode = 'HTTP_ERROR';
        continue; // retry on 5xx
      }

      if (!resp.ok) {
        return {
          ok: false,
          status: resp.status,
          error: `HTTP ${resp.status}`,
          errorCode: 'HTTP_ERROR',
          attempts: attempt,
        };
      }

      const html = await resp.text();

      if (detectBlock(html)) {
        return { ok: false, status: resp.status, error: 'Bot detection triggered', errorCode: 'BLOCKED', attempts: attempt };
      }

      // Inter-request jitter
      await sleep(jitter(delayMinMs, delayMaxMs));

      return { ok: true, html, status: resp.status, attempts: attempt };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      if (isTimeout) {
        lastError = 'Request timed out';
        lastErrorCode = 'TIMEOUT';
        continue; // retry on timeout
      }
      lastError = err instanceof Error ? err.message : 'Unknown network error';
      lastErrorCode = 'HTTP_ERROR';
      // retry on network errors
    }
  }

  return {
    ok: false,
    status: lastStatus,
    error: lastError || 'Max attempts exceeded',
    errorCode: lastErrorCode,
    attempts: maxAttempts,
  };
}
