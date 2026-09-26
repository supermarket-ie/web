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
    const contactPage = { filter: { fieldName: 'landingPagePlusQueryString', stringFilter: { matchType: 'EXACT' as const, value: '/contact' } } };
    const organicSource = { filter: { fieldName: 'sessionSourceMedium', stringFilter: { matchType: 'EXACT' as const, value: 'google / organic' } } };
    const redirectedContact = { filter: { fieldName: 'landingPagePlusQueryString', stringFilter: { matchType: 'EXACT' as const, value: '/?entry=contact' } } };
    const [totals, daily, sources, landings, events, contactDaily, contactSources, organicLandings, redirectedEvents] = await Promise.all([
      runGoogleAnalyticsReport({ dateRanges: [current, previous], metrics }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], dimensions: [{ name: 'date' }], metrics, orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 30 }),
      runGoogleAnalyticsReport({ dateRanges: [current], dimensions: [{ name: 'sessionSourceMedium' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 15 }),
      runGoogleAnalyticsReport({ dateRanges: [current], dimensions: [{ name: 'landingPagePlusQueryString' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 15 }),
      runGoogleAnalyticsReport({ dateRanges: [current], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }], orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }], limit: 40 }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }], dimensions: [{ name: 'date' }, { name: 'landingPagePlusQueryString' }], metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }], dimensionFilter: contactPage, orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 30 }),
      runGoogleAnalyticsReport({ dateRanges: [current], dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'sessionSourceMedium' }], metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }], dimensionFilter: contactPage, orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 20 }),
      runGoogleAnalyticsReport({ dateRanges: [current], dimensions: [{ name: 'sessionSourceMedium' }, { name: 'landingPagePlusQueryString' }], metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }], dimensionFilter: organicSource, orderBys: [{ desc: true, metric: { metricName: 'sessions' } }], limit: 20 }),
      runGoogleAnalyticsReport({ dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }], dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'eventName' }], metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }], dimensionFilter: redirectedContact, orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }], limit: 30 }),
    ]);

    return Response.json({
      captured_at: new Date().toISOString(),
      periods: { current, previous },
      totals: rows(totals),
      daily: rows(daily),
      sources: rows(sources),
      landings: rows(landings),
      events: rows(events),
      contact_daily: rows(contactDaily),
      contact_sources: rows(contactSources),
      organic_landings: rows(organicLandings),
      redirected_contact_events: rows(redirectedEvents),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[analytics-traffic-report]', error instanceof Error ? error.message : error);
    return Response.json({ error: 'Google Analytics report failed' }, { status: 502 });
  }
}
