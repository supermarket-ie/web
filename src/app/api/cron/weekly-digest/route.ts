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

const MIN_SAVING_PCT = 0.15;       // must be at least 15% off
const MAX_RATIO = 1.9;              // exclude likely-manufactured 2× "half price" promos
const MAX_PER_STORE = 2;            // max deals from any single store
const MAX_PER_CATEGORY = 2;         // max deals from any single category

// Rough category inference from canonical product name (keeps us store-agnostic)
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
        products!inner(
          canonical_name,
          category
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

  // 1. Map to Deal objects, filtering out bad data and manufactured promos
  const candidates = deals
    .map(deal => {
      const storeProduct = deal.store_products as unknown as { store: string; store_product_name: string; products: { canonical_name: string; category: string | null } | null } | null;
      const product = storeProduct?.products;
      if (!deal.price || !deal.was_price || !storeProduct || !product) return null;
      const saving = deal.was_price - deal.price;
      if (saving <= 0) return null;

      const savingPct = saving / deal.was_price;

      // Filter: must be at least MIN_SAVING_PCT genuine discount
      if (savingPct < MIN_SAVING_PCT) return null;

      // Filter: exclude likely-manufactured "half price" promos (was = exactly 2× current)
      const ratio = deal.was_price / deal.price;
      if (ratio >= MAX_RATIO) return null;

      return {
        product_name: product.canonical_name,
        store: storeProduct.store,
        current_price: deal.price,
        was_price: deal.was_price,
        saving,
        _savingPct: savingPct,
        _category: product.category ?? inferCategory(product.canonical_name),
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => b.saving - a.saving);

  // 2. Deduplicate by canonical product name — keep highest saving per product
  const seenProducts = new Set<string>();
  const deduped = candidates.filter(d => {
    if (seenProducts.has(d.product_name)) return false;
    seenProducts.add(d.product_name);
    return true;
  });

  // 3. Apply store + category caps for diversity
  const storeCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const result: Deal[] = [];

  for (const d of deduped) {
    if (result.length >= limit) break;
    const store = d.store.toLowerCase();
    const cat = d._category;
    if ((storeCounts[store] ?? 0) >= MAX_PER_STORE) continue;
    if ((categoryCounts[cat] ?? 0) >= MAX_PER_CATEGORY) continue;
    storeCounts[store] = (storeCounts[store] ?? 0) + 1;
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
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

// ---------------------------------------------------------------------------
// Tier 3 AI content generation
// ---------------------------------------------------------------------------

async function generateAiContent(
  household: Record<string, unknown>,
  userHistory: unknown[],
  priceChanges: unknown[],
  topDeals: Deal[],
): Promise<string> {
  // Extract household details for better prompting
  const preferredStores = (household.preferred_stores as string[])?.join(', ') || 'SuperValu, Tesco';
  const dietary = (household.dietary as string[])?.join(', ') || 'none specified';
  const weeklyBudget = household.weekly_budget ? `€${household.weekly_budget}` : 'not specified';
  const meals = household.meals as Record<string, boolean> | undefined;
  const mealPlanning = meals ? Object.entries(meals).filter(([_, included]) => included).map(([meal, _]) => meal).join(', ') : 'breakfast, lunch, dinner, snacks';
  const batchCooking = household.batch_cooking ? 'They do batch cooking' : '';

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `You are a personal grocery agent for a household in Ireland. Write a SHORT, friendly weekly email (3-4 paragraphs max) highlighting this week's relevant deals and savings for this household:

Household details:
- They usually shop at: ${preferredStores}
- Dietary requirements: ${dietary}
- Weekly budget: ${weeklyBudget}
- They plan: ${mealPlanning}
${batchCooking ? `- ${batchCooking}` : ''}

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
      .select('id, email, family_size, unsubscribe_token, last_list_planned_at')
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
    let skippedAlreadyPlanned = 0;
    const tiers = { t1: 0, t2: 0, t3: 0 };

    for (const subscriber of subscribers) {
      try {
        // --- Skip if already planned this week ---
        if (subscriber.last_list_planned_at) {
          const lastPlanned = new Date(subscriber.last_list_planned_at);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (lastPlanned > sevenDaysAgo) {
            skippedAlreadyPlanned++;
            console.log(`[weekly-digest] Skipped ${subscriber.email}: already planned within 7 days (${subscriber.last_list_planned_at})`);
            continue;
          }
        }

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

    console.log(`[weekly-digest] Done: ${sent} sent, ${failed} failed, ${skippedAlreadyPlanned} skipped_already_planned | tiers: t1=${tiers.t1} t2=${tiers.t2} t3=${tiers.t3}`);
    return NextResponse.json({ sent, failed, skippedAlreadyPlanned, tiers });

  } catch (error) {
    console.error('[weekly-digest] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
