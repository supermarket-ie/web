import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

async function notifyTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('[subscribe] Telegram notification failed:', err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { email, familySize } = await request.json();

    if (!email || !familySize) {
      return NextResponse.json(
        { error: 'Email and family size are required' },
        { status: 400 }
      );
    }

    const unsubscribeToken = crypto.randomBytes(32).toString('hex');

    // Check if email already exists
    const { data: existing } = await supabaseAdmin
      .from('subscribers')
      .select('id, subscribed, family_size')
      .eq('email', email.toLowerCase())
      .single();

    let subscriberId: string;

    if (existing) {
      // Already subscribed — just update family size and return a fresh token (don't error)
      const { error: updateError } = await supabaseAdmin
        .from('subscribers')
        .update({
          subscribed: true,
          family_size: familySize,
          unsubscribe_token: unsubscribeToken,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateError) throw updateError;
      subscriberId = existing.id;
    } else {
      // Insert new subscriber
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('subscribers')
        .insert({
          email: email.toLowerCase(),
          family_size: familySize,
          unsubscribe_token: unsubscribeToken,
          subscribed: true,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      subscriberId = inserted.id;
    }

    // Generate a magic-link JWT so the user lands straight on their list
    const jwtToken = jwt.sign(
      {
        email: email.toLowerCase(),
        subscriberId,
        familySize,
      },
      SECRET!,
      { expiresIn: '7d' }
    );

    // Count total subscribers
    const { count } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('subscribed', true);

    // Notify via Telegram
    const isNew = !existing;
    const label = isNew ? '🆕 New subscriber' : '🔄 Re-subscribed';
    const familyLabel: Record<string, string> = { '1': '1 person', '2': '2 people', '3-4': '3–4 people', '5+': '5+ people' };
    await notifyTelegram(
      `${label} on supermarket.ie!\n\n📧 ${email}\n👥 ${familyLabel[familySize] ?? familySize}\n📊 Total subscribers: ${count ?? '?'}`
    );

    // Send "your list is ready" email with magic link
    const magicLink = `${process.env.NEXT_PUBLIC_SITE_URL}/list?token=${jwtToken}`;
    const unsubscribeUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?token=${unsubscribeToken}`;

    await resend.emails.send({
      from: 'supermarket.ie <hello@mail.supermarket.ie>',
      to: email,
      subject: 'Your shopping list is ready',
      text: `Hi,

Your supermarket.ie shopping list is ready. Here's your link:

${magicLink}

We'll update your prices every week. Bookmark the page once you're in so you can come back any time.

This link is valid for 7 days.

— supermarket.ie
Unsubscribe: ${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?token=${unsubscribeToken}`,
      html: `
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1A1A1A; max-width: 520px; margin: 0 auto; padding: 32px 20px;">
          <p style="margin: 0 0 24px;"><strong>supermarket.ie</strong></p>

          <p style="margin: 0 0 16px;">Your shopping list is ready. Here&rsquo;s your link:</p>

          <p style="margin: 0 0 16px;">
            <a href="${magicLink}" style="color: #006A35; font-weight: 600;">${magicLink}</a>
          </p>

          <p style="margin: 0 0 32px; color: #555; font-size: 14px;">Bookmark the page once you&rsquo;re in — we&rsquo;ll update your prices every week. This link is valid for 7 days.</p>

          <p style="font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 16px; margin: 0;">
            supermarket.ie &middot;
            <a href="${unsubscribeUrl}" style="color: #999;">Unsubscribe</a>
          </p>
        </body>
        </html>
      `,
    });

    return NextResponse.json({ success: true, token: jwtToken });
  } catch (error) {
    console.error('Subscribe error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
