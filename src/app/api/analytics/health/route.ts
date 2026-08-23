import { NextResponse } from 'next/server';
import { runGoogleAnalyticsReport } from '@/lib/google-analytics';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await runGoogleAnalyticsReport({
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 1,
    });
    return NextResponse.json({ configured: true, connected: true }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600' },
    });
  } catch (error) {
    console.error('[google-analytics-health]', error instanceof Error ? error.message : error);
    return NextResponse.json({
      configured: Boolean(
        process.env.GOOGLE_ANALYTICS_CREDENTIALS_JSON
        && process.env.GOOGLE_ANALYTICS_PROPERTY_ID
      ),
      connected: false,
    }, { status: 503 });
  }
}
