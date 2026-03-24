import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';
import jwt from 'jsonwebtoken';

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Types for Supabase nested-select results
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
// Dedup helper — rows must arrive ordered observed_at DESC so first hit
// per (canonical_name, store) pair is the most-recent observation.
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
// Tool factory — creates tools with request-scoped subscriberId
// ---------------------------------------------------------------------------

function makeTools(subscriberId: string | null) {
  return {
    get_categories: tool({
      description:
        'Returns the list of all product categories available in the catalogue. Call this first to know what categories exist before calling get_prices_by_category.',
      parameters: z.object({}),
      execute: async () => queryCategories(),
    }),

    get_prices_by_category: tool({
      description:
        'Returns all products in a given category with their current price at each store, and whether each is currently on promotion (includes was_price). Use the exact category string returned by get_categories.',
      parameters: z.object({
        category: z
          .string()
          .describe('Exact category name, e.g. "Dairy", "Meat", "Vegetables"'),
      }),
      execute: async ({ category }: { category: string }) => queryCategoryPrices(category),
    }),

    get_promotions: tool({
      description:
        "Returns every product currently on promotion across all stores, with current price and was_price. Always call this before building the list — anchor the shop around this week's deals.",
      parameters: z.object({}),
      execute: async () => queryPromotions(),
    }),

    get_product: tool({
      description:
        'Returns the current price for a single product (by canonical_name) across all stores. Use this to drill into a specific product when you need its exact price to complete the list.',
      parameters: z.object({
        canonical_name: z
          .string()
          .describe('The canonical_name value exactly as it appears in catalogue data'),
      }),
      execute: async ({ canonical_name }: { canonical_name: string }) => queryProduct(canonical_name),
    }),

    get_user_history: tool({
      description: "Returns this user's shopping history — products they've bought before, which store, price paid, and how often. Use this to personalise the list. Only available for signed-in users.",
      parameters: z.object({}),
      execute: async () => subscriberId ? queryUserHistory(subscriberId) : [],
    }),

    get_price_changes: tool({
      description: "Compares prices the user paid last time vs current best prices. Returns items now cheaper or dearer. Call this for returning users.",
      parameters: z.object({}),
      execute: async () => subscriberId ? queryPriceChanges(subscriberId) : [],
    }),
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const SECRET = process.env.MAGIC_LINK_SECRET;

export async function POST(req: Request) {
  const body = await req.json();
  const householdSize: number = body.householdSize ?? 2;

  let subscriberId: string | null = null;
  const token = body.token as string | undefined;
  if (token && SECRET) {
    try {
      const payload = jwt.verify(token, SECRET!) as { subscriberId: string };
      subscriberId = payload.subscriberId;
    } catch { /* invalid/expired — anonymous */ }
  }

  // useChat sends { messages: [{role, content}...] }
  // We also support direct { meals: string } for testing
  let userMessage: string;
  if (body.meals?.trim()) {
    userMessage = body.meals.trim();
  } else if (Array.isArray(body.messages) && body.messages.length > 0) {
    // Get the last user message
    const last = [...body.messages]
      .reverse()
      .find((m: { role: string; content: string }) => m.role === 'user');
    userMessage = last?.content?.trim() ?? '';
  } else {
    userMessage = '';
  }

  if (!userMessage) {
    return new Response('Meals required', { status: 400 });
  }

  const result = await streamText({
    model: anthropic('claude-haiku-4-5'),
    system: `You are an AI grocery assistant for supermarket.ie — Ireland's smartest grocery planning platform.

Your job: take a description of what the user wants to cook or eat this week and return a complete, priced shopping list using products from our catalogue.

## Rules
- **Never ask follow-up questions.** Make sensible assumptions based on what the user said and produce the list immediately.
- If the user mentions dietary needs (vegetarian, gluten-free, etc.), apply them to the relevant household members and choose appropriate products.
- If the user gives a vague request (e.g. "healthy week", "family dinners"), pick 5–7 suitable meals yourself and list them.
- Only use products from the catalogue (fetched via tools). Do not invent products.
- Map ingredients to the closest matching catalogue product.
- Group items by category (Bakery, Dairy, Meat & Fish, Fruit & Veg, Tins & Jars, etc.)
- For each item show: product name, recommended store (cheapest or best promotion), price
- At the end show a total per store and a "Best split" recommendation (e.g. buy meat at Dunnes, everything else at Tesco)
- Adjust quantities for household size of ${householdSize} people
- Be practical — if a recipe needs 500g mince and we sell 500g mince, list one pack
- Keep it concise. No waffle. Just the list.
- Use € prices. This is Ireland.
- If an ingredient isn't in our catalogue, skip it silently (don't mention it)
- If the user asks to update or modify their list, use the full conversation history to understand what was already planned and produce a complete updated list

## Tools — use these to fetch data, do not guess prices
You have six tools. Use them before writing any output.
1. get_promotions — ALWAYS call this first. Build the list around deals where possible.
2. get_categories — call once to discover valid category names.
3. get_prices_by_category(category) — call for each category you need.
4. get_product(canonical_name) — use sparingly for a single product lookup.
5. get_user_history — call for signed-in users to personalise the list.
6. get_price_changes — call for returning users to highlight price changes.

Rules:
- Gather ALL data via tools before writing any output.
- Do not stream partial text between tool calls — output the complete list once you have everything.
- Pick cheapest store per product unless a promotion at another store is better value.
- If get_promotions returns items the family needs, use them and note the saving.
- Never mention tool calls or data fetching to the user.

## Ingredient mapping rules
- Match ingredients to the **closest product in the catalogue** using the category as a guide
- e.g. "mozzarella" → look in Dairy for the closest cheese product
- e.g. "pasta sheets" → look in the same category as other pasta products
- If multiple products could match, pick the most specific one
- If nothing in the catalogue is a reasonable match, skip the ingredient silently

## Returning user personalisation
If get_user_history returns data, this is a returning user:
- Mention 1-2 items they buy regularly ("You usually get X — added that in")
- Call get_price_changes and highlight items now cheaper than last time
- Prefer stores they've used before unless a better deal exists elsewhere
- Weave this naturally into the list — don't over-explain it
If get_user_history returns empty, treat as new user — no mention of history.

## Output format
Use this structure exactly:

### 🛒 Your shopping list for [meals summary]

**[Category]**
- [Product name] — [Cheapest store] €[price]
- ...

**[Next category]**
- ...

---
**Store totals**
- Tesco: €X.XX ([N] items)
- Dunnes: €X.XX ([N] items)
- SuperValu: €X.XX ([N] items)

💡 **Best value split:** [1-2 sentence recommendation on how to split the shop]`,

    messages:
      Array.isArray(body.messages) && body.messages.length > 0
        ? body.messages.map((m: { role: string; content: string }) => ({
            role: m.role as 'user' | 'assistant',
            content:
              m.role === 'user' && m === body.messages[0]
                ? `I'm planning meals for ${householdSize} people this week. Here's what I want to cook:\n\n${m.content}\n\nBuild me a shopping list.`
                : m.content,
          }))
        : [
            {
              role: 'user' as const,
              content: `I'm planning meals for ${householdSize} people this week. Here's what I want to cook:\n\n${userMessage}\n\nBuild me a shopping list.`,
            },
          ],

    tools: makeTools(subscriberId),
    maxSteps: 10,
  });

  return result.toDataStreamResponse({ sendUsage: false });
}
