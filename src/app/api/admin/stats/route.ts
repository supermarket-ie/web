import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || token !== process.env.ADMIN_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const t24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const t7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const t30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const t14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [events24h, events7d, events30d, events14d] = await Promise.all([
    supabaseAdmin.from('agent_events').select('event_type, session_id, subscriber_id').gte('created_at', t24h),
    supabaseAdmin.from('agent_events').select('event_type, session_id, subscriber_id').gte('created_at', t7d),
    supabaseAdmin.from('agent_events').select('event_type, session_id, subscriber_id').gte('created_at', t30d),
    supabaseAdmin.from('agent_events').select('event_type, created_at').gte('created_at', t14d),
  ]);

  function aggregateByType(rows: Array<{ event_type: string }>) {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.event_type] = (counts[row.event_type] ?? 0) + 1;
    }
    return counts;
  }

  function uniqueSessions(rows: Array<{ session_id: string | null }>) {
    return new Set(rows.map(r => r.session_id).filter(Boolean)).size;
  }

  function uniqueSubscribers(rows: Array<{ subscriber_id: string | null }>) {
    return new Set(rows.map(r => r.subscriber_id).filter(Boolean)).size;
  }

  function funnelConversion(rows: Array<{ event_type: string }>) {
    const byType = aggregateByType(rows);
    const started = byType['planner_started'] ?? 0;
    const generated = byType['list_generated'] ?? 0;
    const signedUp = byType['signup_completed'] ?? 0;
    return {
      planner_started: started,
      list_generated: generated,
      signup_completed: signedUp,
      started_to_generated: started > 0 ? Math.round((generated / started) * 100) : null,
      generated_to_signup: generated > 0 ? Math.round((signedUp / generated) * 100) : null,
    };
  }

  function dailyBreakdown(rows: Array<{ event_type: string; created_at: string }>) {
    const days: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      const day = row.created_at.slice(0, 10);
      if (!days[day]) days[day] = {};
      days[day][row.event_type] = (days[day][row.event_type] ?? 0) + 1;
    }
    return Object.entries(days)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));
  }

  const rows24h = events24h.data ?? [];
  const rows7d = events7d.data ?? [];
  const rows30d = events30d.data ?? [];
  const rows14d = events14d.data ?? [];

  return Response.json({
    events_by_type: {
      last_24h: aggregateByType(rows24h),
      last_7d: aggregateByType(rows7d),
      last_30d: aggregateByType(rows30d),
    },
    unique_sessions: {
      last_24h: uniqueSessions(rows24h),
      last_7d: uniqueSessions(rows7d),
      last_30d: uniqueSessions(rows30d),
    },
    unique_subscribers: {
      last_24h: uniqueSubscribers(rows24h),
      last_7d: uniqueSubscribers(rows7d),
      last_30d: uniqueSubscribers(rows30d),
    },
    funnel: {
      last_24h: funnelConversion(rows24h),
      last_7d: funnelConversion(rows7d),
      last_30d: funnelConversion(rows30d),
    },
    daily_breakdown_14d: dailyBreakdown(rows14d),
  });
}
