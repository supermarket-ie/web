import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) throw new Error('CRON_SECRET environment variable is required');

interface AlertWithLatestPrice {
  alert_id: string;
  subscriber_id: string;
  subscriber_email: string;
  product_id: string;
  product_name: string;
  target_price: number;
  latest_price: number | null;
  store: string | null;
  store_product_name: string | null;
}

function formatPrice(price: number): string {
  return `€${price.toFixed(2)}`;
}

function storeColor(store: string): string {
  switch (store.toLowerCase()) {
    case 'tesco': return '#00539F';
    case 'dunnes': return '#6B2D8B';
    case 'supervalu': return '#E31837';
    default: return '#006A35';
  }
}

function generateAlertEmailHTML(productName: string, currentPrice: number, targetPrice: number, store: string, unsubscribeUrl: string): string {
  const saving = targetPrice > currentPrice ? formatPrice(targetPrice - currentPrice) : null;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Price alert</title>
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

          <!-- Alert badge -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color: #FEF3C7; border-radius: 20px; padding: 6px 16px;">
                    <span style="font-size: 13px; font-weight: 700; color: #92400E;">&#x1F514; Price Alert Triggered</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background: #ffffff; border-radius: 12px; border: 1px solid #e8e8e8; overflow: hidden;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <!-- Product name bar -->
                <tr>
                  <td style="background-color: ${storeColor(store)}; padding: 14px 24px;">
                    <span style="font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.8); text-transform: uppercase; letter-spacing: 0.5px;">${store}</span>
                  </td>
                </tr>
                <!-- Content -->
                <tr>
                  <td style="padding: 28px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td>
                          <span style="font-size: 20px; font-weight: 700; color: #1A1A1A; line-height: 1.3;">${productName}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-top: 6px;">
                          <span style="font-size: 14px; color: #666;">has dropped to your target price!</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-top: 20px;">
                          <table cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td style="padding-right: 16px; vertical-align: middle;">
                                <span style="font-size: 32px; font-weight: 800; color: #006A35;">${formatPrice(currentPrice)}</span>
                              </td>
                              <td style="vertical-align: middle;">
                                <table cellpadding="0" cellspacing="0" border="0">
                                  <tr>
                                    <td>
                                      <span style="font-size: 12px; color: #999; display: block;">Your target</span>
                                    </td>
                                  </tr>
                                  <tr>
                                    <td>
                                      <span style="font-size: 15px; font-weight: 600; color: #555;">${formatPrice(targetPrice)}</span>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                              ${saving ? `
                              <td style="vertical-align: middle; padding-left: 16px;">
                                <span style="background: #DCFCE7; color: #166534; padding: 4px 10px; border-radius: 20px; font-size: 13px; font-weight: 700;">&darr; ${saving} under</span>
                              </td>
                              ` : ''}
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

          <!-- Note -->
          <tr>
            <td style="padding: 24px 0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f9fafb; border-radius: 8px; padding: 16px;">
                <tr>
                  <td style="padding: 16px;">
                    <span style="font-size: 13px; color: #666; line-height: 1.5;">This alert has been automatically disabled. You can set up new price alerts anytime from your shopping list.</span>
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

      </td>
    </tr>
  </table>

</body>
</html>`;
}

async function getAlertsWithPrices(): Promise<AlertWithLatestPrice[]> {
  // Get all active alerts with subscriber and product info
  const { data: alerts, error: alertsError } = await supabaseAdmin
    .from('price_alerts')
    .select(`
      id,
      subscriber_id,
      product_id,
      target_price,
      subscribers!inner(
        email,
        unsubscribe_token
      ),
      products!inner(
        canonical_name
      )
    `)
    .eq('active', true);

  if (alertsError) {
    console.error('[check-alerts] Error fetching alerts:', alertsError);
    return [];
  }

  if (!alerts || alerts.length === 0) {
    return [];
  }

  // Get latest prices for all products with alerts
  const productIds = alerts.map(alert => alert.product_id);

  const { data: priceData, error: priceError } = await supabaseAdmin
    .from('price_observations')
    .select(`
      store_product_id,
      price,
      observed_at,
      store_products!inner(
        product_id,
        store,
        store_product_name
      )
    `)
    .in('store_products.product_id', productIds)
    .not('price', 'is', null)
    .order('observed_at', { ascending: false });

  if (priceError) {
    console.error('[check-alerts] Error fetching prices:', priceError);
    return [];
  }

  // Create a map of product_id -> lowest current price info
  const lowestPrices = new Map<string, { price: number; store: string; store_product_name: string }>();

  for (const price of priceData || []) {
    const storeProduct = price.store_products as any;
    const productId = storeProduct.product_id;

    if (!lowestPrices.has(productId) || price.price! < lowestPrices.get(productId)!.price) {
      lowestPrices.set(productId, {
        price: price.price!,
        store: storeProduct.store,
        store_product_name: storeProduct.store_product_name
      });
    }
  }

  // Combine alerts with price info
  const result: AlertWithLatestPrice[] = alerts.map(alert => {
    const subscriber = alert.subscribers as any;
    const product = alert.products as any;
    const priceInfo = lowestPrices.get(alert.product_id);

    return {
      alert_id: alert.id,
      subscriber_id: alert.subscriber_id,
      subscriber_email: subscriber.email,
      product_id: alert.product_id,
      product_name: product.canonical_name,
      target_price: alert.target_price,
      latest_price: priceInfo?.price || null,
      store: priceInfo?.store || null,
      store_product_name: priceInfo?.store_product_name || null
    };
  });

  return result;
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

    console.log('[check-alerts] Starting price alert check...');

    // Get all alerts with current prices
    const alertsWithPrices = await getAlertsWithPrices();

    if (alertsWithPrices.length === 0) {
      console.log('[check-alerts] No active alerts found');
      return NextResponse.json({ triggered: 0, checked: 0 });
    }

    console.log(`[check-alerts] Checking ${alertsWithPrices.length} alerts`);

    let triggered = 0;
    const checked = alertsWithPrices.length;

    // Check each alert for price drops
    for (const alert of alertsWithPrices) {
      try {
        // Skip if no current price data
        if (alert.latest_price === null || !alert.store) {
          continue;
        }

        // Check if current price is at or below target
        if (alert.latest_price <= alert.target_price) {
          console.log(`[check-alerts] Alert triggered for ${alert.product_name}: ${alert.latest_price} <= ${alert.target_price}`);

          // Get subscriber unsubscribe token for email
          const { data: subscriber, error: subscriberError } = await supabaseAdmin
            .from('subscribers')
            .select('unsubscribe_token')
            .eq('id', alert.subscriber_id)
            .single();

          if (subscriberError) {
            console.error(`[check-alerts] Error fetching subscriber ${alert.subscriber_id}:`, subscriberError);
            continue;
          }

          const unsubscribeUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?token=${subscriber.unsubscribe_token}`;

          // Send alert email
          await resend.emails.send({
            from: 'supermarket.ie <hello@mail.supermarket.ie>',
            to: alert.subscriber_email,
            subject: `🔔 Price drop! ${alert.product_name} is now ${formatPrice(alert.latest_price)}`,
            html: generateAlertEmailHTML(
              alert.product_name,
              alert.latest_price,
              alert.target_price,
              alert.store,
              unsubscribeUrl
            )
          });

          // Deactivate the alert
          const { error: updateError } = await supabaseAdmin
            .from('price_alerts')
            .update({
              active: false,
              triggered_at: new Date().toISOString()
            })
            .eq('id', alert.alert_id);

          if (updateError) {
            console.error(`[check-alerts] Error updating alert ${alert.alert_id}:`, updateError);
          } else {
            triggered++;
            console.log(`[check-alerts] Alert ${alert.alert_id} triggered and deactivated`);
          }

          // Small delay between emails
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (alertError) {
        console.error(`[check-alerts] Error processing alert ${alert.alert_id}:`, alertError);
      }
    }

    console.log(`[check-alerts] Completed: ${triggered} triggered, ${checked} checked`);
    return NextResponse.json({ triggered, checked });

  } catch (error) {
    console.error('[check-alerts] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}