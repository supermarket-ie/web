import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';

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

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = {
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
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const body = await req.json();
  const householdSize: number = body.householdSize ?? 2;

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
You have four tools. Use them before writing any output.
1. get_promotions — ALWAYS call this first. Build the list around deals where possible.
2. get_categories — call once to discover valid category names.
3. get_prices_by_category(category) — call for each category you need.
4. get_product(canonical_name) — use sparingly for a single product lookup.

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

    tools: TOOLS,
    maxSteps: 10,
  });

  return result.toDataStreamResponse({ sendUsage: false });
}
