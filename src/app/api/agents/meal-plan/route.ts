import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { supabaseAdmin } from '@/lib/supabase';
import { getAllLatestPrices } from '@/lib/price-data';
import { getPairings, toEpicureName } from '@/lib/epicure-client';
import { getSubscriberId } from '@/lib/auth';
import type { MealSlot } from '@/app/api/plan/weekly/route';

export const maxDuration = 60;

// Fetch this week's cheapest products by category + promotions
async function getWeeklyData() {
  try {
    const all = await getAllLatestPrices();

    // Cheapest per canonical name across stores
    const best = new Map<string, typeof all[number]>();
    for (const item of all) {
      const existing = best.get(item.canonical_name);
      if (!existing || item.price < existing.price) best.set(item.canonical_name, item);
    }

    const bestList = [...best.values()];
    const promotions = bestList.filter(p => p.on_promotion);

    // Top 8 cheapest per category
    const byCategory = new Map<string, typeof bestList>();
    for (const item of bestList) {
      if (!byCategory.has(item.category)) byCategory.set(item.category, []);
      byCategory.get(item.category)!.push(item);
    }
    for (const [cat, items] of byCategory) {
      byCategory.set(cat, items.sort((a, b) => a.price - b.price).slice(0, 8));
    }

    const cheapest = [...byCategory.values()].flat();
    return { cheapest, promotions: promotions.slice(0, 30), all: bestList };
  } catch (err) {
    console.error('[meal-plan] getWeeklyData error:', err);
    return { cheapest: [], promotions: [], all: [] };
  }
}

// ── Epicure flavour enrichment ────────────────────────────────────────────────

// Canonical names that map cleanly to Epicure's vocabulary
const PROTEIN_KEYWORDS = ['chicken', 'beef', 'pork', 'lamb', 'mince', 'salmon', 'cod', 'fish', 'turkey', 'bacon'];

function pickHeroProteins(
  cheapest: Array<{ canonical_name: string; category: string; price: number; store: string }>,
  dietary: string[],
  n = 3
): string[] {
  const isVegan = dietary.some(d => ['vegan', 'plant-based'].includes(d.toLowerCase()));
  const isVegetarian = dietary.some(d => ['vegetarian'].includes(d.toLowerCase()));
  if (isVegan || isVegetarian) return []; // skip meat proteins for veg/vegan

  return cheapest
    .filter(p => {
      const name = p.canonical_name.toLowerCase();
      return PROTEIN_KEYWORDS.some(k => name.includes(k)) &&
        !name.includes('sausage') && !name.includes('nugget') &&
        !name.includes('ready') && !name.includes('processed') &&
        !name.includes('pudding') && !name.includes('kabanos');
    })
    .sort((a, b) => a.price - b.price)
    .slice(0, n)
    .map(p => p.canonical_name);
}

interface FlavourCluster {
  protein: string;
  epicureName: string;
  bridges: string[];
  availableInCatalogue: string[];
  rawGraph: string;
}

async function buildFlavourClusters(
  proteins: string[],
  allPrices: Array<{ canonical_name: string }>
): Promise<FlavourCluster[]> {
  const catalogueNames = new Set(allPrices.map(p => toEpicureName(p.canonical_name)));
  const clusters: FlavourCluster[] = [];

  // Try DB lookup first for all proteins in parallel (fast, pre-computed)
  const epicureKeys = proteins.map(p => p.toLowerCase().trim());
  const { data: dbRows } = await supabaseAdmin
    .from('product_pairings')
    .select('canonical_name, epicure_key, bridges, primaries')
    .eq('found', true)
    .in('epicure_key', epicureKeys);

  const dbByKey = new Map((dbRows ?? []).map((r: { epicure_key: string; canonical_name: string; bridges: string[]; primaries: string[] }) => [r.epicure_key, r]));

  await Promise.all(proteins.map(async (protein) => {
    const epicureKey = protein.toLowerCase().trim();
    const dbRow = dbByKey.get(epicureKey);

    let bridges: string[] = [];
    let rawGraph = '';

    if (dbRow) {
      // Use pre-computed bridges from DB — instant, no API call
      bridges = dbRow.bridges;
      rawGraph = `Pre-computed pairings for ${epicureKey}: bridges=[${bridges.join(', ')}]`;
    } else {
      // Fall back to live Epicure API
      try {
        const result = await getPairings([protein]);
        if (!result) return;
        bridges = result.bridges;
        rawGraph = result.rawText;
      } catch (e) {
        console.error(`[meal-plan] Epicure error for ${protein}:`, e);
        return;
      }
    }

    // Find bridge ingredients that we actually stock
    const available = bridges
      .filter(b => {
        return catalogueNames.has(b) || catalogueNames.has(b.replace(/_/g, ' ')) ||
          [...catalogueNames].some(c => c.includes(b) || b.includes(c.split(' ')[0]));
      })
      .slice(0, 6);

    clusters.push({
      protein,
      epicureName: epicureKey,
      bridges,
      availableInCatalogue: available,
      rawGraph,
    });
  }));

  return clusters;
}

