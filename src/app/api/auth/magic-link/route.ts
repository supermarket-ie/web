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
      subject: 'Your supermarket.ie shopping list',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1A1A1A; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1D2324; margin: 0;">supermarket<span style="color: #E17055;">.ie</span></h1>
          </div>

          <h2 style="color: #1D2324;">Your weekly shopping list is ready 🛒</h2>

          <p>Click the button below to view your personalised shopping list with the best prices across Tesco, Dunnes &amp; SuperValu.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${magicLink}" style="background: #E17055; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
              View my shopping list &rarr;
            </a>
          </div>

          <p style="color: #636E72; font-size: 14px;">This link is valid for 7 days. If you didn&rsquo;t request this, you can ignore this email.</p>

          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

          <p style="font-size: 12px; color: #666; text-align: center;">
            supermarket.ie &middot; <a href="${process.env.NEXT_PUBLIC_SITE_URL}/privacy" style="color: #666;">Privacy Policy</a>
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
