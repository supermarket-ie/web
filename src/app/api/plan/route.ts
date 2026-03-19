import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 30;

// Build a compact price catalogue from DB to inject as context
async function getPriceCatalogue() {
  // Get latest price observations joined to product names
  const { data } = await supabaseAdmin
    .from('price_observations')
    .select('price, store, store_products(store_product_name, unit_size, products(canonical_name, category))')
    .order('observed_at', { ascending: false })
    .limit(2000);

  if (!data?.length) {
    // Fallback: use hardcoded product names with no prices — at least Claude knows what we carry
    return FALLBACK_CATALOGUE;
  }

  // Group by canonical_name → store → lowest price
  const map = new Map<string, Map<string, { price: number; unit: string }>>();

  for (const row of data) {
    const sp = row.store_products as unknown as { store_product_name: string; unit_size: string | null; products: { canonical_name: string; category: string | null } | null } | null;
    const canonical = sp?.products?.canonical_name;
    if (!canonical || !row.store || !row.price) continue;

    if (!map.has(canonical)) map.set(canonical, new Map());
    const storeMap = map.get(canonical)!;
    const existing = storeMap.get(row.store);
    if (!existing || row.price < existing.price) {
      storeMap.set(row.store, { price: row.price, unit: sp?.unit_size ?? '' });
    }
  }

  if (map.size === 0) return FALLBACK_CATALOGUE;

  const lines: string[] = [];
  for (const [name, stores] of map.entries()) {
    const sorted = [...stores.entries()].sort((a, b) => a[1].price - b[1].price);
    const unit = sorted[0]?.[1].unit;
    const priceStr = sorted.map(([store, s]) => `${store} €${s.price.toFixed(2)}`).join(', ');
    lines.push(`- ${name}${unit ? ` (${unit})` : ''}: ${priceStr}`);
  }

  return lines.join('\n');
}

// Fallback if DB is empty — just product names so Claude can still map ingredients
const FALLBACK_CATALOGUE = `
- Brown Pan Bread Standard (800g): Tesco €1.29, Dunnes €1.35, SuperValu €1.39
- White Pan Bread Standard (800g): Tesco €1.19, Dunnes €1.25, SuperValu €1.29
- Butter Unsalted (227g): Tesco €2.49, Dunnes €2.59
- Cheddar Cheese Block (400g): Tesco €3.49, Dunnes €3.29, SuperValu €3.59
- Whole Milk 2L: Tesco €1.89, Dunnes €1.85, SuperValu €1.95
- Free Range Eggs 6-pack: Tesco €2.19, Dunnes €2.09, SuperValu €2.29
- Chicken Breast Fillets (600g): Tesco €5.49, Dunnes €5.29, SuperValu €5.79
- Lean Beef Mince 500g: Tesco €4.49, Dunnes €4.29, SuperValu €4.69
- Pork Sausages 400g: Tesco €2.99, Dunnes €2.89
- Spaghetti 500g: Tesco €0.99, Dunnes €1.09, SuperValu €1.19
- Penne Pasta 500g: Tesco €0.99, Dunnes €1.09
- Tinned Chopped Tomatoes 400g: Tesco €0.65, Dunnes €0.69, SuperValu €0.75
- Tomato Puree 140g: Tesco €0.79, Dunnes €0.85
- Onions 1kg bag: Tesco €0.99, Dunnes €1.09, SuperValu €1.15
- Garlic Bulb: Tesco €0.49, Dunnes €0.55
- Carrots 1kg: Tesco €0.89, Dunnes €0.95, SuperValu €0.99
- Potatoes 2.5kg: Tesco €2.49, Dunnes €2.39, SuperValu €2.59
- White Rice 1kg: Tesco €1.49, Dunnes €1.59
- Porridge Oats 1kg: Tesco €1.29, Dunnes €1.39, SuperValu €1.49
- Orange Juice 1L: Tesco €1.59, Dunnes €1.69, SuperValu €1.79
`.trim();

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
    const last = [...body.messages].reverse().find((m: { role: string; content: string }) => m.role === 'user');
    userMessage = last?.content?.trim() ?? '';
  } else {
    userMessage = '';
  }

  if (!userMessage) {
    return new Response('Meals required', { status: 400 });
  }

  const catalogue = await getPriceCatalogue();

  const result = await streamText({
    model: anthropic('claude-haiku-4-5'),
    system: `You are an AI grocery assistant for supermarket.ie — Ireland's smartest grocery planning platform.

Your job: take a list of meals the user wants to cook this week and return a complete, priced shopping list using products from our catalogue.

## Rules
- Only use products from the catalogue below. Do not invent products.
- Map ingredients to the closest matching catalogue product.
- Group items by category (Bakery, Dairy, Meat & Fish, Fruit & Veg, Tins & Jars, etc.)
- For each item show: product name, recommended store (cheapest), price
- At the end show a total per store and a "Best split" recommendation (e.g. buy meat at Dunnes, everything else at Tesco)
- Adjust quantities for household size of ${householdSize} people
- Be practical — if a recipe needs 500g mince and we sell 500g mince, list one pack
- Keep it concise. No waffle. Just the list.
- Use € prices. This is Ireland.
- If an ingredient isn't in our catalogue, skip it silently (don't mention it)
- If the user asks to update or modify their list, use the full conversation history to understand what was already planned and produce a complete updated list

## Our product catalogue (name | stores with prices)
${catalogue}

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

    messages: Array.isArray(body.messages) && body.messages.length > 0
      ? body.messages.map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.role === 'user' && m === body.messages[0]
            ? `I'm planning meals for ${householdSize} people this week. Here's what I want to cook:\n\n${m.content}\n\nBuild me a shopping list.`
            : m.content,
        }))
      : [{ role: 'user' as const, content: `I'm planning meals for ${householdSize} people this week. Here's what I want to cook:\n\n${userMessage}\n\nBuild me a shopping list.` }],
  });

  return result.toDataStreamResponse({ sendUsage: false });
}
