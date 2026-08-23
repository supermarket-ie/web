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
    const summaryMetrics = [
      'activeUsers', 'newUsers', 'sessions', 'engagedSessions',
      'engagementRate', 'averageSessionDuration', 'screenPageViews',
      'eventCount', 'keyEvents',
    ].map(name => ({ name }));
    const [current, previous, daily, sources, landings, devices, countries, events] = await Promise.all([
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }], metrics: summaryMetrics }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '56daysAgo', endDate: '29daysAgo' }], metrics: summaryMetrics }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '56daysAgo', endDate: 'today' }], dimensions: [{ name: 'date' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'engagedSessions' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 60 }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }], dimensions: [{ name: 'sessionSourceMedium' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }, { name: 'keyEvents' }], orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 12 }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }], dimensions: [{ name: 'landingPagePlusQueryString' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }, { name: 'keyEvents' }], orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 12 }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }], dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }], limit: 10 }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }], dimensions: [{ name: 'country' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }], orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 12 }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }, { name: 'keyEvents' }], orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }], limit: 20 }),
    ]);
    console.info('[google-analytics-assessment-summary]', JSON.stringify({ current: rows(current), previous: rows(previous) }));
    console.info('[google-analytics-assessment-daily]', JSON.stringify(rows(daily)));
    console.info('[google-analytics-assessment-sources]', JSON.stringify(rows(sources)));
    console.info('[google-analytics-assessment-landings]', JSON.stringify(rows(landings)));
    console.info('[google-analytics-assessment-devices]', JSON.stringify(rows(devices)));
    console.info('[google-analytics-assessment-countries]', JSON.stringify(rows(countries)));
    console.info('[google-analytics-assessment-events]', JSON.stringify(rows(events)));
    return NextResponse.json({ connected: true, assessment_captured: true });
  } catch (error) {
    console.error('[google-analytics-assessment]', error instanceof Error ? error.message : error);
    return NextResponse.json({ connected: false }, { status: 503 });
  }
}
