// READ-ONLY Dunnes/SuperValu data fetch for the exact-pair assessment.
// - Issues HTTP GET requests only (a guard rejects any other method).
// - Credentials come from AWS Secrets Manager (smie-prod profile) at run time and
//   are never printed or written. Output goes to a private directory outside git.
// - Reads are CHUNKED, not atomic: the manifest records the read window, per-table
//   row counts (head count before and after paging) and an identity-field digest.
//
// Usage: tsx scripts/pair-assessment-fetch.ts <privateOutDir>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: <privateOutDir>');
const secret = (id: string) => execFileSync('aws', ['secretsmanager', 'get-secret-value', '--secret-id', id,
  '--profile', 'smie-prod', '--region', 'eu-west-1', '--query', 'SecretString', '--output', 'text'], { encoding: 'utf8' }).trim();
const unwrap = (v: string) => { try { const j = JSON.parse(v); return typeof j === 'string' ? j : String(Object.values(j)[0]); } catch { return v; } };
const base = unwrap(secret('smie-prod/supabase-url')).replace(/\/$/, '');
const key = unwrap(secret('smie-prod/supabase-service'));

async function get(path: string, range?: [number, number], count = false) {
  const res = await fetch(`${base}/rest/v1/${path}`, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}`,
    ...(count ? { Prefer: 'count=exact' } : {}), ...(range ? { Range: `${range[0]}-${range[1]}`, 'Range-Unit': 'items' } : {}) } });
  if (!res.ok && res.status !== 206) throw new Error(`GET ${path.split('?')[0]} -> ${res.status}`);
  return res;
}
async function total(path: string) { const r = await get(path, [0, 0], true); return Number((r.headers.get('content-range') ?? '').split('/')[1]); }
async function page<T = Record<string, unknown>>(path: string, size = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const r = await get(path, [from, from + size - 1]);
    const chunk = await r.json() as T[];
    rows.push(...chunk);
    if (chunk.length < size) break;
  }
  return rows;
}
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

async function main() {
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const specs: { name: string; path: string }[] = [
    { name: 'store_products', path: 'store_products?select=id,product_id,store,store_sku,store_product_name,brand,is_own_brand,store_url,url_status,url_last_checked_at,gtin&store=in.(dunnes,supervalu)&order=id' },
    { name: 'latest_prices', path: 'latest_prices?select=store_product_id,store,price,observed_at,source&store=in.(dunnes,supervalu)&order=store_product_id' },
    { name: 'products', path: 'products?select=id,canonical_name,brand,category,default_quantity,default_unit,ean,description,ingredients,image_url&order=id' },
    { name: 'scrape_runs', path: 'scrape_runs?select=id,store,retrieval_method&store=in.(dunnes,supervalu)&order=id' },
    { name: 'scrape_product_receipts', path: 'scrape_product_receipts?select=store_product_id,run_id,created_at,outcome&order=store_product_id,created_at.desc,run_id' },
    { name: 'scrape_failures', path: 'scrape_failures?select=id,store_product_id,store,failure_reason,created_at,raw_error&store=in.(dunnes,supervalu)&order=id' },
    { name: 'list_items', path: 'list_items?select=canonical_name,quantity&canonical_name=not.is.null&order=id' },
    { name: 'manufacturer_brand_claims', path: 'manufacturer_brand_claims?select=*&order=id' },
    // Metadata only (no body_text): bodies are fetched later for qualifying rows only.
    { name: 'retailer_identity_responses_meta', path: 'retailer_identity_responses?select=id,store,sku,product_url,requested_url,final_url,retrieved_at,content_type,body_sha256,parser_version,source_kind,source_path&order=id' },
    { name: 'retailer_offer_pair_reviews', path: 'retailer_offer_pair_reviews?select=*&order=id' },
  ];
  const manifest: Record<string, unknown> = { startedAt, tables: {} as Record<string, unknown> };
  for (const s of specs) {
    const before = await total(s.path.replace(/&order=.*$/, '').replace(/select=[^&]*&?/, ''));
    let rows: Record<string, unknown>[];
    try { rows = await page(s.path); } catch (e) { (manifest.tables as Record<string, unknown>)[s.name] = { error: String(e) }; continue; }
    const after = await total(s.path.replace(/&order=.*$/, '').replace(/select=[^&]*&?/, ''));
    writeFileSync(`${outDir}/raw-${s.name}.json`, JSON.stringify(rows), { mode: 0o600 });
    (manifest.tables as Record<string, unknown>)[s.name] = { rows: rows.length, headCountBefore: before, headCountAfter: after,
      reconciled: before === after && after === rows.length, digest: sha(rows) };
    console.log(JSON.stringify({ table: s.name, rows: rows.length, before, after }));
  }
  manifest.finishedAt = new Date().toISOString();
  manifest.note = 'Chunked reads over a window; NOT an atomic snapshot. Reconciled = head counts before/after equal the rows paged.';
  writeFileSync(`${outDir}/fetch-manifest.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
}
// Phase 2 (`bodies`): original response bodies for the LATEST retained response per
// (store, sku) only, fetched by id in small batches (GET only).
async function bodies() {
  const meta = JSON.parse((await import('node:fs')).readFileSync(`${outDir}/raw-retailer_identity_responses_meta.json`, 'utf8')) as
    { id: string; store: string; sku: string; retrieved_at: string }[];
  const latest = new Map<string, { id: string; retrieved_at: string }>();
  for (const r of meta) { const k = `${r.store}:${r.sku}`; const p = latest.get(k);
    if (!p || r.retrieved_at > p.retrieved_at || (r.retrieved_at === p.retrieved_at && r.id > p.id)) latest.set(k, r); }
  const ids = [...latest.values()].map(r => r.id).sort();
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += 25) {
    const r = await get(`retailer_identity_responses?select=*&id=in.(${ids.slice(i, i + 25).join(',')})`);
    out.push(...await r.json() as Record<string, unknown>[]);
    if (i % 500 === 0) console.log(JSON.stringify({ bodiesFetched: out.length, of: ids.length }));
  }
  writeFileSync(`${outDir}/raw-retailer_identity_responses_latest.json`, JSON.stringify(out), { mode: 0o600 });
  console.log(JSON.stringify({ latestResponses: out.length, expected: ids.length, digest: sha(out.map(o => (o as { id: string }).id).sort()) }));
}
(process.argv[3] === 'bodies' ? bodies() : main()).catch(e => { console.error(JSON.stringify({ fatal: e instanceof Error ? e.message : String(e) })); process.exitCode = 1; });
