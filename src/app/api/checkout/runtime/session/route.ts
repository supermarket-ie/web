import { NextRequest } from 'next/server';
import { getSubscriberId } from '@/lib/auth';
import {
  CheckoutRuntimeSessionError,
  createOwnedCheckoutRuntimeSession,
} from '@/lib/shopping/checkout-runtime-session.server';

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const subscriberId = getSubscriberId(request.cookies.get('sm_session')?.value);
  if (!subscriberId) return Response.json({ error: 'Unauthorised' }, { status: 401 });
  const body = await request.json().catch(() => null) as { list_id?: unknown; retailer?: unknown } | null;
  if (!body || typeof body.list_id !== 'string' || body.retailer !== 'supervalu') {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    return Response.json(await createOwnedCheckoutRuntimeSession({
      subscriberId,
      listId: body.list_id,
      retailer: 'supervalu',
    }), { status: 201 });
  } catch (error) {
    const status = error instanceof CheckoutRuntimeSessionError ? error.status : 500;
    return Response.json({ error: status === 500 ? 'Could not create checkout session' : (error as Error).message }, { status });
  }
}
