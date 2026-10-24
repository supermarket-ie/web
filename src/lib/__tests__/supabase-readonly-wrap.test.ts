import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSupabaseReadOnly, PreviewReadOnlyError, supabaseReadOnly } from '@/lib/supabase-readonly-wrap';
import type { SupabaseClient } from '@supabase/supabase-js';

// The shared wrapper is used by BOTH src/lib/supabase.ts and agent/lib/supabase.ts,
// so these assertions cover the Eve agent client's read-only behaviour too.

function fakeClient() {
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
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ENV = ['APP_ENV', 'VERCEL_ENV', 'SUPABASE_READ_ONLY'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

describe('makeSupabaseReadOnly (shared by website + agent clients)', () => {
  it('blocks every mutating builder method', () => {
    const { client } = fakeClient();
    const ro = makeSupabaseReadOnly(client);
    for (const op of ['insert', 'update', 'upsert', 'delete'] as const) {
      expect(() => (ro.from('t') as unknown as Record<string, () => unknown>)[op]()).toThrow(PreviewReadOnlyError);
    }
  });

  it('allows select and the allowlisted read RPC, blocks other RPCs', () => {
    const { client, calls } = fakeClient();
    const ro = makeSupabaseReadOnly(client);
    expect(() => ro.from('t').select('id')).not.toThrow();
    expect(() => ro.rpc('match_product_search_embeddings', {})).not.toThrow();
    expect(() => ro.rpc('finalize_tesco_scrape_product', {})).toThrow(PreviewReadOnlyError);
    expect(() => ro.rpc('get_pepesto_api_key')).toThrow(PreviewReadOnlyError);
    expect(calls).toContain('select');
    expect(calls).toContain('rpc:match_product_search_embeddings');
  });
});

describe('supabaseReadOnly()', () => {
  it('is true in preview and via the explicit flag; false in production', () => {
    process.env.APP_ENV = 'preview';
    expect(supabaseReadOnly()).toBe(true);
    delete process.env.APP_ENV;
    process.env.VERCEL_ENV = 'production';
    process.env.SUPABASE_READ_ONLY = 'true';
    expect(supabaseReadOnly()).toBe(true);
    delete process.env.SUPABASE_READ_ONLY;
    expect(supabaseReadOnly()).toBe(false);
  });
});
