// Test-only harness: a PGlite database carrying the REAL Apify migrations and
// the REAL price finaliser, plus a minimal PostgREST-compatible client so the
// production TypeScript collector / approval code runs against it unchanged.
// It covers only the query shapes those modules use (select with embeds,
// eq/neq/gt/gte/lt/lte/in/is/not-is-null, order, range, limit, maybeSingle, rpc).
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';

const BASE_SCHEMA = `
create role anon; create role authenticated; create role service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.scrape_runs (
  id uuid primary key, store text, run_id text, target_count int, retrieval_method text,
  run_scope text, status text, started_at timestamptz, finished_at timestamptz,
  duration_seconds int, attempted_count int default 0, fetched int default 0, extracted int default 0,
  inserted int default 0, unchanged_count int default 0, failed int default 0,
  silently_skipped_count int default 0, threshold_pct numeric default 70, threshold_breached boolean default false,
  coverage_pct numeric, error_summary text
);
create table public.store_products (
  id uuid primary key, product_id uuid, store text, store_sku text, store_url text,
  store_product_name text, brand text, is_own_brand boolean default false, gtin text, url_status text
);
create table public.products (id uuid primary key, canonical_name text, brand text, ean text);
create table public.price_observations (
  id uuid default gen_random_uuid(), store_product_id uuid, price numeric, was_price numeric,
  on_promotion boolean default false, observed_at timestamptz default now(), source text
);
create table public.scrape_product_receipts (
  run_id uuid, store_product_id uuid, outcome text, created_at timestamptz default now(),
  primary key (run_id, store_product_id)
);
create table public.scrape_failures (
  run_id uuid, store_product_id uuid, store text, failure_stage text, failure_reason text,
  store_url text, canonical_name text, is_retryable boolean, consecutive_failures int, raw_error text,
  primary key (run_id, store_product_id, failure_reason)
);
-- Production semantics: latest observation per mapping inside a 7-day window,
-- for every store (Tesco + the Dunnes/SuperValu peers).
create view public.latest_prices as
  select distinct on (o.store_product_id) o.store_product_id, s.store, o.price, o.observed_at
  from public.price_observations o join public.store_products s on s.id = o.store_product_id
  where o.observed_at > now() - interval '7 days'
  order by o.store_product_id, o.observed_at desc;
create table public.tesco_egress_pool (
  egress_key text primary key, label text, enabled boolean default true, priority int default 100,
  cooldown_until timestamptz, leased_until timestamptz, last_success_at timestamptz, last_block_at timestamptz,
  consecutive_blocks int default 0, total_successes bigint default 0, total_blocks bigint default 0,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.tesco_direct_collection_pages (
  id uuid primary key default gen_random_uuid(), run_id uuid references public.scrape_runs(id),
  egress_key text, requested_url text, final_url text, mode text, outcome text, http_status int,
  retry_after text, elapsed_ms int, body_sha256 text, parsed jsonb, identity_results jsonb default '[]'::jsonb,
  detail text, created_at timestamptz default now(), unique(run_id, requested_url)
);`;

function extractFunction(path: string, name: string): string {
  const sql = readFileSync(path, 'utf8');
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
}

export async function createApifyDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(BASE_SCHEMA);
  await db.exec(extractFunction('supabase/migrations/20260822100000_add_price_observation_source.sql', 'finalize_store_scrape_product'));
  await db.exec(extractFunction('supabase/migrations/20260929093608_tesco_direct_collection_evidence.sql', 'pause_tesco_collection_egress'));
  for (const m of ['20261108200000_tesco_apify_unattended_collection', '20261109090000_tesco_apify_lease_fencing_and_page_binding',
    '20261109140000_tesco_apify_snapshot_binding', '20261113090000_tesco_apify_first_price_expansion']) {
    await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'));
  }
  return db;
}

