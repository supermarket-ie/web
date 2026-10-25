import { collectTescoDirect, type TescoCollectionMode } from '@/lib/tesco-direct-collection';
import { retailerCollectionBlocked, RETAILER_COLLECTION_BLOCKED_REASON } from '@/lib/preview-guard';

export const runtime = 'nodejs';
export const maxDuration = 240;

export async function GET(request: Request) {
  if (retailerCollectionBlocked()) return Response.json({ error: RETAILER_COLLECTION_BLOCKED_REASON, status: 'blocked_preview' }, { status: 503 });
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.TESCO_VERCEL_WORKER_ENABLED !== 'true' || !process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ status: 'disabled' }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const mode = params.get('mode') ?? 'probe';
  const maxPages = Number(params.get('pages') ?? 5);
  const query = params.get('query')?.trim() || 'milk';
  if (!['probe', 'products', 'listings'].includes(mode) || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 6 || query.length > 120) return Response.json({ error: 'Invalid bounded collection parameters' }, { status: 400 });
  const result = await collectTescoDirect({ mode: mode as TescoCollectionMode, maxPages, query });
  return Response.json(result, { status: ['complete', 'cached_no_requests', 'no_due_products'].includes(result.status) ? 200 : 503 });
}
