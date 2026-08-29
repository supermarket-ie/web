import { runGoogleAnalyticsReport } from '@/lib/google-analytics';

export const dynamic = 'force-static';

function rows(report: Awaited<ReturnType<typeof runGoogleAnalyticsReport>>) {
  const dimensions = report.dimensionHeaders?.map(item => item.name) ?? [];
  const metrics = report.metricHeaders?.map(item => item.name) ?? [];
  return (report.rows ?? []).map(row => Object.fromEntries([
    ...dimensions.map((name, index) => [name, row.dimensionValues?.[index]?.value ?? '']),
    ...metrics.map((name, index) => [name, row.metricValues?.[index]?.value ?? '0']),
  ]));
}

export default async function GaTrafficCheckPage() {
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
    console.info('[ga-traffic-agent-build-check]', JSON.stringify(rows(report)));
  } catch (error) {
    console.error('[ga-traffic-agent-build-check]', error instanceof Error ? error.message : error);
  }
  return null;
}
