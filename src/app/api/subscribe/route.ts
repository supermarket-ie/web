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
    const { email, familySize, savedListId } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
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
    const isReturningUser = existing?.subscribed === true;

    if (existing) {
      // Already exists — update family size and refresh unsubscribe token
      const { error: updateError } = await supabaseAdmin
        .from('subscribers')
        .update({
          subscribed: true,
          family_size: familySize || null,
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
          family_size: familySize || null,
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

    // Only notify Telegram and send welcome email for genuinely new signups
    // Returning active users just get a fresh token silently
    if (!isReturningUser) {
      const isNew = !existing;
      const label = isNew ? '🆕 New subscriber' : '🔄 Re-subscribed';
      const familyLabel: Record<string, string> = { '1': '1 person', '2': '2 people', '3-4': '3–4 people', '5+': '5+ people' };
      await notifyTelegram(
        `${label} on supermarket.ie!\n\n📧 ${email}\n👥 ${familyLabel[familySize] ?? familySize}\n📊 Total subscribers: ${count ?? '?'}`
      );

      // Send "your list is ready" email with magic link
      // If a specific list was just created, link directly to it
      const listParam = savedListId ? `&list=${savedListId}` : '';
      const magicLink = `${process.env.NEXT_PUBLIC_SITE_URL}/list?token=${jwtToken}${listParam}`;
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
      html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Your shopping list is ready</title>
  <!--[if mso]>
  <style>body, table, td {font-family: Arial, sans-serif !important;}</style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width: 520px; width: 100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <span style="font-size: 20px; font-weight: 700; color: #1A1A1A; letter-spacing: -0.5px;">supermarket</span><span style="font-size: 20px; font-weight: 700; color: #006A35; letter-spacing: -0.5px;">.ie</span>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="background-color: #006A35; border-radius: 12px 12px 0 0; padding: 36px 28px; text-align: center;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <span style="font-size: 40px;">&#x1F6D2;</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 16px;">
                    <span style="font-size: 24px; font-weight: 800; color: #ffffff; line-height: 1.2;">Your list is ready</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 8px;">
                    <span style="font-size: 15px; color: rgba(255,255,255,0.85);">Best prices across Tesco, Dunnes &amp; SuperValu</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background: #ffffff; border-radius: 0 0 12px 12px; border: 1px solid #e8e8e8; border-top: none; padding: 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-bottom: 20px;">
                    <span style="font-size: 15px; color: #333; line-height: 1.6;">Your personalised shopping list is ready. Click below to view it &mdash; we&rsquo;ll show you where to get the best value on every item.</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding: 8px 0 24px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" style="background-color: #006A35; border-radius: 8px;">
                          <!--[if mso]>
                          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${magicLink}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="17%" strokecolor="#006A35" fillcolor="#006A35">
                          <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">View my list &rarr;</center>
                          </v:roundrect>
                          <![endif]-->
                          <!--[if !mso]><!-->
                          <a href="${magicLink}" style="display: inline-block; background-color: #006A35; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; line-height: 1;">View my list &rarr;</a>
                          <!--<![endif]-->
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="border-top: 1px solid #f0f0f0; padding-top: 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding: 6px 0;">
                          <span style="font-size: 13px; color: #666;">&#x2713;&nbsp; Updated every week with fresh prices</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0;">
                          <span style="font-size: 13px; color: #666;">&#x2713;&nbsp; Bookmark the page for quick access</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0;">
                          <span style="font-size: 13px; color: #666;">&#x2713;&nbsp; This link is valid for 7 days</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 32px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <span style="font-size: 12px; color: #999;">supermarket.ie &mdash; Ireland&rsquo;s smartest grocery list</span>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 8px;">
                    <a href="${unsubscribeUrl}" style="font-size: 12px; color: #bbb; text-decoration: underline;">Unsubscribe</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`,
    });
    } // end if (!isReturningUser)

    return NextResponse.json({ success: true, token: jwtToken });
  } catch (error) {
    console.error('Subscribe error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
