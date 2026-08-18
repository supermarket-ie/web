import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import { buildHouseholdBriefing } from '@/lib/household-briefing';
import { generateHouseholdBriefingEmail } from '@/lib/household-briefing-email';
import { generateTier1Email, type Deal } from '@/lib/weekly-email-templates';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SECRET = process.env.MAGIC_LINK_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');
if (!CRON_SECRET) throw new Error('CRON_SECRET environment variable is required');

const MIN_SAVING_PCT = 0.15;
const MAX_RATIO = 1.9;
const MAX_PER_STORE = 2;
const MAX_PER_CATEGORY = 2;

function inferCategory(name: string): string {
  const n = name.toLowerCase();
  if (/toothpaste|toothbrush|mouthwash|floss|dental|oral.b|colgate/.test(n)) return 'oral-care';
  if (/shampoo|conditioner|shower gel|body wash|soap|deodorant/.test(n)) return 'personal-care';
  if (/washing|detergent|fabric|bleach|cleaner|toilet roll|kitchen roll|bin bag/.test(n)) return 'household';
  if (/milk|butter|cheese|cream|yogurt|yoghurt/.test(n)) return 'dairy';
  if (/chicken|beef|pork|lamb|mince|steak|sausage|bacon|ham/.test(n)) return 'meat';
  if (/bread|roll|wrap|bagel|croissant|loaf/.test(n)) return 'bakery';
  if (/apple|banana|orange|berry|grape|strawberry|melon/.test(n)) return 'fruit';
  if (/carrot|onion|potato|tomato|lettuce|spinach|broccoli|pepper/.test(n)) return 'veg';
  if (/pasta|rice|noodle|couscous/.test(n)) return 'dry-goods';
  if (/coffee|tea|juice|water|drink|beer|wine|cider/.test(n)) return 'drinks';
  if (/crisp|chocolate|biscuit|sweet|snack|cake/.test(n)) return 'snacks';
  return 'other';
}

async function getTopDeals(limit = 5): Promise<Deal[]> {
  const { data: deals, error } = await supabaseAdmin
    .from('price_observations')
    .select(`
      price,
      was_price,
      store_product_id,
      store_products!inner(
        store,
        store_product_name,
        products!inner(canonical_name, category)
      )
    `)
    .eq('on_promotion', true)
    .not('was_price', 'is', null)
    .not('price', 'is', null)
    .gte('observed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('observed_at', { ascending: false });

  if (error || !deals) {
    if (error) console.error('[weekly-digest] Error fetching deals:', error);
    return [];
  }

  const candidates = deals
    .map(deal => {
      const storeProduct = deal.store_products as unknown as {
        store: string;
        store_product_name: string;
        products: { canonical_name: string; category: string | null } | null;
      } | null;
      const product = storeProduct?.products;
      if (!deal.price || !deal.was_price || !storeProduct || !product) return null;

      const saving = Number(deal.was_price) - Number(deal.price);
      if (saving <= 0) return null;
      const savingPct = saving / Number(deal.was_price);
      if (savingPct < MIN_SAVING_PCT) return null;
      if (Number(deal.was_price) / Number(deal.price) >= MAX_RATIO) return null;

      return {
        product_name: product.canonical_name,
        store: storeProduct.store,
        current_price: Number(deal.price),
        was_price: Number(deal.was_price),
        saving,
        _category: product.category ?? inferCategory(product.canonical_name),
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => b.saving - a.saving);

  const seenProducts = new Set<string>();
  const storeCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const result: Deal[] = [];

  for (const d of candidates) {
    if (result.length >= limit) break;
    if (seenProducts.has(d.product_name)) continue;

    const store = d.store.toLowerCase();
    const category = d._category;
    if ((storeCounts[store] ?? 0) >= MAX_PER_STORE) continue;
    if ((categoryCounts[category] ?? 0) >= MAX_PER_CATEGORY) continue;

    seenProducts.add(d.product_name);
    storeCounts[store] = (storeCounts[store] ?? 0) + 1;
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    result.push({
      product_name: d.product_name,
      store: d.store,
      current_price: d.current_price,
      was_price: d.was_price,
      saving: d.saving,
    });
  }

  return result;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://supermarket.ie';
    const { data: subscribers, error } = await supabaseAdmin
      .from('subscribers')
      .select('id, email, family_size, unsubscribe_token, last_list_planned_at')
      .eq('subscribed', true)
      .limit(100);

    if (error) {
      console.error('[weekly-digest] Failed to fetch subscribers', error);
      return NextResponse.json({ error: 'Failed to fetch subscribers' }, { status: 500 });
    }

    if (!subscribers?.length) {
      return NextResponse.json({ sent: 0, failed: 0, skippedAlreadyPlanned: 0 });
    }

    const topDeals = await getTopDeals(5);
    let sent = 0;
    let failed = 0;
    let skippedAlreadyPlanned = 0;
    let householdBriefings = 0;
    let quietBriefings = 0;
    let newSubscriberDigests = 0;

    for (const subscriber of subscribers) {
      try {
        if (subscriber.last_list_planned_at) {
          const lastPlanned = new Date(subscriber.last_list_planned_at);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (lastPlanned > sevenDaysAgo) {
            skippedAlreadyPlanned++;
            continue;
          }
        }

        const { count: itemCount } = await supabaseAdmin
          .from('list_items')
          .select('*', { count: 'exact', head: true })
          .eq('subscriber_id', subscriber.id);

        const jwtToken = jwt.sign(
          {
            email: subscriber.email,
            subscriberId: subscriber.id,
            familySize: subscriber.family_size || '2',
          },
          SECRET!,
          { expiresIn: '7d' },
        );

        const shopUrl = `${siteUrl}/list?token=${encodeURIComponent(jwtToken)}&source=household-briefing`;
        const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token ?? '')}`;

        let subject: string;
        let html: string;

        if ((itemCount ?? 0) > 0) {
          const briefing = await buildHouseholdBriefing(subscriber.id);
          subject = briefing.quiet
            ? 'Your shop is quiet this week'
            : `${briefing.insights.length} things worth knowing about your shop`;
          html = generateHouseholdBriefingEmail({
            briefing,
            shopUrl,
            agentUrl: shopUrl,
            unsubscribeUrl,
          });
          householdBriefings++;
          if (briefing.quiet) quietBriefings++;
        } else {
          subject = "This week's supermarket picks";
          html = generateTier1Email(topDeals, shopUrl, unsubscribeUrl);
          newSubscriberDigests++;
        }

        const { error: sendError } = await resend.emails.send({
          from: 'supermarket.ie shopping agent <hello@mail.supermarket.ie>',
          to: subscriber.email,
          subject,
          html,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });

        if (sendError) throw new Error(sendError.message);
        sent++;
      } catch (emailError) {
        failed++;
        console.error(`[weekly-digest] Failed for ${subscriber.email}`, emailError);
      }
    }

    console.log('[weekly-digest] Complete', {
      sent,
      failed,
      skippedAlreadyPlanned,
      householdBriefings,
      quietBriefings,
      newSubscriberDigests,
    });

    return NextResponse.json({
      sent,
      failed,
      skippedAlreadyPlanned,
      householdBriefings,
      quietBriefings,
      newSubscriberDigests,
    });
  } catch (error) {
    console.error('[weekly-digest] Unexpected error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