function buildFlavourContext(clusters: FlavourCluster[]): string {
  if (clusters.length === 0) return '';

  const lines: string[] = [
    '## Flavour Intelligence (from 4.14M recipe analysis)',
    'Build this week\'s meals around these ingredient clusters — they are recipe-grounded, not random.\n',
  ];

  for (const c of clusters) {
    lines.push(`**${c.protein}** pairs naturally with:`);
    // Pull top pairings from first cluster section
    const clusterMatch = c.rawGraph.match(/CLUSTERS[^:]*:([\s\S]*?)(?:CONNECTIONS|$)/);
    if (clusterMatch) {
      const topPairs = clusterMatch[1]
        .match(/\b([a-z][a-z\s]+?)\s*\([\d.]+\)/g)
        ?.slice(0, 6)
        .map(m => m.replace(/\s*\([\d.]+\)/, '').trim())
        .filter(Boolean) ?? [];
      if (topPairs.length > 0) lines.push(`  Core: ${topPairs.join(', ')}`);
    }
    if (c.bridges.length > 0) {
      lines.push(`  🌉 Bridge ingredients (non-obvious but recipe-proven): ${c.bridges.slice(0, 5).join(', ')}`);
    }
    if (c.availableInCatalogue.length > 0) {
      lines.push(`  ✅ Available in catalogue this week: ${c.availableInCatalogue.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('Use these clusters to design coherent meal plans where ingredients cross multiple dishes.');
  lines.push('A chicken week should use the same garlic, tomatoes, and herbs across multiple dinners — reducing waste.');
  lines.push('Bridge ingredients are your opportunity to suggest something a user wouldn\'t have thought of but will love.\n');

  return lines.join('\n');
}

// POST /api/agents/meal-plan — generate a meal plan
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, config } = body;

  if (!token) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const subscriberId = getSubscriberId(token);
  if (!subscriberId) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // Load household profile
  const { data: household } = await supabaseAdmin
    .from('households')
    .select('*')
    .eq('subscriber_id', subscriberId)
    .single();

  const adults = household?.adults ?? 2;
  const children = household?.children ?? 0;
  const dietary = household?.dietary ?? [];
  const budget = household?.weekly_budget ?? null;
  const dislikes = household?.dislikes ?? '';

  // Agent type config
  const agentType = config?.type ?? 'dinners'; // 'dinners' | 'lunches'
  const days = config?.days ?? 7;
  const preferences = config?.preferences ?? '';

  // Get this week's data
  const { cheapest, promotions, all } = await getWeeklyData();

  // Build Epicure flavour clusters (parallel with price data, non-blocking)
  const heroProteins = pickHeroProteins(cheapest, dietary);
  const flavourClusters = heroProteins.length > 0
    ? await buildFlavourClusters(heroProteins, all)
    : [];
  const flavourContext = buildFlavourContext(flavourClusters);

  const promoSummary = promotions.slice(0, 20).map(p =>
    `${p.canonical_name} — ${p.store} €${p.price.toFixed(2)}${p.was_price ? ` (was €${p.was_price.toFixed(2)})` : ''}`
  ).join('\n');

  const cheapSummary = cheapest.slice(0, 60).map(p =>
    `${p.canonical_name} (${p.category}) — ${p.store} €${p.price.toFixed(2)}`
  ).join('\n');

  const householdDesc = `${adults} adult${adults > 1 ? 's' : ''}${children > 0 ? ` + ${children} child${children > 1 ? 'ren' : ''}` : ''}`;
  const dietaryStr = dietary.length > 0 ? `Dietary: ${dietary.join(', ')}` : 'No dietary restrictions';
  const budgetStr = budget ? `Weekly budget: €${budget}` : '';
  const dislikesStr = dislikes ? `Dislikes/avoids: ${dislikes}` : '';

  const systemPrompt = agentType === 'lunches' ? `You are a lunch planning agent for an Irish household.

## Household
${householdDesc}
${dietaryStr}
${budgetStr}
${dislikesStr}
${preferences ? `Extra preferences: ${preferences}` : ''}

## Task
Generate ${days} weekday lunch ideas. These should be:
- Quick to prepare (max 15 min) or batch-cookable on Sunday
- Affordable — use the cheapest available ingredients from Irish supermarkets
- Practical for packed lunches (work/school friendly)
- Varied across the week

## This Week's Promotions
${promoSummary || 'None available'}

## Cheapest Available Ingredients
${cheapSummary}

${flavourContext}
## Rules
- ONLY use products from the ingredient lists above
- Build meals AROUND what's cheap and on promotion this week
- Use the Flavour Intelligence clusters above to make meals cohesive — share ingredients across days to reduce waste
- Show the estimated cost per lunch
- Include a total ingredients list at the end with store + price
- If dietary restrictions are stated, they are ABSOLUTE — never violate them
- Be practical. Irish audience. No exotic ingredients.
- When you use a bridge ingredient, weave it in naturally — don't cite the model

## Output Format
### 🥪 Your ${days} Lunch Plan

**Monday:** [Meal name]
[Brief description, 1-2 sentences]
Key ingredients: [item] (€X, store), [item] (€X, store)

...repeat for each day...

---
### 📋 Shopping list for lunches
- [Item] — [Store] €X.XX
- ...

**Total: €X.XX**
`
  : `You are a dinner meal planning agent for an Irish household.

## Household
${householdDesc}
${dietaryStr}
${budgetStr}
${dislikesStr}
${preferences ? `Extra preferences: ${preferences}` : ''}

## Task
Generate a ${days}-dinner meal plan for this week. Each dinner should:
- Serve the household (${householdDesc})
- Be built around what's CHEAP and on PROMOTION this week at Irish supermarkets
- Be practical, achievable for home cooks (30-45 min max)
- Vary protein sources and cuisines across the week

## This Week's Promotions
${promoSummary || 'None available'}

## Cheapest Available Ingredients
${cheapSummary}

${flavourContext}
## Rules
- ONLY use products from the ingredient lists above
- Build meals AROUND what's cheap and on promotion this week — this is the key differentiator
- Use the Flavour Intelligence clusters above: design the week so ingredients work across multiple meals (e.g. same garlic + tomatoes used in 3 dishes). This reduces waste and cost.
- Bridge ingredients are your secret weapon — use them to create one surprising but coherent dish per week
- Show the estimated cost per meal
- Include a total ingredients list at the end with store + price
- If dietary restrictions are stated, they are ABSOLUTE — never violate them
- Be practical. Irish audience. Think shepherd's pie, stir fry, pasta bake — not restaurant food.
- Suggest batch-cooking opportunities (e.g. "cook double, leftovers for Tuesday lunch")
- When you use a bridge ingredient, weave it in naturally — don't cite the model

## Output Format
### 🍽️ Your ${days}-Dinner Plan

**Monday:** [Meal name]
[Brief description + why it's good value this week]
Key ingredients: [item] (€X, store), [item] (€X, store)
*Est. cost: €X.XX*

...repeat for each day...

---
### 📋 Shopping list for dinners
- [Item] — [Store] €X.XX
- ...

**Total: €X.XX**
💡 [One tip about batch cooking or smart shopping for this plan]
`;

  const { text } = await generateText({
    model: anthropic('claude-haiku-4-5-20251001'),
    system: systemPrompt,
    prompt: `Generate the ${agentType === 'lunches' ? 'lunch' : 'dinner'} plan for this week. Be specific with real products from the data provided.`,
    maxOutputTokens: 2000,
  });

  // Save to user_agents table (upsert, best-effort)
  try {
    await supabaseAdmin
      .from('user_agents')
      .upsert({
        subscriber_id: subscriberId,
        agent_type: agentType === 'lunches' ? 'lunch_planner' : 'meal_planner',
        config: config ?? {},
        enabled: true,
        last_run: new Date().toISOString(),
        last_output: text,
      }, { onConflict: 'subscriber_id,agent_type' });
  } catch {
    // user_agents table may not exist yet — non-fatal
  }

  // Parse structured meal slots from the generated text
  const parsedSlots = parseMealSlots(text, agentType);

  // Write to weekly_plans (best-effort — table may not exist yet)
  try {
    const weekStart = getCurrentWeekStart();

    // Fetch existing plan to merge
    const { data: existing } = await supabaseAdmin
      .from('weekly_plans')
      .select('meals')
      .eq('subscriber_id', subscriberId)
      .eq('week_start', weekStart)
      .single();

    const existingMeals = (existing?.meals ?? { dinners: [], lunches: [] }) as { dinners: MealSlot[]; lunches: MealSlot[] };
    const updatedMeals = agentType === 'lunches'
      ? { dinners: existingMeals.dinners, lunches: parsedSlots }
      : { dinners: parsedSlots, lunches: existingMeals.lunches };

    const allPlanned = [...updatedMeals.dinners, ...updatedMeals.lunches].filter(m => m.status === 'planned').length;
    const status = allPlanned === 0 ? 'empty' : (updatedMeals.dinners.filter(m => m.status === 'planned').length >= 7 && updatedMeals.lunches.filter(m => m.status === 'planned').length >= 5) ? 'complete' : 'partial';

    await supabaseAdmin
      .from('weekly_plans')
      .upsert({
        subscriber_id: subscriberId,
        week_start: weekStart,
        meals: updatedMeals,
        status,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'subscriber_id,week_start' });
  } catch {
    // weekly_plans table may not exist yet — non-fatal
  }

  return NextResponse.json({ plan: text, meals: parsedSlots });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function parseMealSlots(text: string, type: string): MealSlot[] {
  const slots: MealSlot[] = [];
  const lines = text.split('\n');
  let current: Partial<MealSlot> | null = null;

  function flush() {
    if (current?.day) {
      slots.push({
        day: current.day,
        name: current.name ?? null,
        description: current.description,
        ingredients: current.ingredients ?? [],
        estimatedCost: current.estimatedCost ?? null,
        status: 'planned',
      });
    }
    current = null;
  }

  for (const raw of lines) {
    const line = raw.trim();

    // Stop at shopping list section
    if (line.startsWith('---') || line.toLowerCase().includes('shopping list')) {
      flush();
      break;
    }

    // **Monday:** Meal Name
    const dayMatch = line.match(/^\*\*(\w+):\*\*\s*(.+)$/);
    if (dayMatch && DAYS.includes(dayMatch[1])) {
      flush();
      current = { day: dayMatch[1], name: dayMatch[2].trim(), ingredients: [] };
      continue;
    }

    if (!current) continue;

    // Key ingredients: ...
    if (line.toLowerCase().startsWith('key ingredients:')) {
      const parts = line.slice('key ingredients:'.length).split(',');
      current.ingredients = parts.map(p => ({
        name: p.trim().replace(/\s*\(.*?\)/g, '').replace(/\*+/g, '').trim(),
      })).filter(i => i.name.length > 0);
      continue;
    }

    // *Est. cost: €X.XX*
    const costMatch = line.match(/est\.?\s*cost:?\s*€?([\d.]+)/i);
    if (costMatch) {
      current.estimatedCost = parseFloat(costMatch[1]);
      continue;
    }

    // First non-empty line after day line = description
    if (line && !current.description && !line.startsWith('**') && !line.startsWith('*') && !line.startsWith('-')) {
      current.description = line;
    }
  }

  flush();

  // For lunches, limit to 5 weekdays
  if (type === 'lunches') return slots.slice(0, 5);
  return slots;
}
