import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// server-only is a build marker; stub it so the guard module imports under test.
vi.mock('server-only', () => ({}));

const ENV_KEYS = ['APP_ENV', 'VERCEL_ENV', 'DISABLE_RETAILER_COLLECTION', 'DISABLE_OUTBOUND_EMAIL', 'NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_SITE_URL'] as const;
let saved: Record<string, string | undefined> = {};

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) {
    if (key in values) {
      const v = values[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  }
}

async function freshGuard() {
  vi.resetModules();
  return await import('@/lib/preview-guard');
}

async function freshRuntimeEnv() {
  vi.resetModules();
  return await import('@/lib/runtime-env');
}

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  // Start each test from a clean, production-like baseline.
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
});

describe('runtime-env', () => {
  it('prefers APP_ENV over VERCEL_ENV', async () => {
    setEnv({ APP_ENV: 'preview', VERCEL_ENV: 'production' });
    const { runtimeEnv, isPreviewEnv } = await freshRuntimeEnv();
    expect(runtimeEnv()).toBe('preview');
    expect(isPreviewEnv()).toBe(true);
  });

  it('falls back to VERCEL_ENV when APP_ENV is unset (unchanged Vercel behaviour)', async () => {
    setEnv({ VERCEL_ENV: 'preview' });
    const { isPreviewEnv } = await freshRuntimeEnv();
    expect(isPreviewEnv()).toBe(true);
  });

  it('defaults to production when neither is set', async () => {
    const { runtimeEnv, isPreviewEnv } = await freshRuntimeEnv();
    expect(runtimeEnv()).toBe('production');
    expect(isPreviewEnv()).toBe(false);
  });

  it('marks staging hosts as noindex regardless of env', async () => {
    setEnv({ APP_ENV: 'production', VERCEL_ENV: 'production' });
    const { isNoIndexEnv } = await freshRuntimeEnv();
    expect(isNoIndexEnv('https://staging.supermarket.ie')).toBe(true);
    expect(isNoIndexEnv('https://www.supermarket.ie')).toBe(false);
  });

  it('marks preview as noindex even with a clean hostname', async () => {
    setEnv({ APP_ENV: 'preview' });
    const { isNoIndexEnv } = await freshRuntimeEnv();
    expect(isNoIndexEnv('https://preview.example.awsapprunner.com')).toBe(true);
  });
});

describe('preview-guard', () => {
  it('blocks retailer collection and outbound email in preview', async () => {
    setEnv({ APP_ENV: 'preview' });
    const { retailerCollectionBlocked, outboundEmailBlocked } = await freshGuard();
    expect(retailerCollectionBlocked()).toBe(true);
    expect(outboundEmailBlocked()).toBe(true);
  });

  it('does NOT block in production (no behaviour change on Vercel)', async () => {
    setEnv({ APP_ENV: 'production', VERCEL_ENV: 'production' });
    const { retailerCollectionBlocked, outboundEmailBlocked } = await freshGuard();
    expect(retailerCollectionBlocked()).toBe(false);
    expect(outboundEmailBlocked()).toBe(false);
  });

  it('honours explicit global kill-switches in any environment', async () => {
    setEnv({ APP_ENV: 'production', DISABLE_RETAILER_COLLECTION: 'true', DISABLE_OUTBOUND_EMAIL: 'true' });
    const { retailerCollectionBlocked, outboundEmailBlocked } = await freshGuard();
    expect(retailerCollectionBlocked()).toBe(true);
    expect(outboundEmailBlocked()).toBe(true);
  });
});
