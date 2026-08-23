import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { parseMarkdownList } from '@/lib/parse-planner-markdown';

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

async function savePlannerList(subscriberId: string, familySize: string | undefined, plannerMarkdown: string) {
  const { items, storeTotals } = parseMarkdownList(plannerMarkdown);
  if (items.length === 0) return null;

  const { data: existingLists } = await supabaseAdmin
    .from('saved_lists')
    .select('id, created_at')
    .eq('subscriber_id', subscriberId)
    .order('created_at', { ascending: true });

  if (existingLists && existingLists.length >= 10) {
    const toDelete = existingLists.slice(0, existingLists.length - 9);
    await supabaseAdmin.from('saved_lists').delete().in('id', toDelete.map(row => row.id));
  }

  await supabaseAdmin
    .from('saved_lists')
    .update({ is_default: false })
    .eq('subscriber_id', subscriberId);

  const { data: newList, error: listError } = await supabaseAdmin
    .from('saved_lists')
    .insert({
      subscriber_id: subscriberId,
      name: 'Weekly grocery list',
      family_size: familySize ?? '2',
      items: items.map(item => ({
        canonical_name: item.canonical_name,
        category: item.category,
        store: item.store,
        price: item.price,
        quantity: item.quantity,
        on_promotion: item.on_promotion,
      })),
      store_totals: storeTotals,
      is_default: true,
      generated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (listError) throw listError;
  if (!newList?.id) return null;

  const listId = newList.id as string;
  await supabaseAdmin.from('list_items').insert(
    items.map(item => ({
      subscriber_id: subscriberId,
      list_id: listId,
      canonical_name: item.canonical_name,
      category: item.category,
      store: item.store,
      price_paid: item.price,
      quantity: item.quantity,
      observed_at: new Date().toISOString(),
    }))
  );

  return listId;
}

function buildWelcomeEmail({ accessLink, unsubscribeUrl, hasList }: { accessLink: string; unsubscribeUrl: string; hasList: boolean }) {
  const subject = hasList ? 'Your Supermarket.ie shopping list is ready' : 'Your Supermarket.ie agent is ready';
  const heading = hasList ? 'Your shopping list is ready' : 'Your household agent is ready';
  const intro = hasList
    ? 'Your personalised shopping list has been saved. Open it to review the products, prices and stores selected for you.'
    : 'You’re set up. Supermarket.ie can now remember your household and help you plan, find and manage what you need across Irish supermarkets.';
  const button = hasList ? 'View my shopping list' : 'Open Supermarket.ie';
  const supporting = hasList
    ? ['Review your saved shop any time', 'Keep an eye on current supermarket prices', 'Ask the agent to adjust the shop around your household']
    : ['Ask for products, meals, household items or a budget', 'Build and refine a shop through conversation', 'Ask your agent to watch for useful changes'];

  return {
    subject,
    text: `Hi,\n\n${heading}.\n\n${intro}\n\n${accessLink}\n\n${supporting.map(item => `• ${item}`).join('\n')}\n\nThis secure link is valid for 7 days.\n\n— supermarket.ie\nUnsubscribe: ${unsubscribeUrl}`,
    html: `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#F6F2EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#183126;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:#F6F2EA;">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table width="560" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;max-width:560px;">
          <tr>
            <td style="padding:0 4px 18px;font-size:22px;font-weight:800;letter-spacing:-0.6px;color:#173827;">
              supermarket<span style="color:#0A7A3E;">.ie</span>
            </td>
          </tr>
          <tr>
            <td style="background:#0F6B3B;border-radius:22px;padding:34px 32px;">
              <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#D9F0DE;margin-bottom:10px;">Ireland’s household shopping agent</div>
              <div style="font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.8px;color:#FFFFFF;">${heading}</div>
              <div style="font-size:16px;line-height:1.6;color:#E7F4EA;margin-top:14px;">${intro}</div>
            </td>
          </tr>
          <tr>
            <td style="background:#FFFFFF;border:1px solid #E8E2D8;border-top:0;border-radius:0 0 22px 22px;padding:30px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                <tr>
                  <td style="padding-bottom:24px;">
                    <a href="${accessLink}" style="display:inline-block;background:#13271D;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:800;padding:14px 22px;border-radius:999px;">${button} →</a>
                  </td>
                </tr>
                ${supporting.map(item => `<tr><td style="padding:7px 0;font-size:14px;line-height:1.5;color:#526258;"><span style="color:#0A7A3E;font-weight:800;">✓</span>&nbsp;&nbsp;${item}</td></tr>`).join('')}
                <tr>
                  <td style="padding-top:24px;font-size:12px;line-height:1.5;color:#8A918C;border-top:1px solid #EEEAE3;">This secure link is valid for 7 days. You can return to Supermarket.ie at any time after signing in.</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 4px 0;font-size:11px;line-height:1.5;color:#92978F;">
              Supermarket.ie helps Irish households plan and manage grocery and household shopping across retailers.<br />
              <a href="${unsubscribeUrl}" style="color:#7D847E;text-decoration:underline;">Unsubscribe</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { email, familySize, plannerMarkdown } = await request.json();

    if (typeof email !== 'string' || !email.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const unsubscribeToken = crypto.randomBytes(32).toString('hex');

    const { data: existing } = await supabaseAdmin
      .from('subscribers')
      .select('id, subscribed, family_size')
      .eq('email', normalizedEmail)
      .single();

    let subscriberId: string;
    const isReturningUser = existing?.subscribed === true;

    if (existing) {
      const { error: updateError } = await supabaseAdmin
        .from('subscribers')
        .update({
          subscribed: true,
          family_size: familySize || existing.family_size || null,
          unsubscribe_token: unsubscribeToken,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateError) throw updateError;
      subscriberId = existing.id;
    } else {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('subscribers')
        .insert({
          email: normalizedEmail,
          family_size: familySize || null,
          unsubscribe_token: unsubscribeToken,
          subscribed: true,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      subscriberId = inserted.id;
    }

    const jwtToken = jwt.sign(
      { email: normalizedEmail, subscriberId, familySize: familySize || existing?.family_size || '2' },
      SECRET!,
      { expiresIn: '7d' }
    );

    let savedListId: string | null = null;
    if (typeof plannerMarkdown === 'string' && plannerMarkdown.trim()) {
      try {
        savedListId = await savePlannerList(subscriberId, familySize, plannerMarkdown);
      } catch (error) {
        console.warn('[subscribe] planner list save failed (non-fatal):', error);
      }
    }

    if (!isReturningUser) {
      const { count } = await supabaseAdmin
        .from('subscribers')
        .select('*', { count: 'exact', head: true })
        .eq('subscribed', true);

      const isNew = !existing;
      const label = isNew ? '🆕 New subscriber' : '🔄 Re-subscribed';
      const familyLabel: Record<string, string> = { '1': '1 person', '2': '2 people', '3-4': '3–4 people', '5+': '5+ people' };
      await notifyTelegram(
        `${label} on supermarket.ie!\n\n📧 ${normalizedEmail}\n👥 ${familyLabel[familySize] ?? familySize ?? 'Not set'}\n📊 Total subscribers: ${count ?? '?'}`
      );

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
      const accessLink = savedListId
        ? `${siteUrl}/api/session?token=${encodeURIComponent(jwtToken)}&list=${encodeURIComponent(savedListId)}`
        : `${siteUrl}/api/session?token=${encodeURIComponent(jwtToken)}&next=home`;
      const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${unsubscribeToken}`;
      const welcome = buildWelcomeEmail({ accessLink, unsubscribeUrl, hasList: Boolean(savedListId) });

      const { error: emailError } = await resend.emails.send({
        from: 'supermarket.ie <hello@mail.supermarket.ie>',
        to: normalizedEmail,
        subject: welcome.subject,
        text: welcome.text,
        html: welcome.html,
      });

      if (emailError) console.error('[subscribe] welcome email failed:', emailError);
    }

    return NextResponse.json({
      success: true,
      token: jwtToken,
      list_id: savedListId,
      is_new_registration: !existing,
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
