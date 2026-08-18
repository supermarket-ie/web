import { NextResponse } from 'next/server';
import { getSubscriberId } from '@/lib/auth';
import { buildHouseholdBriefing } from '@/lib/household-briefing';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearer ?? url.searchParams.get('token');
  const subscriberId = getSubscriberId(token ?? undefined);

  if (!subscriberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const briefing = await buildHouseholdBriefing(subscriberId);
    return NextResponse.json(briefing);
  } catch (error) {
    console.error('[agent-briefing] Failed', error);
    return NextResponse.json({ error: 'Unable to build briefing' }, { status: 500 });
  }
}
