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
      // Update existing subscriber (re-subscribe or update family size)
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
      subject: 'Your supermarket.ie shopping list is ready 🛒',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1A1A1A; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1D2324; margin: 0;">supermarket<span style="color: #006A35;">.ie</span></h1>
          </div>

          <h2 style="color: #1D2324;">Your shopping list is ready 🛒</h2>

          <p>We've built your personalised weekly shopping list with the best prices across Tesco, Dunnes &amp; SuperValu.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${magicLink}" style="background: #006A35; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
              View my shopping list &rarr;
            </a>
          </div>

          <p style="color: #636E72; font-size: 14px;">This link is valid for 7 days. Bookmark the page once you're in — we'll keep your list updated every week.</p>

          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

          <p style="font-size: 12px; color: #666; text-align: center;">
            supermarket.ie &middot;
            <a href="${unsubscribeUrl}" style="color: #666;">Unsubscribe</a> &middot;
            <a href="${process.env.NEXT_PUBLIC_SITE_URL}/privacy" style="color: #666;">Privacy Policy</a>
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
