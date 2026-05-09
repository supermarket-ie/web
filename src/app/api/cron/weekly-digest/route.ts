import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SECRET = process.env.MAGIC_LINK_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');
if (!CRON_SECRET) throw new Error('CRON_SECRET environment variable is required');

interface Deal {
  product_name: string;
  store: string;
  current_price: number;
  was_price: number;
  saving: number;
}

async function getTopDeals(limit = 5): Promise<Deal[]> {
  // Get deals from the last 7 days with biggest price drops
  const { data: deals, error } = await supabaseAdmin
    .from('price_observations')
    .select(`
      price,
      was_price,
      store_product_id,
      store_products!inner(
        store,
        store_product_name,
        products!inner(
          canonical_name
        )
      )
    `)
    .eq('on_promotion', true)
    .not('was_price', 'is', null)
    .not('price', 'is', null)
    .gte('observed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('observed_at', { ascending: false });

  if (error) {
    console.error('[weekly-digest] Error fetching deals:', error);
    return [];
  }

  if (!deals) return [];

  // Calculate savings and sort by biggest savings
  const dealsWithSavings = deals
    .map(deal => {
      const storeProduct = deal.store_products as any;
      const product = storeProduct?.products as any;

      if (!deal.price || !deal.was_price || !storeProduct || !product) return null;

      const saving = deal.was_price - deal.price;
      if (saving <= 0) return null;

      return {
        product_name: product.canonical_name,
        store: storeProduct.store,
        current_price: deal.price,
        was_price: deal.was_price,
        saving
      };
    })
    .filter((deal): deal is Deal => deal !== null)
    .sort((a, b) => b.saving - a.saving)
    .slice(0, limit);

  return dealsWithSavings;
}

function formatPrice(price: number): string {
  return `€${price.toFixed(2)}`;
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-IE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function generateEmailHTML(deals: Deal[], magicLink: string, unsubscribeUrl: string): string {
  const dealsHTML = deals.map(deal => `
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #f0f0f0;">
        <div style="font-weight: 600; font-size: 15px; color: #1A1A1A; margin-bottom: 4px;">${deal.product_name}</div>
        <div style="font-size: 13px; color: #666; margin-bottom: 6px;">${deal.store}</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 700; font-size: 16px; color: #006A35;">${formatPrice(deal.current_price)}</span>
          <span style="text-decoration: line-through; color: #999; font-size: 14px;">${formatPrice(deal.was_price)}</span>
          <span style="background: #006A35; color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px; font-weight: 600;">Save ${formatPrice(deal.saving)}</span>
        </div>
      </td>
    </tr>
  `).join('');

  return `
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1A1A1A; max-width: 520px; margin: 0 auto; padding: 32px 20px;">
      <p style="margin: 0 0 8px; font-weight: 600; color: #006A35;">supermarket.ie</p>
      <h1 style="margin: 0 0 24px; font-size: 24px; font-weight: 700; color: #1A1A1A;">Your weekly deals</h1>
      <p style="margin: 0 0 24px; color: #555; font-size: 14px;">${formatDate()}</p>

      <h2 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1A1A1A;">🔥 Top deals this week</h2>

      ${deals.length > 0 ? `
        <table style="width: 100%; margin-bottom: 32px;">
          ${dealsHTML}
        </table>
      ` : `
        <p style="margin: 0 0 32px; color: #666; font-style: italic;">No special deals this week, but your regular list is always up-to-date with the best prices!</p>
      `}

      <div style="text-align: center; margin: 32px 0;">
        <a href="${magicLink}" style="display: inline-block; background: linear-gradient(135deg, #006A35, #008A45); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">View your full list →</a>
      </div>

      <p style="margin: 24px 0 0; color: #666; font-size: 13px; text-align: center;">Prices updated weekly • Free to use</p>

      <p style="font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 16px; margin: 32px 0 0; text-align: center;">
        supermarket.ie &middot;
        <a href="${unsubscribeUrl}" style="color: #999;">Unsubscribe</a>
      </p>
    </body>
    </html>
  `;
}

export async function GET(request: NextRequest) {
  try {
    // Check authorization
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    if (token !== CRON_SECRET) {
      return NextResponse.json({ error: 'Invalid authorization token' }, { status: 401 });
    }

    // Get all active subscribers
    const { data: subscribers, error: subscribersError } = await supabaseAdmin
      .from('subscribers')
      .select('id, email, family_size, unsubscribe_token')
      .eq('subscribed', true);

    if (subscribersError) {
      console.error('[weekly-digest] Error fetching subscribers:', subscribersError);
      return NextResponse.json({ error: 'Failed to fetch subscribers' }, { status: 500 });
    }

    if (!subscribers || subscribers.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, message: 'No subscribers found' });
    }

    // Get top deals for this week
    const deals = await getTopDeals(5);

    let sent = 0;
    let failed = 0;

    // Send emails sequentially with delays
    for (const subscriber of subscribers) {
      try {
        // Generate fresh 7-day JWT
        const jwtToken = jwt.sign(
          {
            email: subscriber.email,
            subscriberId: subscriber.id,
            familySize: subscriber.family_size || '2'
          },
          SECRET!,
          { expiresIn: '7d' }
        );

        const magicLink = `${process.env.NEXT_PUBLIC_SITE_URL}/list?token=${jwtToken}`;
        const unsubscribeUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?token=${subscriber.unsubscribe_token}`;

        await resend.emails.send({
          from: 'supermarket.ie <hello@mail.supermarket.ie>',
          to: subscriber.email,
          subject: `Your weekly deals - ${formatDate()}`,
          html: generateEmailHTML(deals, magicLink, unsubscribeUrl)
        });

        sent++;
        console.log(`[weekly-digest] Email sent to: ${subscriber.email}`);

        // Small delay between emails to avoid rate limiting
        if (sent < subscribers.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (emailError) {
        console.error(`[weekly-digest] Failed to send email to ${subscriber.email}:`, emailError);
        failed++;
      }
    }

    console.log(`[weekly-digest] Completed: ${sent} sent, ${failed} failed`);
    return NextResponse.json({ sent, failed });

  } catch (error) {
    console.error('[weekly-digest] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}