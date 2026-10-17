import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// A minimal fake Supabase client that records calls. `.from()` returns a builder
// exposing insert/update/upsert/delete/select; `.rpc()` echoes its name.
function makeFakeClient() {
  const calls: string[] = [];
  const builder = {
    insert: () => { calls.push('insert'); return { data: [], error: null }; },
    update: () => { calls.push('update'); return { data: [], error: null }; },
    upsert: () => { calls.push('upsert'); return { data: [], error: null }; },
    delete: () => { calls.push('delete'); return { data: [], error: null }; },
    select: () => { calls.push('select'); return { data: [], error: null }; },
  };
  const client = {
    from: () => builder,
    rpc: (fn: string) => { calls.push(`rpc:${fn}`); return { data: null, error: null }; },
  };
  return { client, calls };
}

let fake = makeFakeClient();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => fake.client,
}));

const ENV = ['APP_ENV', 'VERCEL_ENV', 'SUPABASE_READ_ONLY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  fake = makeFakeClient();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

async function freshSupabase() {
  vi.resetModules();
  return await import('@/lib/supabase');
}

describe('supabaseAdmin read-only guard (preview isolation)', () => {
  it('blocks insert/update/upsert/delete in preview', async () => {
    process.env.APP_ENV = 'preview';
    const { supabaseAdmin, PreviewReadOnlyError } = await freshSupabase();
    for (const op of ['insert', 'update', 'upsert', 'delete'] as const) {
      expect(() => (supabaseAdmin.from('products') as unknown as Record<string, () => unknown>)[op]()).toThrow(PreviewReadOnlyError);
    }
    // No write reached the underlying client.
    expect(fake.calls.filter((c) => ['insert', 'update', 'upsert', 'delete'].includes(c))).toHaveLength(0);
  });

  it('allows select in preview', async () => {
    process.env.APP_ENV = 'preview';
    const { supabaseAdmin } = await freshSupabase();
    expect(() => supabaseAdmin.from('products').select('id')).not.toThrow();
    expect(fake.calls).toContain('select');
  });

  it('blocks write RPCs and the Pepesto credential RPC, allows a pure read RPC', async () => {
    process.env.APP_ENV = 'preview';
    const { supabaseAdmin, PreviewReadOnlyError } = await freshSupabase();
    // Writes blocked.
    expect(() => supabaseAdmin.rpc('finalize_tesco_scrape_product', {})).toThrow(PreviewReadOnlyError);
    // Third-party credential fetch blocked (no Pepesto calls from the preview).
    expect(() => supabaseAdmin.rpc('get_pepesto_api_key')).toThrow(PreviewReadOnlyError);
    // Pure read RPC allowed.
    expect(() => supabaseAdmin.rpc('match_product_search_embeddings', {})).not.toThrow();
    expect(fake.calls).toContain('rpc:match_product_search_embeddings');
    expect(fake.calls).not.toContain('rpc:get_pepesto_api_key');
    expect(fake.calls).not.toContain('rpc:finalize_tesco_scrape_product');
  });

  it('does NOT wrap the client in production (writes pass through)', async () => {
    process.env.APP_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    const { supabaseAdmin } = await freshSupabase();
    expect(() => supabaseAdmin.from('products').insert({})).not.toThrow();
    expect(fake.calls).toContain('insert');
  });

  it('honours the explicit SUPABASE_READ_ONLY flag outside preview', async () => {
    process.env.APP_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.SUPABASE_READ_ONLY = 'true';
    const { supabaseAdmin, PreviewReadOnlyError } = await freshSupabase();
    expect(() => supabaseAdmin.from('products').insert({})).toThrow(PreviewReadOnlyError);
  });
});
