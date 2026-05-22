import { ToolLoopAgent, tool, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlannerProfile {
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

export async function queryUserHistory(subscriberId: string) {
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

export async function queryPriceChanges(subscriberId: string) {
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
// Tools factory
// ---------------------------------------------------------------------------

export function makePlannerTools(subscriberId: string | null) {
  return {
    get_categories: tool({
      description: 'Returns all product categories. Call first to discover valid category names.',
      inputSchema: z.object({}),
      execute: async () => queryCategories(),
    }),
    get_prices_by_category: tool({
      description: 'Returns all products in a category with current prices and promotions per store.',
      inputSchema: z.object({
        category: z.string().describe('Exact category name from get_categories'),
      }),
      execute: async ({ category }: { category: string }) => queryCategoryPrices(category),
    }),
    get_promotions: tool({
      description: "Returns all products currently on promotion across all stores with current and was_price.",
      inputSchema: z.object({}),
      execute: async () => queryPromotions(),
    }),
    get_product: tool({
      description: 'Returns current price for a single product across all stores.',
      inputSchema: z.object({
        canonical_name: z.string().describe('Exact canonical_name from catalogue'),
      }),
      execute: async ({ canonical_name }: { canonical_name: string }) => queryProduct(canonical_name),
    }),
    get_user_history: tool({
      description: "Returns returning user's shopping history — products bought, stores, prices, frequency.",
      inputSchema: z.object({}),
      execute: async () => subscriberId ? queryUserHistory(subscriberId) : [],
    }),
    get_price_changes: tool({
      description: "Compares prices the user paid last time vs current best prices.",
      inputSchema: z.object({}),
      execute: async () => subscriberId ? queryPriceChanges(subscriberId) : [],
    }),
    save_household_profile: tool({
      description: 'Persists household preferences for future weeks. Call once you have enough household details (minimum: number of people + any dietary needs). Do this BEFORE generating the list.',
      inputSchema: z.object({
        adults: z.number().int().optional(),
        children: z.number().int().optional(),
        child_ages: z.array(z.string()).optional(),
        weekly_budget: z.number().optional(),
        preferred_stores: z.array(z.string()).optional(),
        dietary: z.array(z.string()).optional(),
        dislikes: z.string().optional(),
        batch_cooking: z.boolean().optional(),
        skip_days: z.string().optional(),
        extra_context: z.string().optional(),
      }),
      execute: async (fields) => {
        if (!subscriberId) return { saved: false, reason: 'User not signed in' };
        await supabaseAdmin.from('households').upsert(
          { subscriber_id: subscriberId, ...fields },
          { onConflict: 'subscriber_id' }
        );
        return { saved: true };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Conversational intake system prompt (NEW — for AI-driven planner)
// ---------------------------------------------------------------------------

export function buildIntakePrompt(opts?: {
  returningUser?: boolean;
  profileSummary?: string;
}): string {
  const returningContext = opts?.returningUser && opts?.profileSummary
    ? `\n\n## Returning User Context\nThis user has shopped before. Their saved profile:\n${opts.profileSummary}\n\nGreet them warmly, mention their household briefly, and offer to plan the same way or update anything. If they say "same again" or similar, go straight to generating.`
    : '';

  return `You are the supermarket.ie grocery planning assistant — Ireland's smartest AI grocery planner.

## Your Role
You have ONE conversation with the user. Your job:
1. Understand what they need (who's eating, any dietary needs, budget)
2. Build them a complete, priced weekly grocery list using real Irish supermarket prices

## Conversation Rules
- **If the user gives enough info in their first message** (e.g. "family of 4, vegetarian, €100 budget, plan my week") → go STRAIGHT to building the list. Do not ask more questions.
- **If info is missing**, ask naturally — MAX 2-3 questions total. Combine related topics.
- **One question per message.** Never ask multiple things at once.
- **Always end questions with button suggestions** using this exact format on its own line:
  [[Option 1|Option 2|Option 3|Option 4]]
- Be brief and friendly. Irish audience. Use emoji sparingly (1-2 per message max).
- Never say "Great question!" or filler. Just be helpful.

## What You Need (minimum to generate):
- Household size (how many people eating)
- What meals to cover (or assume "full week" if they don't specify)

## Nice to Have (ask if not volunteered, combine into one question):
- Dietary needs / things to avoid
- Weekly budget
- Store preference

## Button Format
End messages with button suggestions on their own line:
[[Just me|2 adults|Family|Let me type it]]

The frontend renders these as tappable buttons. The user can also type freely instead.

## Dietary Requirements — CRITICAL
If the user states ANY dietary requirement (vegetarian, vegan, gluten-free, halal, dairy-free, etc.):
- This is a STRICT, ABSOLUTE constraint. Treat it like an allergy.
- NEVER include products that violate it. No exceptions.
- Vegetarian = NO meat, poultry, fish, or seafood (including tuna, salmon, prawns, chicken stock, etc.)
- Vegan = NO animal products whatsoever (no dairy, eggs, honey, etc.)
- Before finalising your list, review EVERY item and remove anything that violates stated dietary requirements.

## When You Have Enough Info — Generate the List
0. Call save_household_profile with the details you've collected (adults, children, dietary, budget, etc.). Do this BEFORE generating the list. Do not mention saving to the user.
1. Call get_promotions FIRST — build around this week's deals
2. Call get_categories to discover valid categories
3. Call get_prices_by_category for each relevant category
4. Use get_product for specific lookups if needed
5. For returning users: call get_user_history and get_price_changes
6. **FINAL CHECK: Re-read the user's dietary requirements and verify EVERY item complies. Remove any that don't.**

Rules:
- Only use products from the catalogue. Do not invent products.
- Pick cheapest store per product unless a promotion elsewhere is better.
- Scale quantities for the household size.
- Include staples (bread, milk, butter, eggs), household essentials, and personal care basics.
- Never mention tool calls to the user.
- Gather ALL data via tools before writing any output.

## Output Format (when generating the list)

### 🛒 Your weekly grocery list
_For [household description] · [meals covered]_

**[Category]**
- [Product name] — [Store] €[price]
- ...

**[Next category]**
- ...

---
**Store totals**
- Tesco: €X.XX ([N] items)
- Dunnes: €X.XX ([N] items)
- SuperValu: €X.XX ([N] items)
- Aldi: €X.XX ([N] items)

💡 **Best value split:** [1-2 sentence recommendation]

## Post-List Modifications
After generating, the user may ask to change things. Help them — swap items, add/remove products, adjust quantities. Always show the full updated list.${returningContext}`;
}

// ---------------------------------------------------------------------------
// Profile-based system prompt builder
// ---------------------------------------------------------------------------

export function buildProfilePrompt(profile: PlannerProfile): string {
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
${profile.dietary.length > 0 ? `- **Dietary requirements:** ${profile.dietary.join(', ')} — STRICT ABSOLUTE CONSTRAINT. Vegetarian = NO meat/poultry/fish/seafood (tuna, salmon, chicken, beef, prawns, fish fingers, chicken stock, etc.). Vegan = NO animal products. Do NOT include ANY product that violates these requirements. Double-check every item before including it.` : '- **Dietary requirements:** None'}
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
${profile.dietary.length > 0 ? `- **FINAL CHECK before outputting:** Re-read dietary requirements (${profile.dietary.join(', ')}). Verify EVERY item on your list complies. Remove any that violate.` : ''}

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
// Legacy system prompt (for backward compat)
// ---------------------------------------------------------------------------

export function buildLegacyPrompt(householdSize: number): string {
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
1. get_promotions — ALWAYS call first.
2. get_categories — discover category names.
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
// Agent factory
// ---------------------------------------------------------------------------

export function createPlannerAgent(opts: {
  subscriberId: string | null;
  profile?: PlannerProfile;
  householdSize?: number;
  isModification?: boolean;
  intakeMode?: boolean;
  returningUser?: boolean;
  profileSummary?: string;
}) {
  let instructions: string;

  if (opts.intakeMode) {
    // AI-driven conversation from message 1
    instructions = buildIntakePrompt({
      returningUser: opts.returningUser,
      profileSummary: opts.profileSummary,
    });
  } else if (opts.profile) {
    instructions = buildProfilePrompt(opts.profile);
  } else {
    instructions = buildLegacyPrompt(opts.householdSize ?? 2);
  }

  const modificationSuffix = opts.isModification
    ? '\n\nThe user is modifying an existing grocery list from a previous conversation. Help them make changes — swap items, add/remove products, adjust quantities, etc. Use the same output format. Always show the full updated list.'
    : '';

  return new ToolLoopAgent({
    model: anthropic('claude-haiku-4-5-20251001'),
    instructions: instructions + modificationSuffix,
    tools: makePlannerTools(opts.subscriberId),
    stopWhen: stepCountIs(10),
  });
}
