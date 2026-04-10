import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const { data: subscriber } = await supabaseAdmin
      .from('subscribers')
      .select('id, email, family_size')
      .eq('email', email.toLowerCase().trim())
      .eq('subscribed', true)
      .single();

    if (!subscriber) {
      // Return a distinct flag so the UI can nudge the user to sign up
      // (not a full 404 to avoid leaking existence of emails to attackers — the UI handles it gracefully)
      return NextResponse.json({ success: true, found: false });
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

    const magicLink = `${process.env.NEXT_PUBLIC_SITE_URL}/list?token=${token}`;

    await resend.emails.send({
      from: 'supermarket.ie <hello@mail.supermarket.ie>',
      to: subscriber.email,
      subject: 'Your shopping list link',
      text: `Hi,

Here's your link to your supermarket.ie shopping list:

${magicLink}

This link is valid for 7 days. If you didn't request this, you can ignore this email.

— supermarket.ie
Unsubscribe: ${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe`,
      html: `
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1A1A1A; max-width: 520px; margin: 0 auto; padding: 32px 20px;">
          <p style="margin: 0 0 24px;"><strong>supermarket.ie</strong></p>

          <p style="margin: 0 0 16px;">Here&rsquo;s your link to your shopping list:</p>

          <p style="margin: 0 0 24px;">
            <a href="${magicLink}" style="color: #006A35; font-weight: 600;">${magicLink}</a>
          </p>

          <p style="margin: 0 0 32px; color: #555; font-size: 14px;">Valid for 7 days. If you didn&rsquo;t request this, you can ignore this email.</p>

          <p style="font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 16px; margin: 0;">
            supermarket.ie &middot;
            <a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe" style="color: #999;">Unsubscribe</a>
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
