import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import {
  evaluateRetailerHealth,
  summariseSeverity,
  type ScrapeRunRow,
  type RetailerHealthInput,
} from '@/lib/retailer-health-alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Stores to evaluate for health/coverage.
const STORES = ['supervalu', 'dunnes', 'aldi'] as const;

// Actively-scheduled retailer scrape triggers. Defaults to dunnes + supervalu
// (Tesco's automated collection is intentionally disabled). Overridable via
// SCHEDULED_RETAILERS (comma-separated) so it tracks enabled_schedules without a
// code change. A store NOT listed here is never alerted as "missed".
function scheduledStores(): string[] {
  const raw = process.env.SCHEDULED_RETAILERS?.trim();
  if (raw) return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ['dunnes', 'supervalu'];
}

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const since = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('scrape_runs')
    .select('id, store, run_id, run_scope, status, started_at, finished_at, coverage_pct, threshold_pct, error_summary')
    .in('store', [...STORES])
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  if (error) {
    console.error('[scrape-watchdog] failed to query scrape_runs', error);
    return NextResponse.json({ error: 'Failed to query scrape health' }, { status: 500 });
  }

  const runs = (data ?? []) as ScrapeRunRow[];

  const [{ data: coverage, error: coverageError }, { data: comparison, error: comparisonError }, { data: snapshots, error: snapshotError }] = await Promise.all([
    supabaseAdmin.from('retailer_coverage_current').select('store, live_coverage_pct, expiring_within_24h'),
    supabaseAdmin.from('retailer_comparison_coverage_current').select('both_live_pct').single(),
    supabaseAdmin.from('retailer_coverage_snapshots').select('store, live_coverage_pct, captured_at').order('captured_at', { ascending: false }).limit(8),
  ]);

  const telemetryUnavailable = Boolean(coverageError || comparisonError || snapshotError);
  if (telemetryUnavailable) {
    console.error('[scrape-watchdog] coverage telemetry unavailable', { coverageError, comparisonError, snapshotError });
  }

  const input: RetailerHealthInput = {
    now,
    scheduledStores: scheduledStores(),
    stores: [...STORES],
    runs,
    coverage: (coverage ?? []).map((r) => ({ store: String(r.store), live_coverage_pct: r.live_coverage_pct as number | null, expiring_within_24h: r.expiring_within_24h as number | null })),
    coverageSnapshots: (snapshots ?? []).map((s) => ({ store: String(s.store), live_coverage_pct: s.live_coverage_pct as number | null, captured_at: String(s.captured_at) })),
    comparison: comparison ? { both_live_pct: (comparison as { both_live_pct: number | null }).both_live_pct } : null,
    telemetryUnavailable,
  };

  const issues = evaluateRetailerHealth(input);

  if (issues.length === 0) {
    console.log('[scrape-watchdog] all stores healthy');
    return NextResponse.json({ healthy: true, issues: [], severity: { high: 0, medium: 0 } });
  }

  const severity = summariseSeverity(issues);
  console.error('[scrape-watchdog] issues detected', { severity, issues: issues.map((i) => i.message) });

  // Deliver via the configured notification channel (Resend). Requirement:
  // alerts must be DELIVERED, not merely logged. If the channel is not
  // configured, say so explicitly in the response so monitoring of the monitor
  // is possible (and so a silent no-send is never mistaken for "healthy").
  const alertEmail = process.env.SCRAPE_ALERT_EMAIL?.trim();
  const channelConfigured = Boolean(alertEmail && process.env.RESEND_API_KEY);
  let emailSent = false;
  let deliveryError: string | null = null;

  if (channelConfigured) {
    const list = issues
      .map((i) => `<li><strong>[${i.severity.toUpperCase()}]</strong> ${escapeHtml(i.message)}</li>`)
      .join('');
    const result = await resend.emails.send({
      from: 'supermarket.ie operations <hello@mail.supermarket.ie>',
      to: alertEmail!,
      subject: `Scrape alert — ${severity.high} high / ${severity.medium} medium`,
      html: `<h2>supermarket.ie retailer refresh health</h2>
        <p>${issues.length} issue${issues.length === 1 ? '' : 's'} detected across the Mon/Thu retailer refresh.</p>
        <ul>${list}</ul>
        <p>Runs execute on AWS ECS (EventBridge → smie-prod-scheduled → SQS → smie-prod-sqs-consumer).
        Review CloudWatch logs for the <code>scheduled</code> / <code>sqs-consumer</code> streams and the
        retailer coverage views before acting. Do not lower matching-confidence thresholds.</p>`,
    });
    emailSent = !result.error;
    if (result.error) {
      deliveryError = String(result.error);
      console.error('[scrape-watchdog] email alert failed', result.error);
    }
  } else {
    deliveryError = 'alert channel not configured (SCRAPE_ALERT_EMAIL and/or RESEND_API_KEY missing)';
    console.error('[scrape-watchdog] ALERT NOT DELIVERED — channel unconfigured', { severity });
  }

  return NextResponse.json({
    healthy: false,
    severity,
    issues: issues.map((i) => ({ store: i.store, kind: i.kind, severity: i.severity, message: i.message })),
    channelConfigured,
    emailSent,
    deliveryError,
  });
}
