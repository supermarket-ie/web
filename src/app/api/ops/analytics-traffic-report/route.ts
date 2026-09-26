import { runGoogleAnalyticsReport } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';

type Report = Awaited<ReturnType<typeof runGoogleAnalyticsReport>>;

function rows(report: Report) {
  const dimensions = report.dimensionHeaders?.map(item => item.name) ?? [];
  const metrics = report.metricHeaders?.map(item => item.name) ?? [];
  return (report.rows ?? []).map(row => Object.fromEntries([
    ...dimensions.map((name, index) => [name, row.dimensionValues?.[index]?.value ?? '']),
    ...metrics.map((name, index) => [name, row.metricValues?.[index]?.value ?? '0']),
  ]));
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Completed days avoid comparing a partial current day with a full day.
    const current = { startDate: '14daysAgo', endDate: 'yesterday' };
    const previous = { startDate: '28daysAgo', endDate: '15daysAgo' };
    const metrics = ['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'screenPageViews', 'keyEvents']
      .map(name => ({ name }));
    const [totals, daily, sources, landings, events] = await Promise.all([
      runGoogleAnalyticsReport({ dateRanges: [current, previous], metrics }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], dimensions: [{ name: 'date' }], metrics, orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 30 }),
      runGoogleAnalyticsReport({ dateRanges: [current], dimensions: [{ name: 'sessionSourceMedium' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 15 }),
      runGoogleAnalyticsReport({ dateRanges: [current], dimensions: [{ name: 'landingPagePlusQueryString' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 15 }),
      runGoogleAnalyticsReport({ dateRanges: [current], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }], orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }], limit: 40 }),
    ]);

    return Response.json({
      captured_at: new Date().toISOString(),
      periods: { current, previous },
      totals: rows(totals),
      daily: rows(daily),
      sources: rows(sources),
      landings: rows(landings),
      events: rows(events),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[analytics-traffic-report]', error instanceof Error ? error.message : error);
    return Response.json({ error: 'Google Analytics report failed' }, { status: 502 });
  }
}
