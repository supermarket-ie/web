import { createHash, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

const TOKEN_HASH = '095a26423e44b12e813e8b42072531af616243363fac63dacdd5a90ba63a76d4';
const STORE_ID = 258;
const API_BASE = 'https://storefrontgateway.dunnesstoresgrocery.com/api';
const SITE_URL = 'https://www.dunnesstoresgrocery.com';

function validToken(token: string | null) {
  if (!token) return false;
  const actual = createHash('sha256').update(token).digest();
  const expected = Buffer.from(TOKEN_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function norm(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function size(value: string) {
  const m = norm(value).match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/i);
  if (!m) return null;
  let qty = Number(m[1]);
  let unit = m[2].toLowerCase();
  if (unit === 'kg') { qty *= 1000; unit = 'g'; }
  if (unit === 'l') { qty *= 1000; unit = 'ml'; }
  if (unit === 'cl') { qty *= 10; unit = 'ml'; }
  return { qty, unit };
}

function compatibleSize(a: string, b: string) {
  const x = size(a); const y = size(b);
  if (!x || !y) return true;
  return x.unit === y.unit && Math.max(x.qty, y.qty) / Math.min(x.qty, y.qty) <= 1.1;
}

function words(value: string) {
  const generic = new Set(['the','and','with','original','fresh','irish','pack','bottle','aerosol','spray']);
  return norm(value).replace(/\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack)?\b/g,' ').split(/\s+/).filter(w => w.length > 2 && !generic.has(w));
}

function score(expected: string, candidate: string) {
  const ew = words(expected); const cw = words(candidate); const cn = norm(candidate); const en = norm(expected);
  if (!ew.length || !cw.length) return 0;
  const ec = ew.filter(w => cn.includes(w)).length / ew.length;
  const cc = cw.filter(w => en.includes(w)).length / cw.length;
  return ec * 0.75 + cc * 0.25;
}

function brandMatches(brand: string, candidate: string) {
  const bw = words(brand);
  if (!bw.length) return false;
  const cn = norm(candidate);
  return bw.some(w => cn.includes(w));
}

async function searchDunnes(query: string) {
  const q = query.split(' ').slice(0, 7).join(' ').slice(0, 80);
  const url = `${API_BASE}/stores/${STORE_ID}/search?q=${encodeURIComponent(q)}&take=8&page=1&skip=0`;
  const response = await fetch(url, { cache: 'no-store', headers: {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
    'x-site-host': SITE_URL,
    'x-site-location': 'HeadersBuilderInterceptor',
    'x-correlation-id': crypto.randomUUID(),
    'x-shopping-mode': '22222222-2222-2222-2222-222222222222',
  }});
  if (!response.ok) return [];
  const body = await response.json() as { items?: Array<{sku?: string|number|null; name?: string|null; priceNumeric?: number|null}> };
  return (body.items ?? []).map(item => ({ sku: item.sku == null ? null : String(item.sku), name: item.name ?? '', price: typeof item.priceNumeric === 'number' ? item.priceNumeric : null }));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!validToken(url.searchParams.get('token'))) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: products, error } = await supabaseAdmin.from('products').select('id,canonical_name,brand,category').not('brand','is',null).order('brand').order('canonical_name').limit(120);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const ids = (products ?? []).map(p => p.id);
  const { data: mapped } = await supabaseAdmin.from('store_products').select('product_id,store_sku').eq('store','dunnes').in('product_id', ids).not('store_sku','is',null);
  const mappedIds = new Set((mapped ?? []).map(r => r.product_id));
  const targets = (products ?? []).filter(p => p.brand && !mappedIds.has(p.id)).slice(0, 20);

  const results = [] as any[];
  for (const p of targets) {
    const candidates = await searchDunnes(p.canonical_name);
    const ranked = candidates.map(c => ({...c, score: score(p.canonical_name,c.name), brand_match: brandMatches(p.brand,c.name), size_match: compatibleSize(p.canonical_name,c.name)})).sort((a,b)=>b.score-a.score);
    const best = ranked[0] ?? null;
    const accepted = Boolean(best && best.sku && best.price && best.brand_match && best.size_match && best.score >= 0.72);
    results.push({ id:p.id, canonical_name:p.canonical_name, brand:p.brand, category:p.category, accepted, best, candidates:ranked.slice(0,3) });
  }

  const acceptedCount = results.filter(r => r.accepted).length;
  const runId = `dunnes_discovery_canary_${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}`;
  await supabaseAdmin.from('scrape_runs').insert({
    run_id: runId,
    store: 'dunnes',
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    target_count: targets.length,
    attempted_count: targets.length,
    fetched: targets.length,
    extracted: acceptedCount,
    inserted: 0,
    unchanged_count: 0,
    failed: targets.length - acceptedCount,
    coverage_pct: targets.length ? (acceptedCount / targets.length) * 100 : 0,
    retrieval_method: 'dunnes_discovery_canary_dry_run',
    threshold_pct: 0,
    status: 'completed',
    error_summary: JSON.stringify(results.map(r => ({ canonical_name:r.canonical_name, brand:r.brand, accepted:r.accepted, best:r.best }))),
  });

  return Response.json({ dry_run:true, run_id:runId, target_count:targets.length, accepted_count:acceptedCount, results });
}
