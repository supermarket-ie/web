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

function storeColor(store: string): string {
  switch (store.toLowerCase()) {
    case 'tesco': return '#00539F';
    case 'dunnes': return '#6B2D8B';
    case 'supervalu': return '#E31837';
    default: return '#006A35';
  }
}

function generateEmailHTML(deals: Deal[], magicLink: string, unsubscribeUrl: string): string {
  const dealsHTML = deals.map((deal, i) => `
    <tr>
      <td style="padding: 0 0 ${i < deals.length - 1 ? '12' : '0'}px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #ffffff; border-radius: 8px; border: 1px solid #e8e8e8;">
          <tr>
            <td style="padding: 16px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-size: 16px; font-weight: 700; color: #1A1A1A; line-height: 1.3;">${deal.product_name}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 4px;">
                    <span style="font-size: 12px; font-weight: 600; color: ${storeColor(deal.store)}; text-transform: uppercase; letter-spacing: 0.5px;">${deal.store}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 12px;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right: 12px;">
                          <span style="font-size: 22px; font-weight: 800; color: #006A35;">${formatPrice(deal.current_price)}</span>
                        </td>
                        <td style="padding-right: 12px;">
                          <span style="font-size: 14px; color: #999; text-decoration: line-through;">${formatPrice(deal.was_price)}</span>
                        </td>
                        <td>
                          <span style="background: #DCFCE7; color: #166534; padding: 3px 8px; border-radius: 20px; font-size: 12px; font-weight: 700;">Save ${formatPrice(deal.saving)}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Your weekly deals</title>
  <!--[if mso]>
  <style>body, table, td {font-family: Arial, sans-serif !important;}</style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <!-- Container -->
        <table width="520" cellpadding="0" cellspacing="0" border="0" style="max-width: 520px; width: 100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <span style="font-size: 20px; font-weight: 700; color: #1A1A1A; letter-spacing: -0.5px;">supermarket</span><span style="font-size: 20px; font-weight: 700; color: #006A35; letter-spacing: -0.5px;">.ie</span>
            </td>
          </tr>

          <!-- Hero card -->
          <tr>
            <td style="background: linear-gradient(135deg, #006A35 0%, #00873E 100%); background-color: #006A35; border-radius: 12px 12px 0 0; padding: 32px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="font-size: 14px; color: rgba(255,255,255,0.8); font-weight: 500;">${formatDate()}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 8px;">
                    <span style="font-size: 26px; font-weight: 800; color: #ffffff; line-height: 1.2;">This week&rsquo;s best deals</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 8px;">
                    <span style="font-size: 15px; color: rgba(255,255,255,0.85); line-height: 1.5;">We found ${deals.length} price drops across Tesco, Dunnes &amp; SuperValu.</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Deals section -->
          <tr>
            <td style="background: #fafafa; padding: 24px 28px; border-radius: 0 0 12px 12px; border: 1px solid #e8e8e8; border-top: none;">
              ${deals.length > 0 ? `
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                ${dealsHTML}
              </table>
              ` : `
              <p style="margin: 0; color: #666; font-size: 15px; text-align: center; padding: 16px 0;">No promotions this week &mdash; but your list still has the best regular prices!</p>
              `}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding: 32px 0;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color: #006A35; border-radius: 8px;">
                    <!--[if mso]>
                    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${magicLink}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="17%" strokecolor="#006A35" fillcolor="#006A35">
                    <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">View your full list &rarr;</center>
                    </v:roundrect>
                    <![endif]-->
                    <!--[if !mso]><!-->
                    <a href="${magicLink}" style="display: inline-block; background-color: #006A35; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; line-height: 1;">View your full list &rarr;</a>
                    <!--<![endif]-->
                  </td>
                </tr>
              </table>
              <table cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px;">
                <tr>
                  <td>
                    <span style="font-size: 13px; color: #999;">Updated every Monday &bull; Always free</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="border-top: 1px solid #e8e8e8; padding-top: 24px;">
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
        <!-- /Container -->

      </td>
    </tr>
  </table>
  <!-- /Wrapper -->

</body>
</html>`;
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