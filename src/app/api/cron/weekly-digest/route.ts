import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import { queryPriceChanges, queryUserHistory } from '@/lib/planner-agent';
import {
  generateTier1Email,
  generateTier2Email,
  generateTier3Email,
  type Deal,
  type PriceChange,
} from '@/lib/weekly-email-templates';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SECRET = process.env.MAGIC_LINK_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');
if (!CRON_SECRET) throw new Error('CRON_SECRET environment variable is required');

const anthropic = new Anthropic(); // uses ANTHROPIC_API_KEY env

// ---------------------------------------------------------------------------
// Top deals query (kept from original)
// ---------------------------------------------------------------------------

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

  return deals
    .map(deal => {
      const storeProduct = deal.store_products as unknown as { store: string; store_product_name: string; products: { canonical_name: string; category: string | null } | null } | null;
      const product = storeProduct?.products;
      if (!deal.price || !deal.was_price || !storeProduct || !product) return null;
      const saving = deal.was_price - deal.price;
      if (saving <= 0) return null;
      return {
        product_name: product.canonical_name,
        store: storeProduct.store,
        current_price: deal.price,
        was_price: deal.was_price,
        saving,
      };
    })
    .filter((d): d is Deal => d !== null)
    .sort((a, b) => b.saving - a.saving)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Tier 3 AI content generation
// ---------------------------------------------------------------------------

async function generateAiContent(
  profile: Record<string, unknown>,
  userHistory: unknown[],
  priceChanges: unknown[],
  topDeals: Deal[],
): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are a personal grocery agent for a household in Ireland. Write a SHORT, friendly weekly email (3-4 paragraphs max) highlighting this week's relevant deals and savings for this household:

Household: ${JSON.stringify(profile)}
Their usual items: ${JSON.stringify(userHistory.slice(0, 15))}
Price changes on their items: ${JSON.stringify(priceChanges)}
Top deals this week: ${JSON.stringify(topDeals)}

Write conversationally as "your grocery agent". Mention specific items and savings. End with a prompt to build their list this week. Do NOT include subject lines or sign-offs.`,
    }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock && textBlock.type === 'text' ? textBlock.text : '';
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

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? '';

    // Fetch all active subscribers
    const { data: subscribers, error: subscribersError } = await supabaseAdmin
      .from('subscribers')
      .select('id, email, family_size, unsubscribe_token')
      .eq('subscribed', true)
      .limit(50); // max 50 per batch

    if (subscribersError) {
      console.error('[weekly-digest] Error fetching subscribers:', subscribersError);
      return NextResponse.json({ error: 'Failed to fetch subscribers' }, { status: 500 });
    }

    if (!subscribers || subscribers.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, message: 'No subscribers found' });
    }

    // Fetch top deals once — reused for all tiers
    const topDeals = await getTopDeals(5);

    let sent = 0;
    let failed = 0;
    const tiers = { t1: 0, t2: 0, t3: 0 };

    for (const subscriber of subscribers) {
      try {
        // --- Determine tier ---
        const [{ data: household }, { count: itemCount }] = await Promise.all([
          supabaseAdmin
            .from('households')
            .select('adults, children, dietary, weekly_budget, preferred_stores, extra_context')
            .eq('subscriber_id', subscriber.id)
            .single(),
          supabaseAdmin
            .from('list_items')
            .select('*', { count: 'exact', head: true })
            .eq('subscriber_id', subscriber.id),
        ]);

        const tier = household ? 3 : (itemCount && itemCount > 0) ? 2 : 1;

        // --- Generate magic link (7-day JWT) ---
        const jwtToken = jwt.sign(
          {
            email: subscriber.email,
            subscriberId: subscriber.id,
            familySize: subscriber.family_size || '2',
          },
          SECRET!,
          { expiresIn: '7d' },
        );

        const magicLink = `${siteUrl}/list?token=${jwtToken}`;
        const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${subscriber.unsubscribe_token}`;

        // --- Same-again link (Tier 2+) ---
        let sameAgainLink = `${siteUrl}/dashboard?source=weekly-email`;
        if (tier >= 2) {
          const { data: lastList } = await supabaseAdmin
            .from('saved_lists')
            .select('id')
            .eq('subscriber_id', subscriber.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (lastList) {
            sameAgainLink = `${siteUrl}/list?token=${jwtToken}&intent=same-again&list_id=${lastList.id}&source=weekly-email`;
          }
        }

        // --- Generate email per tier ---
        let subject: string;
        let html: string;

        if (tier === 3) {
          // Tier 3: AI-personalised
          const [userHistory, priceChanges] = await Promise.all([
            queryUserHistory(subscriber.id),
            queryPriceChanges(subscriber.id) as Promise<PriceChange[]>,
          ]);
          const aiContent = await generateAiContent(
            household as Record<string, unknown>,
            userHistory,
            priceChanges,
            topDeals,
          );
          subject = 'Your weekly grocery update from your agent';
          html = generateTier3Email(aiContent, magicLink, unsubscribeUrl);
          tiers.t3++;

        } else if (tier === 2) {
          // Tier 2: price changes on their items + deals
          const priceChanges = (await queryPriceChanges(subscriber.id)) as PriceChange[];
          subject = 'Your agent found savings on your items';
          html = generateTier2Email(priceChanges, topDeals, sameAgainLink, magicLink, unsubscribeUrl);
          tiers.t2++;

        } else {
          // Tier 1: generic deals
          subject = "This week's best grocery deals";
          html = generateTier1Email(topDeals, magicLink, unsubscribeUrl);
          tiers.t1++;
        }

        // --- Send ---
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

        sent++;
        console.log(`[weekly-digest] [tier${tier}] Sent to: ${subscriber.email}`);

        // 200ms delay between sends
        if (sent + failed < subscribers.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }

      } catch (emailError) {
        console.error(`[weekly-digest] Failed for ${subscriber.email}:`, emailError);
        failed++;
      }
    }

    console.log(`[weekly-digest] Done: ${sent} sent, ${failed} failed | tiers: t1=${tiers.t1} t2=${tiers.t2} t3=${tiers.t3}`);
    return NextResponse.json({ sent, failed, tiers });

  } catch (error) {
    console.error('[weekly-digest] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
