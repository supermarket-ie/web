import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STORES = ['supervalu', 'dunnes', 'aldi'] as const;
const STALE_HOURS = 120; // current Mon/Thu cadence can legitimately span four days
const STUCK_HOURS = 3;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

type RunRow = {
  id: string;
  store: string;
  run_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  coverage_pct: number | null;
  threshold_pct: number | null;
  error_summary: string | null;
};

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('scrape_runs')
    .select('id, store, run_id, status, started_at, finished_at, coverage_pct, threshold_pct, error_summary')
    .in('store', [...STORES])
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  if (error) {
    console.error('[scrape-watchdog] failed to query scrape_runs', error);
    return NextResponse.json({ error: 'Failed to query scrape health' }, { status: 500 });
  }

  const rows = (data ?? []) as RunRow[];
  const now = Date.now();
  const issues: string[] = [];
  const stores: Record<string, { latest: RunRow | null; lastHealthy: RunRow | null }> = {};

  for (const store of STORES) {
    const storeRows = rows.filter((row) => row.store === store);
    const latest = storeRows[0] ?? null;
    const lastHealthy = storeRows.find((row) => row.status === 'success' || row.status === 'degraded') ?? null;
    stores[store] = { latest, lastHealthy };

    if (!latest) {
      issues.push(`${store}: no scrape run recorded in the last 8 days`);
      continue;
    }

    const latestAgeHours = (now - new Date(latest.started_at).getTime()) / 3_600_000;
    if (latest.status === 'running' && latestAgeHours > STUCK_HOURS) {
      issues.push(`${store}: run ${latest.run_id} has been running for ${latestAgeHours.toFixed(1)}h`);
    } else if (latest.status === 'failed') {
      issues.push(`${store}: latest run ${latest.run_id} failed${latest.error_summary ? ` — ${latest.error_summary}` : ''}`);
    } else if (latest.status === 'degraded') {
      const coverage = latest.coverage_pct == null ? 'unknown' : `${Number(latest.coverage_pct).toFixed(1)}%`;
      const threshold = latest.threshold_pct == null ? 'configured threshold' : `${Number(latest.threshold_pct).toFixed(1)}% threshold`;
      issues.push(`${store}: latest run ${latest.run_id} degraded — ${coverage} coverage vs ${threshold}`);
    }

    if (!lastHealthy) {
      issues.push(`${store}: no successful/degraded run recorded in the last 8 days`);
      continue;
    }

    const healthyAgeHours = (now - new Date(lastHealthy.started_at).getTime()) / 3_600_000;
    if (healthyAgeHours > STALE_HOURS) {
      issues.push(`${store}: last healthy run is ${healthyAgeHours.toFixed(0)}h old (${lastHealthy.run_id})`);
    }
  }

  if (issues.length === 0) {
    console.log('[scrape-watchdog] all stores healthy');
    return NextResponse.json({ healthy: true, issues: [], stores });
  }

  console.error('[scrape-watchdog] issues detected', { issues });

  const alertEmail = process.env.SCRAPE_ALERT_EMAIL?.trim();
  let emailSent = false;
  if (alertEmail && process.env.RESEND_API_KEY) {
    const list = issues.map((issue) => `<li>${issue.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)}</li>`).join('');
    const result = await resend.emails.send({
      from: 'supermarket.ie operations <hello@mail.supermarket.ie>',
      to: alertEmail,
      subject: `Scrape alert — ${issues.length} issue${issues.length === 1 ? '' : 's'}`,
      html: `<h2>supermarket.ie scrape health alert</h2><ul>${list}</ul><p>Review the scrape health dashboard and Vercel runtime logs before retrying blocked transports.</p>`,
    });
    emailSent = !result.error;
    if (result.error) console.error('[scrape-watchdog] email alert failed', result.error);
  }

  return NextResponse.json({ healthy: false, issues, emailSent, stores });
}
