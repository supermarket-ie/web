import { createClient } from '@supabase/supabase-js';
import {
  classifyResolution,
  parseResolutionCandidates,
  type ResolutionCandidate as Candidate,
  type ResolutionQueueRow as QueueRow,
} from '@/lib/product-resolution';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function isAuthorized(req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return Boolean(token && process.env.ADMIN_API_KEY && token === process.env.ADMIN_API_KEY);
}

export { parseResolutionCandidates } from '@/lib/product-resolution';

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
  const items = ((data ?? []) as QueueRow[]).map((row) => {
    const candidates = parseResolutionCandidates(row);
    const resolution = classifyResolution(row, candidates);
    return { ...row, candidates, ...resolution };
  });
  const classification_counts = items.reduce<Record<string, number>>((counts, item) => {
    counts[item.classification] = (counts[item.classification] ?? 0) + 1;
    return counts;
  }, {});
  return Response.json({ generated_at: new Date().toISOString(), classification_counts, items });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as {
    failure_id?: string; action?: string; candidate?: Pick<Candidate, 'sku'>; note?: string;
  } | null;
  if (!body?.failure_id || !['exact', 'unavailable', 'skipped'].includes(body.action ?? '')) {
    return Response.json({ error: 'A failure ID and supported action are required' }, { status: 400 });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data: queueRow, error: queueError } = await supabase
    .from('product_resolution_queue').select('*').eq('failure_id', body.failure_id).maybeSingle();
  if (queueError) return Response.json({ error: queueError.message }, { status: 500 });
  if (!queueRow) return Response.json({ error: 'Resolution item is no longer open' }, { status: 404 });

  if (body.action === 'unavailable') {
    return Response.json({ error: 'Retailer absence requires repeated independent evidence and cannot be set from this queue yet' }, { status: 400 });
  }
  const row = queueRow as QueueRow;
  const exactCandidates = classifyResolution(row).exactCandidates;
  const candidate = body.action === 'exact'
    ? exactCandidates.find((item) => item.sku === body.candidate?.sku)
    : undefined;
  if (body.action === 'exact' && !candidate) {
    return Response.json({ error: 'Candidate does not pass strict server-side identity validation' }, { status: 400 });
  }
  const { error } = await supabase.rpc('resolve_product_resolution', {
    p_failure_id: body.failure_id,
    p_action: body.action,
    p_candidate_sku: candidate?.sku ?? null,
    p_candidate_name: candidate?.name ?? null,
    p_candidate_url: candidate?.url ?? null,
    p_price: candidate?.price ?? null,
    p_note: body.note?.slice(0, 500) ?? null,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ resolved: true });
}
