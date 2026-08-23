import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/auth';

const COOKIE_NAME = 'sm_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const payload = verifySessionToken(token);
  if (!payload) {
    const response = NextResponse.redirect(new URL('/list/request?error=expired', request.url));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const next = request.nextUrl.searchParams.get('next');
  const target = new URL(next === 'home' ? '/' : '/list', request.url);
  const listId = request.nextUrl.searchParams.get('list');
  const intent = request.nextUrl.searchParams.get('intent');
  if (listId && next !== 'home') target.searchParams.set('list', listId);
  if (intent) target.searchParams.set('intent', intent);

  return setSessionCookie(NextResponse.redirect(target), token);
}

// One-time compatibility bridge for users who already had a valid JWT saved
// in localStorage before cookie sessions were introduced. The credential is
// sent in the request body rather than a URL, validated, then replaced locally
// with a non-secret marker.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!verifySessionToken(token)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }
  return setSessionCookie(NextResponse.json({ success: true }), token);
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
