import { supabaseAdmin } from '@/lib/supabase';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;

const ALLOWED_EVENT_TYPES = new Set([
  'planner_started',
  'planner_message',
  'list_generated',
  'list_saved',
  'signup_completed',
  'dashboard_visit',
  'conversation_started',
  'page_view',
]);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const { event_type, session_id, metadata, token } = body as {
    event_type?: string;
    session_id?: string;
    metadata?: Record<string, unknown>;
    token?: string;
  };

  if (!event_type || !ALLOWED_EVENT_TYPES.has(event_type)) {
    return Response.json({ error: 'Invalid event_type' }, { status: 400 });
  }

  // Extract subscriber_id from JWT if present
  let subscriberId: string | null = null;
  if (token && SECRET) {
    try {
      const payload = jwt.verify(token, SECRET) as { subscriberId: string };
      subscriberId = payload.subscriberId;
    } catch {}
  }

  // Await the insert — serverless functions kill the process after response,
  // so fire-and-forget never actually executes.
  const { error } = await supabaseAdmin
    .from('agent_events')
    .insert({
      event_type,
      session_id: session_id ?? null,
      subscriber_id: subscriberId,
      metadata: metadata ?? {},
    });

  if (error) {
    console.error('[events] insert error:', error.message);
    return Response.json({ error: 'Failed to record event' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
