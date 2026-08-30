import { NextRequest } from 'next/server';
import { getSubscriberId } from '@/lib/auth';
import {
  CheckoutRuntimeSessionError,
  getOwnedCheckoutRuntimeShopperUrl,
} from '@/lib/shopping/checkout-runtime-session.server';

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const subscriberId = getSubscriberId(request.cookies.get('sm_session')?.value);
  if (!subscriberId) return Response.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    const { sessionId } = await context.params;
    const url = await getOwnedCheckoutRuntimeShopperUrl(subscriberId, sessionId);
    return new Response(null, {
      status: 307,
      headers: {
        Location: url,
        'Cache-Control': 'no-store, private',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    const status = error instanceof CheckoutRuntimeSessionError ? error.status : 500;
    return Response.json({ error: status === 500 ? 'Could not open checkout session' : (error as Error).message }, { status });
  }
}
