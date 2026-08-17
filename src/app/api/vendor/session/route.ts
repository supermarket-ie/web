import { NextRequest, NextResponse } from 'next/server';
import { verifyVendorToken } from '@/lib/vendor-auth';

const COOKIE_NAME = 'vendor_session';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  const payload = verifyVendorToken(token);

  if (!payload) {
    const response = NextResponse.redirect(new URL('/vendor/signin?error=expired', request.url));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  const response = NextResponse.redirect(new URL('/vendor/dashboard', request.url));
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

export async function DELETE(request: NextRequest) {
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
