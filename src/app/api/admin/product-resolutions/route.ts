import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type QueueRow = {
  failure_id: string;
  store: 'supervalu' | 'dunnes';
  canonical_name: string;
  store_product_name: string;
  store_sku: string | null;
  store_url: string | null;
  failure_reason: string;
  raw_error: string | null;
  demand_units: number;
  demand_rank: number | null;
  created_at: string;
};

type Candidate = { sku: string; name: string; price: number; url: string };

function isAuthorized(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return Boolean(token && process.env.ADMIN_API_KEY && token === process.env.ADMIN_API_KEY);
}

function slug(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function candidateUrl(store: QueueRow['store'], sku: string, name: string) {
  return store === 'dunnes'
    ? `https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/${slug(name)}/${sku}`
    : `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/${slug(name)}-id-${sku}`;
}

export function parseResolutionCandidates(row: QueueRow): Candidate[] {
  const raw = row.raw_error ?? '';
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const pattern = /(?:^|[=|]\s*)([a-zA-Z0-9_-]+):([^|]+?):€(\d+(?:\.\d+)?)/g;
  for (const match of raw.matchAll(pattern)) {
    const sku = match[1];
    const name = match[2].trim();
    const price = Number(match[3]);
    if (sku === 'no-sku' || !name || !Number.isFinite(price) || price <= 0 || seen.has(sku)) continue;
    seen.add(sku);
    candidates.push({ sku, name, price, url: candidateUrl(row.store, sku, name) });
  }
  return candidates;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('product_resolution_queue')
    .select('*')
    .order('demand_units', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(250);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const items = ((data ?? []) as QueueRow[]).map((row) => ({ ...row, candidates: parseResolutionCandidates(row) }));
  return Response.json({ generated_at: new Date().toISOString(), items });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as {
    failure_id?: string; action?: string; candidate?: Candidate; note?: string;
  } | null;
  if (!body?.failure_id || !['exact', 'unavailable', 'skipped'].includes(body.action ?? '')) {
    return Response.json({ error: 'A failure ID and supported action are required' }, { status: 400 });
  }
  if (body.action === 'exact' && (!body.candidate?.sku || !body.candidate.name || !body.candidate.url || !body.candidate.price)) {
    return Response.json({ error: 'Choose product requires a complete candidate' }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { error } = await supabase.rpc('resolve_product_resolution', {
    p_failure_id: body.failure_id,
    p_action: body.action,
    p_candidate_sku: body.candidate?.sku ?? null,
    p_candidate_name: body.candidate?.name ?? null,
    p_candidate_url: body.candidate?.url ?? null,
    p_price: body.candidate?.price ?? null,
    p_note: body.note?.slice(0, 500) ?? null,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ resolved: true });
}
