import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import { queryPriceChanges } from '@/lib/planner-agent';
import { type PriceChange } from '@/lib/weekly-email-templates';
import {
  generateWatchdogEmail,
  type StoreSplitInfo,
  type WatchdogItem,
} from '@/lib/watchdog-email-template';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) throw new Error('CRON_SECRET environment variable is required');

const MIN_SAVINGS_EUR = 2.0;
const MIN_CHEAPER_ITEMS = 2;
const COOLDOWN_DAYS = 3;
const MAX_BATCH = 50;
const SPLIT_THRESHOLD_EUR = 3.0;

// ---------------------------------------------------------------------------
// Store-split calculation
// ---------------------------------------------------------------------------

function calcStoreSplit(cheaperItems: WatchdogItem[]): StoreSplitInfo {
  const groups: Record<string, { items: string[]; total: number }> = {};

  for (const item of cheaperItems) {
    const store = item.best_store_now;
    if (!groups[store]) {
      groups[store] = { items: [], total: 0 };
    }
    groups[store].items.push(item.canonical_name);
    groups[store].total = Number((groups[store].total + item.best_price_now).toFixed(2));
  }

  const topStores = Object.keys(groups).sort(
    (a, b) => groups[b].items.length - groups[a].items.length,
  );

  const totalSavings = cheaperItems.reduce((sum, c) => sum + Math.abs(c.change), 0);
  const worthSplitting = topStores.length >= 2 && totalSavings >= SPLIT_THRESHOLD_EUR;

  return { groups, worthSplitting, topStores };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
    }
    if (authHeader.substring(7) !== CRON_SECRET) {
      return NextResponse.json({ error: 'Invalid authorization token' }, { status: 401 });
    }

    // Check for nudge parameter (Thursday nudge has lower thresholds)
    const url = new URL(request.url);
    const nudge = url.searchParams.get('nudge') ?? undefined;
    const isThursdayNudge = nudge === 'thursday';

    const minSavings = isThursdayNudge ? 1.50 : MIN_SAVINGS_EUR;
    const minCheaperItems = isThursdayNudge ? 1 : MIN_CHEAPER_ITEMS;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';
    const cooldownDate = new Date(
      Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    console.log('[price-watchdog] Starting...');

    // --- Find subscriber IDs that have list_items (Tier 2+) ---
    const { data: listItemRows, error: listError } = await supabaseAdmin
      .from('list_items')
      .select('subscriber_id');

    if (listError) {
      console.error('[price-watchdog] Error fetching list_items:', listError);
      return NextResponse.json({ error: 'Failed to query list_items' }, { status: 500 });
    }

    const eligibleIds = [
      ...new Set(
        (listItemRows ?? [])
          .map((r: { subscriber_id: string }) => r.subscriber_id)
          .filter(Boolean),
      ),
    ] as string[];

    if (eligibleIds.length === 0) {
      console.log('[price-watchdog] No Tier 2+ subscribers found');
      return NextResponse.json({ sent: 0, skipped: 0, failed: 0, message: 'No Tier 2+ subscribers' });
    }

    // --- Fetch eligible subscribers respecting cooldown ---
    const { data: subscribers, error: subError } = await supabaseAdmin
      .from('subscribers')
      .select('id, email, unsubscribe_token, last_watchdog_sent, last_list_planned_at')
      .eq('subscribed', true)
      .in('id', eligibleIds)
      .or(`last_watchdog_sent.is.null,last_watchdog_sent.lt.${cooldownDate}`)
      .limit(MAX_BATCH);

    if (subError) {
      console.error('[price-watchdog] Error fetching subscribers:', subError);
      return NextResponse.json({ error: 'Failed to fetch subscribers' }, { status: 500 });
    }

    if (!subscribers || subscribers.length === 0) {
      console.log('[price-watchdog] No subscribers eligible (all in cooldown or none active)');
      return NextResponse.json({ sent: 0, skipped: 0, failed: 0, message: 'No subscribers eligible' });
    }

    console.log(`[price-watchdog] Processing ${subscribers.length} eligible subscribers`);

    let sent = 0;
    let skipped = 0;
    let skippedAlreadyPlanned = 0;
    let failed = 0;

    for (const subscriber of subscribers as {
      id: string;
      email: string;
      unsubscribe_token: string;
      last_watchdog_sent: string | null;
      last_list_planned_at: string | null;
    }[]) {
      try {
        // --- Skip if already planned this week (they're on top of it) ---
        if (subscriber.last_list_planned_at) {
          const lastPlanned = new Date(subscriber.last_list_planned_at);
          const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
          if (lastPlanned > threeDaysAgo) {
            skippedAlreadyPlanned++;
            console.log(`[price-watchdog] Skip ${subscriber.email}: already planned within 3 days (${subscriber.last_list_planned_at})`);
            continue;
          }
        }
        // Get price comparisons for this subscriber's usual items
        const priceChanges = (await queryPriceChanges(subscriber.id)) as PriceChange[];
        const cheaperItems: WatchdogItem[] = priceChanges
          .filter(c => c.direction === 'cheaper')
          .map(c => ({
            canonical_name: c.canonical_name,
            last_store: c.last_store,
            last_price: c.last_price,
            best_store_now: c.best_store_now,
            best_price_now: c.best_price_now,
            change: c.change,
            direction: 'cheaper' as const,
          }));

        // --- Threshold checks ---
        if (cheaperItems.length < minCheaperItems) {
          console.log(
            `[price-watchdog] Skip ${subscriber.email}: only ${cheaperItems.length} cheaper item(s)`,
          );
          skipped++;
          continue;
        }

        const totalSavings = Number(
          cheaperItems.reduce((sum, c) => sum + Math.abs(c.change), 0).toFixed(2),
        );

        if (totalSavings < minSavings) {
          console.log(
            `[price-watchdog] Skip ${subscriber.email}: savings €${totalSavings.toFixed(2)} < €${minSavings.toFixed(2)}`,
          );
          skipped++;
          continue;
        }

        // --- Build store split info ---
        const storeSplit = calcStoreSplit(cheaperItems);

        // --- Generate and send email ---
        const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${subscriber.unsubscribe_token}`;
        const dashboardUrl = `${siteUrl}/dashboard?source=watchdog`;

        const { subject, html } = generateWatchdogEmail({
          cheaperItems,
          totalSavings,
          storeSplit,
          dashboardUrl,
          unsubscribeUrl,
          nudge,
        });

        await resend.emails.send({
          from: 'Your grocery agent <hello@mail.supermarket.ie>',
          to: subscriber.email,
          subject,
          html,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });

        // --- Update cooldown timestamp ---
        await supabaseAdmin
          .from('subscribers')
          .update({ last_watchdog_sent: new Date().toISOString() })
          .eq('id', subscriber.id);

        sent++;
        console.log(
          `[price-watchdog] Sent to ${subscriber.email} — savings: €${totalSavings.toFixed(2)}, items: ${cheaperItems.length}, split: ${storeSplit.worthSplitting}`,
        );

        // 200ms delay between sends
        if (sent + failed + skipped + skippedAlreadyPlanned < subscribers.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (subscriberError) {
        console.error(`[price-watchdog] Failed for ${subscriber.email}:`, subscriberError);
        failed++;
      }
    }

    console.log(
      `[price-watchdog] Done: ${sent} sent, ${skipped} skipped, ${skippedAlreadyPlanned} skipped_already_planned, ${failed} failed`,
    );
    return NextResponse.json({ sent, skipped, skippedAlreadyPlanned, failed });
  } catch (error) {
    console.error('[price-watchdog] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
