import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';
import jwt from 'jsonwebtoken';

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StoreProduct = {
  store: string;
  store_product_name: string;
  products: { canonical_name: string; category: string } | null;
} | null;

type RawObs = {
  price: number;
  was_price: number | null;
  on_promotion: boolean | null;
  store_products: StoreProduct;
};

type PriceRow = {
  canonical_name: string;
  category: string;
  store: string;
  store_product_name: string;
  price: number;
  was_price: number | null;
  on_promotion: boolean;
};

// ---------------------------------------------------------------------------
// Dedup helper
// ---------------------------------------------------------------------------

function dedup(rows: RawObs[]): PriceRow[] {
  const seen = new Set<string>();
  const out: PriceRow[] = [];
  for (const r of rows) {
    const sp = r.store_products;
    const canonical = sp?.products?.canonical_name;
    const store = sp?.store;
    if (!canonical || !store || r.price == null) continue;
    const key = `${canonical}::${store}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({
        canonical_name: canonical,
        category: sp!.products!.category,
        store,
        store_product_name: sp!.store_product_name,
        price: r.price,
        was_price: r.was_price ?? null,
        on_promotion: r.on_promotion ?? false,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const SELECT =
  'price, was_price, on_promotion, observed_at, store_products(store, store_product_name, products(canonical_name, category))';

async function queryCategories(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('products')
    .select('category')
    .order('category');
  const rows = (data ?? []) as { category: string }[];
  return [...new Set(rows.map(r => r.category))];
}

async function queryPromotions(): Promise<PriceRow[]> {
  const { data } = await supabaseAdmin
    .from('price_observations')
    .select(SELECT)
    .eq('on_promotion', true)
    .order('observed_at', { ascending: false })
    .limit(500);
  return dedup((data ?? []) as unknown as RawObs[]);
}

async function queryCategoryPrices(category: string): Promise<PriceRow[]> {
  const { data } = await supabaseAdmin
    .from('price_observations')
    .select(SELECT)
    .order('observed_at', { ascending: false })
    .limit(2000);
  const rows = (data ?? []) as unknown as RawObs[];
  return dedup(rows.filter(r => r.store_products?.products?.category === category));
}

async function queryProduct(canonicalName: string): Promise<PriceRow[]> {
  const { data } = await supabaseAdmin
    .from('price_observations')
    .select(SELECT)
    .order('observed_at', { ascending: false })
    .limit(500);
  const rows = (data ?? []) as unknown as RawObs[];
  return dedup(
    rows.filter(r => r.store_products?.products?.canonical_name === canonicalName),
  );
}

async function queryUserHistory(subscriberId: string) {
  const { data } = await supabaseAdmin
    .from('list_items')
    .select('canonical_name, category, store, price_paid, quantity, observed_at')
    .eq('subscriber_id', subscriberId)
    .order('observed_at', { ascending: false })
    .limit(200);
  const map = new Map<string, { store: string; price_paid: number; quantity: number; times_bought: number; last_bought: string }>();
  for (const r of (data ?? []) as any[]) {
    if (!map.has(r.canonical_name)) {
      map.set(r.canonical_name, { store: r.store, price_paid: r.price_paid, quantity: r.quantity, times_bought: 1, last_bought: r.observed_at });
    } else {
      map.get(r.canonical_name)!.times_bought++;
    }
  }
  return [...map.entries()].map(([canonical_name, v]) => ({ canonical_name, ...v }));
}

async function queryPriceChanges(subscriberId: string) {
  const history = await queryUserHistory(subscriberId);
  if (!history.length) return [];
  const results = [];
  for (const item of history.slice(0, 30)) {
    const current = await queryProduct(item.canonical_name);
    const bestNow = (current as any[]).reduce((best: any, r: any) => !best || r.price < best.price ? r : best, null);
    if (!bestNow) continue;
    const diff = Number((bestNow.price - item.price_paid).toFixed(2));
    if (Math.abs(diff) >= 0.05) {
      results.push({
        canonical_name: item.canonical_name,
        last_store: item.store,
        last_price: item.price_paid,
        best_store_now: bestNow.store,
        best_price_now: bestNow.price,
        change: diff,
        direction: diff < 0 ? 'cheaper' : 'dearer'
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function makeTools(subscriberId: string | null) {
  return {
    get_categories: tool({
      description: 'Returns all product categories. Call first to discover valid category names.',
      parameters: z.object({}),
      execute: async () => queryCategories(),
    }),
    get_prices_by_category: tool({
      description: 'Returns all products in a category with current prices and promotions per store.',
      parameters: z.object({
        category: z.string().describe('Exact category name from get_categories'),
      }),
      execute: async ({ category }: { category: string }) => queryCategoryPrices(category),
    }),
    get_promotions: tool({
      description: "Returns all products currently on promotion across all stores with current and was_price.",
      parameters: z.object({}),
      execute: async () => queryPromotions(),
    }),
    get_product: tool({
      description: 'Returns current price for a single product across all stores.',
      parameters: z.object({
        canonical_name: z.string().describe('Exact canonical_name from catalogue'),
      }),
      execute: async ({ canonical_name }: { canonical_name: string }) => queryProduct(canonical_name),
    }),
    get_user_history: tool({
      description: "Returns returning user's shopping history — products bought, stores, prices, frequency.",
      parameters: z.object({}),
      execute: async () => subscriberId ? queryUserHistory(subscriberId) : [],
    }),
    get_price_changes: tool({
      description: "Compares prices the user paid last time vs current best prices.",
      parameters: z.object({}),
      execute: async () => subscriberId ? queryPriceChanges(subscriberId) : [],
    }),
  };
}

// ---------------------------------------------------------------------------
// Profile-based system prompt builder
// ---------------------------------------------------------------------------

interface PlannerProfile {
  adults: number;
  children: number;
  childAges?: ('toddler' | 'young' | 'older' | 'teen')[];
  weeklyBudget?: number;
  preferredStores: string[];
  dietary: string[];
  dislikes?: string;
  meals: {
    breakfast: boolean;
    lunch: boolean;
    dinner: boolean;
    snacks: boolean;
  };
  batchCooking: boolean;
  skipDays?: string;
  extraContext?: string;
}

function buildProfilePrompt(profile: PlannerProfile): string {
  const totalPeople = profile.adults + profile.children;

  // Build household description
  let household = `${profile.adults} adult${profile.adults !== 1 ? 's' : ''}`;
  if (profile.children > 0) {
    household += ` and ${profile.children} child${profile.children !== 1 ? 'ren' : ''}`;
    if (profile.childAges?.length) {
      const ageLabels: Record<string, string> = {
        toddler: 'toddler (1-3)',
        young: 'young child (4-8)',
        older: 'older child (9-12)',
        teen: 'teenager (13-17)',
      };
      household += ` (${profile.childAges.map(a => ageLabels[a] || a).join(', ')})`;
    }
  }

  // Build meal coverage
  const meals: string[] = [];
  if (profile.meals.breakfast) meals.push('breakfast');
  if (profile.meals.lunch) meals.push('lunch / packed lunches');
  if (profile.meals.dinner) meals.push('dinner');
  if (profile.meals.snacks) meals.push('snacks');
  const mealCoverage = meals.length > 0 ? meals.join(', ') : 'dinner only';

  // Build store preference
  const storesPref = profile.preferredStores.includes('all')
    ? 'all stores (Tesco, Dunnes, SuperValu, Aldi)'
    : profile.preferredStores.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(', ') + ' only';

  return `You are an AI grocery planning assistant for supermarket.ie — Ireland's smartest grocery platform.

## This Household
- **People:** ${household} (${totalPeople} total)
- **Meals to plan:** ${mealCoverage} for the full week
- **Budget:** ${profile.weeklyBudget ? `€${profile.weeklyBudget}/week — STAY UNDER THIS. Actively trade down: own-brand over branded, seasonal veg over imports, cheaper cuts of meat. Show budget status at the end.` : 'No budget set'}
- **Store preference:** ${storesPref}
${profile.dietary.length > 0 ? `- **Dietary requirements:** ${profile.dietary.join(', ')} — STRICT. Do not include any products that violate these requirements.` : '- **Dietary requirements:** None'}
${profile.dislikes ? `- **Dislikes / avoid:** ${profile.dislikes} — Do NOT include these items or ingredients.` : ''}
- **Batch cooking:** ${profile.batchCooking ? 'Yes — suggest cook-once-eat-twice meals where practical (e.g. big chilli Sunday → lunches Mon-Tue)' : 'No'}
${profile.skipDays ? `- **Eating out / skip:** ${profile.skipDays} — do not plan food for these meals` : ''}
${profile.extraContext ? `- **Extra context:** ${profile.extraContext}` : ''}

## Your Job
Produce a COMPLETE weekly grocery list for this household. You are a **grocery planner**, not just a meal planner.

### What to include:
- **Meal ingredients** for all requested meals (${mealCoverage}), scaled for ${totalPeople} people
- **Staples** they'll need through the week: bread, milk, butter, eggs — unless they said they already have them
${profile.meals.snacks ? '- **Snacks**: fruit, yoghurts, biscuits, crisps — age-appropriate for the household' : ''}
${profile.meals.lunch ? `- **Lunch/packed lunch items**: sandwich bread, deli meats/cheese, fruit, yoghurt${profile.childAges?.some(a => ['toddler', 'young'].includes(a)) ? ', juice boxes, snack bars for kids' : ''}` : ''}
${profile.childAges?.some(a => a === 'toddler') ? '- **Toddler-specific**: suitable finger foods, pouches, milk — age-appropriate portions' : ''}
${profile.childAges?.some(a => a === 'teen') ? '- **Teen portions**: larger quantities for growing teenagers' : ''}
- **Household essentials**: toilet roll, kitchen roll, washing up liquid, bin bags — everyone needs these. Include 3-5 basics unless they say they're stocked up.
- **Personal care basics**: toothpaste, hand soap, shower gel — include 2-3 items that are likely running low.
${profile.childAges?.some(a => a === 'toddler') ? '- **Baby supplies**: nappies, baby wipes — essential for toddler households' : ''}

### What NOT to include:
- Recipes or cooking instructions (unless asked)
- Items they said they already have
- Products that violate dietary requirements
- Items they said to avoid (dislikes)
${profile.weeklyBudget ? `- Anything that pushes the total over €${profile.weeklyBudget} — find cheaper alternatives instead` : ''}
${!profile.preferredStores.includes('all') ? `- Products from stores they didn't select (${storesPref})` : ''}

### Quantity rules:
- Scale ALL quantities for ${totalPeople} people
- ${profile.children > 0 ? 'Children eat roughly half adult portions (toddlers less, teens nearly full)' : ''}
- Be practical: if a recipe needs 500g mince and we sell 500g packs, list one pack
- Don't over-buy perishables — a week's worth, not a month's

## Tools — ALWAYS use before writing output
1. get_promotions — call FIRST. Build the list around this week's deals.
2. get_categories — call to discover valid category names.
3. get_prices_by_category(category) — call for each category you need.
4. get_product(canonical_name) — for specific product lookups.
5. get_user_history — call for signed-in users to personalise.
6. get_price_changes — call for returning users to highlight savings.

Rules:
- Gather ALL data via tools before writing any output.
- Only use products from the catalogue. Do not invent products.
- Match ingredients to the closest catalogue product. Skip silently if no match.
- Pick cheapest store per product unless a promotion elsewhere is better value.
${!profile.preferredStores.includes('all') ? `- ONLY show prices from: ${storesPref}. Ignore other stores entirely.` : ''}
- Never mention tool calls to the user.

## Returning user personalisation
If get_user_history returns data:
- Mention 1-2 items they buy regularly ("Added your usual Brennans bread")
- Call get_price_changes and highlight items now cheaper
- Prefer their usual stores unless better deals elsewhere
If empty, treat as new user.

## Output format

### 🛒 Your weekly grocery list
_For ${household} · ${mealCoverage}_

**[Category]**
- [Product name] — [Store] €[price] ${profile.weeklyBudget ? '' : ''}
- ...

**[Next category]**
- ...

---
**Store totals**
- Tesco: €X.XX ([N] items)
- Dunnes: €X.XX ([N] items)
- SuperValu: €X.XX ([N] items)
- Aldi: €X.XX ([N] items)

${profile.weeklyBudget ? `**Budget:** €X.XX of €${profile.weeklyBudget} (€X.XX ${profile.weeklyBudget ? 'under' : 'over'} budget)\n` : ''}
💡 **Best value split:** [1-2 sentence recommendation]`;
}

// ---------------------------------------------------------------------------
// Legacy system prompt (for backward compat with messages-based requests)
// ---------------------------------------------------------------------------

function buildLegacyPrompt(householdSize: number, cachedPromotions: any[] | null): string {
  let prompt = `You are an AI grocery assistant for supermarket.ie — Ireland's smartest grocery planning platform.

Your job: take a description of what the user wants to cook or eat this week and return a complete, priced shopping list using products from our catalogue.

## Rules
- **Never ask follow-up questions.** Make sensible assumptions and produce the list immediately.
- If the user mentions dietary needs, apply them.
- If the request is vague, pick 5–7 suitable meals yourself.
- Only use products from the catalogue (fetched via tools). Do not invent products.
- Map ingredients to the closest matching catalogue product.
- Group items by category.
- For each item show: product name, recommended store, price.
- Show total per store and a "Best split" recommendation.
- Adjust quantities for household size of ${householdSize} people.
- Keep it concise. Use € prices. This is Ireland.
- Skip missing ingredients silently.

## Tools
`;

  if (cachedPromotions?.length) {
    prompt += `Pre-loaded promotions available. Use get_promotions only if you need fresher data.\n`;
  } else {
    prompt += `1. get_promotions — ALWAYS call first.\n`;
  }
  prompt += `2. get_categories — discover category names.
3. get_prices_by_category(category) — prices per category.
4. get_product(canonical_name) — single product lookup.
5. get_user_history — returning user history.
6. get_price_changes — price changes since last shop.

Gather ALL data via tools before writing. Never mention tool calls.

## Output format
### 🛒 Your shopping list for [meals summary]

**[Category]**
- [Product name] — [Store] €[price]

---
**Store totals**
- Tesco: €X.XX ([N] items)
- Dunnes: €X.XX ([N] items)
- SuperValu: €X.XX ([N] items)
- Aldi: €X.XX ([N] items)

💡 **Best value split:** [recommendation]`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const SECRET = process.env.MAGIC_LINK_SECRET;

export async function POST(req: Request) {
  const body = await req.json();

  // Auth
  let subscriberId: string | null = null;
  const token = body.token as string | undefined;
  if (token && SECRET) {
    try {
      const payload = jwt.verify(token, SECRET!) as { subscriberId: string };
      subscriberId = payload.subscriberId;
    } catch {}
  }

  // ── Conversation-based flow (multi-turn chat from dashboard) ──
  const conversationId = body.conversationId as string | undefined;
  if (conversationId && subscriberId) {
    // Load conversation from DB
    const { data: convo, error: convoErr } = await supabaseAdmin
      .from('conversations')
      .select('messages, profile')
      .eq('id', conversationId)
      .eq('subscriber_id', subscriberId)
      .single();

    if (convoErr || !convo) {
      return new Response(JSON.stringify({ error: 'Conversation not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const storedMessages = (convo.messages ?? []) as Array<{ role: string; content: string; timestamp?: string }>;
    const convoProfile = convo.profile as PlannerProfile | null;
    const newUserMessage = body.message as string;

    if (!newUserMessage?.trim()) {
      return new Response(JSON.stringify({ error: 'Message required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build system prompt from stored profile or fallback
    const systemPrompt = convoProfile
      ? buildProfilePrompt(convoProfile)
      : buildLegacyPrompt(body.householdSize ?? 2, null);

    // Build messages array: existing conversation + new user message
    const apiMessages = storedMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
    apiMessages.push({ role: 'user' as const, content: newUserMessage });

    try {
      const result = await streamText({
        model: anthropic('claude-haiku-4-5-20251001'),
        system: systemPrompt + '\n\nThe user is modifying an existing grocery list from a previous conversation. Help them make changes — swap items, add/remove products, adjust quantities, etc. Use the same output format. Always show the full updated list.',
        messages: apiMessages,
        tools: makeTools(subscriberId),
        maxSteps: 10,
      });
      return result.toDataStreamResponse({ sendUsage: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[/api/plan] conversation streamText error:', msg);
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── Profile-based flow (new grocery planner v2) ──
  const profile = body.profile as PlannerProfile | undefined;
  if (profile) {
    const systemPrompt = buildProfilePrompt(profile);
    const totalPeople = profile.adults + profile.children;

    // Build a natural-language user message from the profile
    const meals: string[] = [];
    if (profile.meals.breakfast) meals.push('breakfasts');
    if (profile.meals.lunch) meals.push('lunches / packed lunches');
    if (profile.meals.dinner) meals.push('dinners');
    if (profile.meals.snacks) meals.push('snacks');

    let userMsg = `Plan a full week of groceries for my household of ${totalPeople}. I need: ${meals.join(', ')}.`;
    if (profile.batchCooking) userMsg += ' I like batch cooking.';
    if (profile.skipDays) userMsg += ` We're eating out: ${profile.skipDays}.`;
    if (profile.extraContext) userMsg += ` Also: ${profile.extraContext}`;
    userMsg += '\n\nBuild me a complete grocery list with the best prices.';

    try {
      const result = await streamText({
        model: anthropic('claude-haiku-4-5-20251001'),
        system: systemPrompt,
        messages: [{ role: 'user' as const, content: userMsg }],
        tools: makeTools(subscriberId),
        maxSteps: 10,
      });
      return result.toDataStreamResponse({ sendUsage: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[/api/plan] streamText error:', msg);
      return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // ── Legacy messages-based flow ──
  const householdSize: number = body.householdSize ?? 2;
  const cachedPromotions = body.cachedPromotions;

  let userMessage: string;
  if (body.meals?.trim()) {
    userMessage = body.meals.trim();
  } else if (Array.isArray(body.messages) && body.messages.length > 0) {
    const last = [...body.messages].reverse().find((m: { role: string; content: string }) => m.role === 'user');
    userMessage = last?.content?.trim() ?? '';
  } else {
    userMessage = '';
  }

  if (!userMessage) {
    return new Response('Meals required', { status: 400 });
  }

  try {
    const systemPrompt = buildLegacyPrompt(householdSize, cachedPromotions);

    const result = await streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: systemPrompt,
      messages: Array.isArray(body.messages) && body.messages.length > 0
        ? body.messages.map((m: { role: string; content: string }) => ({
            role: m.role as 'user' | 'assistant',
            content: m.role === 'user' && m === body.messages[0]
              ? `I'm planning meals for ${householdSize} people this week. Here's what I want to cook:\n\n${m.content}\n\nBuild me a shopping list.`
              : m.content,
          }))
        : [{ role: 'user' as const, content: `I'm planning meals for ${householdSize} people this week. Here's what I want to cook:\n\n${userMessage}\n\nBuild me a shopping list.` }],
      tools: makeTools(subscriberId),
      maxSteps: 10,
    });

    return result.toDataStreamResponse({ sendUsage: false });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[/api/plan] streamText error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
