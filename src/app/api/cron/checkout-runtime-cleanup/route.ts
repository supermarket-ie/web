import { NextRequest } from 'next/server';
import { cleanupExpiredCheckoutRuntimeSessions } from '@/lib/shopping/checkout-runtime-session.server';

export async function GET(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorised' }, { status: 401 });
  }
  const cleaned = await cleanupExpiredCheckoutRuntimeSessions();
  return Response.json({ ok: true, cleaned });
}