type Filter = { sql: (p: (v: unknown) => string) => string };
// Many-to-one embeds become objects, one-to-many become arrays (as PostgREST).
const EMBEDS: Record<string, Record<string, { from: string; on: string; many: boolean }>> = {
  store_products: {
    products: { from: 'public.products e', on: 'e.id = t.product_id', many: false },
    latest_prices: { from: 'public.latest_prices e', on: 'e.store_product_id = t.id', many: true },
  },
};
const ident = (c: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`bad column ${c}`);
  return `"${c}"`;
};
function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function selectList(table: string, cols: string): string {
  return splitTop(cols).map((c) => {
    const m = /^([a-z_]+)\((.*)\)$/.exec(c);
    if (!m) return c === '*' ? 't.*' : `t.${ident(c)}`;
    const rel = EMBEDS[table]?.[m[1]];
    if (!rel) throw new Error(`unsupported embed ${table}.${m[1]}`);
    const inner = splitTop(m[2]).map(x => `e.${ident(x)}`).join(', ');
    return rel.many
      ? `coalesce((select jsonb_agg(to_jsonb(x)) from (select ${inner} from ${rel.from} where ${rel.on}) x), '[]'::jsonb) as ${ident(m[1])}`
      : `(select to_jsonb(x) from (select ${inner} from ${rel.from} where ${rel.on} limit 1) x) as ${ident(m[1])}`;
  }).join(', ');
}
const arrayLiteral = (vals: unknown[]) => `{${vals.map(v => `"${String(v).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;

export function pgliteSupabase(db: PGlite): SupabaseClient {
  const from = (table: string) => {
    let cols = '*'; const filters: Filter[] = []; const orders: string[] = [];
    let limitN: number | null = null; let offsetN = 0; let single = false;
    const b: Record<string, unknown> = {};
    const cmp = (op: string) => (c: string, v: unknown) => { filters.push({ sql: p => `t.${ident(c)} ${op} ${p(v)}` }); return b; };
    b.select = (c: string) => { cols = c; return b; };
    b.eq = cmp('='); b.neq = cmp('<>'); b.gt = cmp('>'); b.gte = cmp('>='); b.lt = cmp('<'); b.lte = cmp('<=');
    b.in = (c: string, vals: unknown[]) => { filters.push({ sql: p => `t.${ident(c)}::text = any(${p(arrayLiteral(vals))}::text[])` }); return b; };
    b.is = (c: string, v: null) => { if (v !== null) throw new Error('is() supports null only'); filters.push({ sql: () => `t.${ident(c)} is null` }); return b; };
    b.not = (c: string, op: string, v: null) => { if (op !== 'is' || v !== null) throw new Error('not() supports is null only'); filters.push({ sql: () => `t.${ident(c)} is not null` }); return b; };
    b.order = (c: string, o?: { ascending?: boolean }) => { orders.push(`t.${ident(c)} ${o?.ascending === false ? 'desc' : 'asc'}`); return b; };
    b.range = (a: number, z: number) => { offsetN = a; limitN = z - a + 1; return b; };
    b.limit = (n: number) => { limitN = n; return b; };
    b.maybeSingle = () => { single = true; limitN = 1; return b; };
    const run = async () => {
      const params: unknown[] = [];
      const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const where = filters.length ? ` where ${filters.map(f => f.sql(p)).join(' and ')}` : '';
      const sql = `select to_jsonb(x) as j from (select ${selectList(table, cols)} from public.${ident(table)} t${where}`
        + `${orders.length ? ` order by ${orders.join(', ')}` : ''}${limitN != null ? ` limit ${limitN}` : ''}${offsetN ? ` offset ${offsetN}` : ''}) x`;
      try {
        const rows = (await db.query<{ j: Record<string, unknown> }>(sql, params)).rows.map(r => r.j);
        return { data: single ? rows[0] ?? null : rows, error: null };
      } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
    };
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => run().then(resolve, reject);
    return b;
  };
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    if (!/^[a-z_]+$/.test(fn)) throw new Error('bad rpc');
    const params: unknown[] = [];
    const named = Object.entries(args).map(([k, v]) => {
      if (v === undefined) return null;
      if (v !== null && typeof v === 'object') { params.push(JSON.stringify(v)); return `${ident(k)} => $${params.length}::jsonb`; }
      params.push(v); return `${ident(k)} => $${params.length}`;
    }).filter(Boolean).join(', ');
    try {
      const r = await db.query<{ r: unknown }>(`select to_jsonb(public.${fn}(${named})) as r`, params);
      return { data: r.rows[0]?.r ?? null, error: null };
    } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
  };
  return { from, rpc } as unknown as SupabaseClient;
}
