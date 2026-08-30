import { NextRequest } from 'next/server';
import { getSubscriberId } from '@/lib/auth';
import {
  CheckoutRuntimeSessionError,
  advanceOwnedCheckoutRuntimeSession,
  destroyOwnedCheckoutRuntimeSession,
  getOwnedCheckoutRuntimeSession,
} from '@/lib/shopping/checkout-runtime-session.server';

function owner(request: NextRequest) {
  return getSubscriberId(request.cookies.get('sm_session')?.value);
}

function failure(error: unknown) {
  const status = error instanceof CheckoutRuntimeSessionError ? error.status : 500;
  return Response.json({ error: status === 500 ? 'Checkout runtime failed' : (error as Error).message }, { status });
}

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const subscriberId = owner(request);
  if (!subscriberId) return Response.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    const { sessionId } = await context.params;
    return Response.json({ session: await getOwnedCheckoutRuntimeSession(subscriberId, sessionId) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const subscriberId = owner(request);
  if (!subscriberId) return Response.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    const { sessionId } = await context.params;
    return Response.json({ session: await advanceOwnedCheckoutRuntimeSession(subscriberId, sessionId) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  const subscriberId = owner(request);
  if (!subscriberId) return Response.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    const { sessionId } = await context.params;
    await destroyOwnedCheckoutRuntimeSession(subscriberId, sessionId);
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
