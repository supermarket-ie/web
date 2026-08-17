import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/auth';

const COOKIE_NAME = 'sm_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const payload = verifySessionToken(token);
  if (!payload) {
    const response = NextResponse.redirect(new URL('/list/request?error=expired', request.url));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const target = new URL('/list', request.url);
  const listId = request.nextUrl.searchParams.get('list');
  const intent = request.nextUrl.searchParams.get('intent');
  if (listId) target.searchParams.set('list', listId);
  if (intent) target.searchParams.set('intent', intent);

  const response = NextResponse.redirect(target);
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
