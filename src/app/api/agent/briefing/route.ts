import { NextRequest, NextResponse } from 'next/server';
import { getSubscriberId } from '@/lib/auth';
import { buildHouseholdBriefing } from '@/lib/household-briefing';

export const dynamic = 'force-dynamic';

function sessionToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const explicit = req.nextUrl.searchParams.get('token');
  return req.cookies.get('sm_session')?.value ?? bearer ?? (explicit && explicit !== '__cookie__' ? explicit : null);
}

export async function GET(request: NextRequest) {
  const subscriberId = getSubscriberId(sessionToken(request) ?? undefined);

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
