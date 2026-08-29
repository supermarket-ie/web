import { NextResponse } from 'next/server';
import { runGoogleAnalyticsReport } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';

function rows(report: Awaited<ReturnType<typeof runGoogleAnalyticsReport>>) {
  const dimensions = report.dimensionHeaders?.map(item => item.name) ?? [];
  const metrics = report.metricHeaders?.map(item => item.name) ?? [];
  return (report.rows ?? []).map(row => Object.fromEntries([
    ...dimensions.map((name, index) => [name, row.dimensionValues?.[index]?.value ?? '']),
    ...metrics.map((name, index) => [name, row.metricValues?.[index]?.value ?? '0']),
  ]));
}

export async function GET() {
  try {
    const report = await runGoogleAnalyticsReport({
      dateRanges: [{ startDate: '2026-08-24', endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'engagedSessions' },
        { name: 'screenPageViews' },
      ],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 20,
    });
    console.info('[ga-traffic-agent-check]', JSON.stringify(rows(report)));
    return NextResponse.json({ connected: true, captured: true });
  } catch (error) {
    console.error('[ga-traffic-agent-check]', error instanceof Error ? error.message : error);
    return NextResponse.json({ connected: false }, { status: 503 });
  }
}
