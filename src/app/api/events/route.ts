import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_METADATA_BYTES = 8 * 1024;
const MAX_SESSION_ID_LENGTH = 128;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

const ALLOWED_EVENT_TYPES = new Set([
  'planner_started',
  'planner_message',
  'list_generated',
  'list_saved',
  'signup_started',
  'signup_completed',
  'landing_agent_started',
  'dashboard_visit',
  'conversation_started',
  'page_view',
]);

function clientKey(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
}

function rateLimited(req: NextRequest) {
  const now = Date.now();
  const key = clientKey(req);
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  existing.count += 1;
  return existing.count > RATE_MAX;
}

export async function POST(req: NextRequest) {
  if (rateLimited(req)) {
    return Response.json({ error: 'Too many requests' }, { status: 429 });
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'Payload too large' }, { status: 413 });
  }

  const raw = await req.text().catch(() => '');
  if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return Response.json({ error: 'Invalid payload' }, { status: raw ? 413 : 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { event_type, session_id, metadata, token } = body as {
    event_type?: unknown;
    session_id?: unknown;
    metadata?: unknown;
    token?: unknown;
  };

  if (typeof event_type !== 'string' || !ALLOWED_EVENT_TYPES.has(event_type)) {
    return Response.json({ error: 'Invalid event_type' }, { status: 400 });
  }

  if (session_id !== undefined && session_id !== null &&
      (typeof session_id !== 'string' || session_id.length > MAX_SESSION_ID_LENGTH)) {
    return Response.json({ error: 'Invalid session_id' }, { status: 400 });
  }

  if (metadata !== undefined &&
      (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
       Buffer.byteLength(JSON.stringify(metadata), 'utf8') > MAX_METADATA_BYTES)) {
    return Response.json({ error: 'Invalid metadata' }, { status: 400 });
  }

  const explicit = typeof token === 'string' && token !== '__cookie__' ? token : null;
  const subscriberId = getSubscriberId(req.cookies.get('sm_session')?.value ?? explicit);

  const { error } = await supabaseAdmin
    .from('agent_events')
    .insert({
      event_type,
      session_id: typeof session_id === 'string' ? session_id : null,
      subscriber_id: subscriberId,
      metadata: metadata ?? {},
    });

  if (error) {
    console.error('[events] insert error:', error.message);
    return Response.json({ error: 'Failed to record event' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
