import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
}

function rateLimited(request: NextRequest) {
  const now = Date.now();
  const key = clientKey(request);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_REQUESTS;
}

export async function POST(request: NextRequest) {
  try {
    if (rateLimited(request)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { email } = await request.json();
    if (typeof email !== 'string' || !email.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const { data: subscriber } = await supabaseAdmin
      .from('subscribers')
      .select('id, email, family_size')
      .eq('email', normalizedEmail)
      .eq('subscribed', true)
      .single();

    // Deliberately use the same response whether the account exists or not.
    // This prevents the sign-in endpoint being used to enumerate subscribers.
    if (!subscriber) {
      return NextResponse.json({ success: true });
    }

    const token = jwt.sign(
      {
        email: subscriber.email,
        subscriberId: subscriber.id,
        familySize: subscriber.family_size ?? '2',
      },
      SECRET!,
      { expiresIn: '7d' }
    );

    // The bearer token exists only on the one-time exchange URL. The exchange
    // validates it, sets an HttpOnly cookie and redirects to a clean /list URL.
    const magicLink = `${process.env.NEXT_PUBLIC_SITE_URL}/api/session?token=${encodeURIComponent(token)}`;

    await resend.emails.send({
      from: 'supermarket.ie <hello@mail.supermarket.ie>',
      to: subscriber.email,
      subject: 'Your shopping list link',
      text: `Hi,\n\nHere's your link to your supermarket.ie shopping list:\n\n${magicLink}\n\nThis link is valid for 7 days. If you didn't request this, you can ignore this email.\n\n— supermarket.ie\nUnsubscribe: ${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe`,
      html: `
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1A1A1A; max-width: 520px; margin: 0 auto; padding: 32px 20px;">
          <p style="margin: 0 0 24px;"><strong>supermarket.ie</strong></p>
          <p style="margin: 0 0 16px;">Here&rsquo;s your link to your shopping list:</p>
          <p style="margin: 0 0 24px;"><a href="${magicLink}" style="color: #006A35; font-weight: 600;">Open my shopping list &rarr;</a></p>
          <p style="margin: 0 0 32px; color: #555; font-size: 14px;">Valid for 7 days. If you didn&rsquo;t request this, you can ignore this email.</p>
          <p style="font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 16px; margin: 0;">
            supermarket.ie &middot; <a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe" style="color: #999;">Unsubscribe</a>
          </p>
        </body>
        </html>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[magic-link] error:', error);
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
  }
}
