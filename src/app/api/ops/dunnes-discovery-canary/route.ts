import { createHash, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

const TOKEN_HASH = '095a26423e44b12e813e8b42072531af616243363fac63dacdd5a90ba63a76d4';
const STORE_ID = 258;
const API_BASE = 'https://storefrontgateway.dunnesstoresgrocery.com/api';
const SITE_URL = 'https://www.dunnesstoresgrocery.com';

type Candidate = { sku: string | null; name: string; price: number | null };
type PackSignature = { amount: number | null; unit: 'g' | 'ml' | null; count: number | null };

function validToken(token: string | null) {
  if (!token) return false;
  const actual = createHash('sha256').update(token).digest();
  const expected = Buffer.from(TOKEN_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function plain(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function norm(value: string) {
  return plain(value).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function toBaseAmount(qty: number, unit: string): { amount: number; unit: 'g' | 'ml' } {
  const u = unit.toLowerCase();
  if (u === 'kg') return { amount: qty * 1000, unit: 'g' };
  if (u === 'g') return { amount: qty, unit: 'g' };
  if (u === 'l') return { amount: qty * 1000, unit: 'ml' };
  if (u === 'cl') return { amount: qty * 10, unit: 'ml' };
  return { amount: qty, unit: 'ml' };
}

function packSignature(value: string): PackSignature {
  const raw = plain(value).replace(/,/g, '.').replace(/×/g, 'x');

  const multi = raw.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/i);
  if (multi) {
    const base = toBaseAmount(Number(multi[2]), multi[3]);
    return { amount: base.amount, unit: base.unit, count: Number(multi[1]) };
  }

  const countMatch = raw.match(/\b(\d+)\s*(?:pack|pk|rolls?|pieces?|tabs?|tablets?|capsules?|wipes?|bags?|sachets?|boxes?|cans?|bottles?)\b/i);
  const amountMatch = raw.match(/\b(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/i);
  const base = amountMatch ? toBaseAmount(Number(amountMatch[1]), amountMatch[2]) : null;

  return {
    amount: base?.amount ?? null,
    unit: base?.unit ?? null,
    count: countMatch ? Number(countMatch[1]) : null,
  };
}

function sizeText(value: string) {
  const raw = plain(value).replace(/,/g, '.').replace(/×/g, 'x');
  const multi = raw.match(/\b\d+\s*x\s*\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl)\b/i);
  if (multi) return multi[0];
  const count = raw.match(/\b\d+\s*(?:pack|pk|rolls?|pieces?|tabs?|tablets?|capsules?|wipes?|bags?|sachets?|boxes?|cans?|bottles?)\b/i);
  const amount = raw.match(/\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl)\b/i);
  return [count?.[0], amount?.[0]].filter(Boolean).join(' ').trim();
}

function compatiblePack(a: string, b: string) {
  const x = packSignature(a);
  const y = packSignature(b);

  if (x.amount !== null) {
    if (y.amount === null || x.unit !== y.unit) return false;
    if (Math.max(x.amount, y.amount) / Math.min(x.amount, y.amount) > 1.1) return false;
  }
  if (x.count !== null) {
    if (y.count === null || x.count !== y.count) return false;
  }
  return true;
}

const GENERIC = new Set([
  'the','and','with','original','fresh','irish','pack','bottle','aerosol','spray','product',
  'free','good','selected','selection','large','small','medium','standard','premium',
]);

function words(value: string) {
  return norm(value)
    .replace(/\b\d+(?:\s+\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack)?\b/g,' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !GENERIC.has(w));
}

function score(expected: string, candidate: string) {
  const ew = words(expected); const cw = words(candidate); const cn = norm(candidate); const en = norm(expected);
  if (!ew.length || !cw.length) return 0;
  if (en === cn) return 1;
  const ec = ew.filter(w => cn.includes(w)).length / ew.length;
  const cc = cw.filter(w => en.includes(w)).length / cw.length;
  return ec * 0.75 + cc * 0.25;
}

function brandMatches(brand: string, candidate: string) {
  const bn = norm(brand);
  const cn = norm(candidate);
  if (bn && cn.includes(bn)) return true;

  const tokens = norm(brand).split(/\s+/).filter(Boolean).filter(w => w.length >= 4 || (w.length >= 3 && /\d/.test(w)));
  return tokens.some(w => cn.includes(w));
}

function productSignalMatches(canonicalName: string, candidate: string) {
  const productWords = words(canonicalName);
  if (!productWords.length) return false;
  const cn = norm(candidate);
  const matched = productWords.filter(w => cn.includes(w)).length;
  return matched / productWords.length >= 0.6;
}

function coreTerms(canonicalName: string, brand: string) {
  const brandWords = new Set(words(brand));
  const terms = words(canonicalName).filter(w => !brandWords.has(w));
  return terms.slice(0, 5).join(' ');
}

function queryVariants(canonicalName: string, brand: string) {
  const enriched = norm(canonicalName).includes(norm(brand)) ? canonicalName : `${brand} ${canonicalName}`;
  const core = coreTerms(canonicalName, brand);
  const pack = sizeText(canonicalName);
  const variants = [
    enriched,
    core ? `${brand} ${core}` : brand,
    core && pack ? `${brand} ${core} ${pack}` : '',
    canonicalName,
  ];
  return [...new Set(variants.map(v => v.trim()).filter(Boolean))];
}

async function searchDunnes(query: string): Promise<Candidate[]> {
  const q = query.split(' ').slice(0, 8).join(' ').slice(0, 90);
  const url = `${API_BASE}/stores/${STORE_ID}/search?q=${encodeURIComponent(q)}&take=12&page=1&skip=0`;
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

async function discoverCandidates(canonicalName: string, brand: string) {
  const variants = queryVariants(canonicalName, brand);
  const byKey = new Map<string, Candidate & { queries: string[] }>();
  for (const query of variants) {
    const candidates = await searchDunnes(query);
    for (const candidate of candidates) {
      const key = candidate.sku || `${norm(candidate.name)}:${candidate.price ?? ''}`;
      const existing = byKey.get(key);
      if (existing) existing.queries.push(query);
      else byKey.set(key, { ...candidate, queries: [query] });
    }
  }
  return { variants, candidates: [...byKey.values()] };
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
    const discovery = await discoverCandidates(p.canonical_name, p.brand);
    const enrichedExpected = norm(p.canonical_name).includes(norm(p.brand)) ? p.canonical_name : `${p.brand} ${p.canonical_name}`;
    const ranked = discovery.candidates.map(c => ({
      ...c,
      score: score(enrichedExpected,c.name),
      brand_match: brandMatches(p.brand,c.name),
      pack_match: compatiblePack(p.canonical_name,c.name),
      product_signal_match: productSignalMatches(p.canonical_name,c.name),
      canonical_pack: packSignature(p.canonical_name),
      candidate_pack: packSignature(c.name),
    })).sort((a,b)=>b.score-a.score);
    const best = ranked[0] ?? null;
    const accepted = Boolean(
      best && best.sku && best.price && best.brand_match && best.pack_match && best.product_signal_match && best.score >= 0.72
    );
    results.push({
      id:p.id, canonical_name:p.canonical_name, brand:p.brand, category:p.category,
      accepted, best, query_variants: discovery.variants, candidate_count: ranked.length,
      candidates:ranked.slice(0,5),
    });
  }

  const acceptedCount = results.filter(r => r.accepted).length;
  const runId = `dunnes_discovery_canary_${new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}`;
  const { error: insertError } = await supabaseAdmin.from('scrape_runs').insert({
    run_id: runId,
    store: 'dunnes',
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    target_count: targets.length,
    attempted_count: targets.length,
    fetched: results.reduce((sum,r)=>sum + r.query_variants.length,0),
    extracted: acceptedCount,
    inserted: 0,
    unchanged_count: 0,
    failed: targets.length - acceptedCount,
    coverage_pct: targets.length ? (acceptedCount / targets.length) * 100 : 0,
    retrieval_method: 'dunnes_discovery_canary_dry_run',
    threshold_pct: 0,
    status: 'success',
    error_summary: JSON.stringify(results.map(r => ({ canonical_name:r.canonical_name, brand:r.brand, accepted:r.accepted, best:r.best, query_variants:r.query_variants, candidate_count:r.candidate_count }))),
  });
  if (insertError) return Response.json({ error: insertError.message, dry_run:true, results }, { status: 500 });

  return Response.json({ dry_run:true, run_id:runId, target_count:targets.length, accepted_count:acceptedCount, results });
}
