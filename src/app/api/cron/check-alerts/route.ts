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

function generateAlertEmailHTML(productName: string, currentPrice: number, targetPrice: number, store: string, unsubscribeUrl: string): string {
  return `
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1A1A1A; max-width: 520px; margin: 0 auto; padding: 32px 20px;">
      <p style="margin: 0 0 8px; font-weight: 600; color: #006A35;">supermarket.ie</p>
      <h1 style="margin: 0 0 16px; font-size: 24px; font-weight: 700; color: #1A1A1A;">🔔 Price alert!</h1>

      <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; margin: 24px 0; border-left: 4px solid #006A35;">
        <h2 style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #1A1A1A;">${productName}</h2>
        <p style="margin: 0 0 8px; color: #555; font-size: 14px;">is now available at your target price!</p>

        <div style="display: flex; align-items: center; gap: 12px; margin: 16px 0;">
          <span style="font-weight: 700; font-size: 20px; color: #006A35;">${formatPrice(currentPrice)}</span>
          <span style="background: #006A35; color: white; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;">Target: ${formatPrice(targetPrice)}</span>
        </div>

        <p style="margin: 8px 0 0; color: #666; font-size: 14px;">Available at: <strong>${store}</strong></p>
      </div>

      <p style="margin: 24px 0; color: #666; font-size: 14px;">This alert has been automatically disabled. You can set up new alerts anytime on your shopping list page.</p>

      <p style="font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 16px; margin: 32px 0 0; text-align: center;">
        supermarket.ie &middot;
        <a href="${unsubscribeUrl}" style="color: #999;">Unsubscribe</a>
      </p>
    </body>
    </html>
  `;
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