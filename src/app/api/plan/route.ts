import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 30;

// Build a compact price catalogue from DB to inject as context
async function getPriceCatalogue() {
  const { data } = await supabaseAdmin
    .from('store_products')
    .select('canonical_name, store_name, price, unit_size, price_per_unit')
    .order('canonical_name');

  if (!data?.length) return '';

  // Group by product, show cheapest per store
  const map = new Map<string, { store: string; price: number; unit: string }[]>();
  for (const row of data) {
    const key = row.canonical_name;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ store: row.store_name, price: row.price, unit: row.unit_size ?? '' });
  }

  const lines: string[] = [];
  for (const [name, prices] of map.entries()) {
    const sorted = prices.sort((a, b) => a.price - b.price);
    const cheapest = sorted[0];
    const priceStr = sorted.map(p => `${p.store} €${p.price.toFixed(2)}`).join(', ');
    lines.push(`- ${name} (${cheapest.unit}): ${priceStr}`);
  }

  return lines.join('\n');
}

export async function POST(req: Request) {
  const { meals, householdSize = 2 } = await req.json();

  if (!meals?.trim()) {
    return new Response('Meals required', { status: 400 });
  }

  const catalogue = await getPriceCatalogue();

  const result = streamText({
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

    messages: [
      {
        role: 'user',
        content: `I'm planning meals for ${householdSize} people this week. Here's what I want to cook:\n\n${meals}\n\nBuild me a shopping list.`,
      },
    ],
  });

  return result.toDataStreamResponse({ sendUsage: false });
}
