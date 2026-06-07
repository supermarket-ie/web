import { ToolLoopAgent, tool, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase';
import { getPairings, getSubstitutes } from '@/lib/epicure-client';

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
    .from('latest_prices')
    .select('store, price, was_price, on_promotion, store_product_name, canonical_name, category')
    .eq('on_promotion', true)
    .limit(200);
  return (data ?? []) as unknown as PriceRow[];
}

async function queryCategoryPrices(category: string): Promise<PriceRow[]> {
  const { data } = await supabaseAdmin
    .from('latest_prices')
    .select('store, price, was_price, on_promotion, store_product_name, canonical_name, category')
    .eq('category', category)
    .limit(200);
  return (data ?? []) as unknown as PriceRow[];
}

async function queryProduct(canonicalName: string): Promise<PriceRow[]> {
  const { data } = await supabaseAdmin
    .from('latest_prices')
    .select('store, price, was_price, on_promotion, store_product_name, canonical_name, category')
    .eq('canonical_name', canonicalName);
  if (!data) return [];
  return (data as unknown as Array<{ store: string; price: number; was_price: number | null; on_promotion: boolean; store_product_name: string; canonical_name: string; category: string }>).map(r => ({
    store: r.store,
    price: r.price,
    was_price: r.was_price,
    on_promotion: r.on_promotion,
    store_product_name: r.store_product_name,
    canonical_name: r.canonical_name,
    category: r.category,
  }));
}

async function queryProductPromotions(canonicalName: string): Promise<PriceRow[]> {
  const { data } = await supabaseAdmin
    .from('latest_prices')
    .select('store, price, was_price, on_promotion, store_product_name, canonical_name, category')
    .eq('canonical_name', canonicalName)
    .eq('on_promotion', true);
  if (!data) return [];
  return data as unknown as PriceRow[];
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

  const names = history.slice(0, 30).map(h => h.canonical_name);

  // Single batch query instead of 30 serial queryProduct calls
  const { data } = await supabaseAdmin
    .from('latest_prices')
    .select('canonical_name, store, price, was_price, on_promotion')
    .in('canonical_name', names);

  if (!data) return [];

  // Best price per product across all stores
  const bestByName = new Map<string, { store: string; price: number }>();
  for (const row of data as unknown as Array<{ canonical_name: string; store: string; price: number }>) {
    const existing = bestByName.get(row.canonical_name);
    if (!existing || row.price < existing.price) {
      bestByName.set(row.canonical_name, { store: row.store, price: row.price });
    }
  }

  const results = [];
  for (const item of history.slice(0, 30)) {
    const bestNow = bestByName.get(item.canonical_name);
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
        direction: diff < 0 ? 'cheaper' : 'dearer',
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Household memory system
// ---------------------------------------------------------------------------

export interface HouseholdMemory {
  totalShops: number;
  avgWeeklySpend: number;
  usualStore: string;
  frequentItems: string[];
  droppedItems: string[];
  notedPreferences: string[];
  lastShopSummary: string;
  updatedAt: string;
}

export async function updateHouseholdMemory(subscriberId: string): Promise<void> {
  try {
    // 1. Fetch shopping history (list_items)
    const { data: listItems } = await supabaseAdmin
      .from('list_items')
      .select('canonical_name, category, store, price_paid, quantity, observed_at')
      .eq('subscriber_id', subscriberId)
      .order('observed_at', { ascending: false })
      .limit(500); // Get more data for better analysis

    // 2. Fetch saved lists for weekly spend calculation
    const { data: savedLists } = await supabaseAdmin
      .from('saved_lists')
      .select('store_totals, created_at, name')
      .eq('subscriber_id', subscriberId)
      .order('created_at', { ascending: false })
      .limit(20);

    // 3. Fetch removed items
    const { data: subscriber } = await supabaseAdmin
      .from('subscribers')
      .select('removed_items')
      .eq('id', subscriberId)
      .single();

    if (!listItems) return;

    // Calculate totalShops (distinct saved_lists)
    const totalShops = savedLists?.length || 0;

    // Calculate average weekly spend from store_totals
    let avgWeeklySpend = 0;
    if (savedLists && savedLists.length > 0) {
      const totalSpends: number[] = [];
      for (const list of savedLists) {
        if (list.store_totals && Array.isArray(list.store_totals)) {
          const listTotal = list.store_totals.reduce((sum: number, store: any) => {
            return sum + (parseFloat(store.total) || 0);
          }, 0);
          if (listTotal > 0) totalSpends.push(listTotal);
        }
      }
      if (totalSpends.length > 0) {
        avgWeeklySpend = Number((totalSpends.reduce((sum, total) => sum + total, 0) / totalSpends.length).toFixed(2));
      }
    }

    // Calculate frequent items (bought 3+ times)
    const itemCounts = new Map<string, number>();
    const storeCounts = new Map<string, number>();

    for (const item of listItems) {
      // Count items
      itemCounts.set(item.canonical_name, (itemCounts.get(item.canonical_name) || 0) + 1);
      // Count stores
      storeCounts.set(item.store, (storeCounts.get(item.store) || 0) + 1);
    }

    // Most frequent items (bought 3+ times)
    const frequentItems = Array.from(itemCounts.entries())
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name);

    // Most common store
    const usualStore = Array.from(storeCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'tesco';

    // Dropped items from removed_items
    const droppedItems = subscriber?.removed_items || [];

    // Generate last shop summary
    let lastShopSummary = 'No previous shops';
    if (savedLists && savedLists.length > 0) {
      const lastList = savedLists[0];
      const lastDate = new Date(lastList.created_at).toLocaleDateString('en-IE', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      });

      // Calculate total for last shop
      let lastTotal = 0;
      let itemCount = 0;
      if (lastList.store_totals && Array.isArray(lastList.store_totals)) {
        lastTotal = lastList.store_totals.reduce((sum: number, store: any) => {
          itemCount += store.item_count || 0;
          return sum + (parseFloat(store.total) || 0);
        }, 0);
      }

      if (lastTotal > 0) {
        lastShopSummary = `€${lastTotal.toFixed(2)} · ${itemCount} items · ${lastDate}`;
      }
    }

    // Build memory object
    const memory: HouseholdMemory = {
      totalShops,
      avgWeeklySpend,
      usualStore,
      frequentItems,
      droppedItems,
      notedPreferences: [], // Start empty, can be populated later based on patterns
      lastShopSummary,
      updatedAt: new Date().toISOString(),
    };

    // Upsert memory to households table
    await supabaseAdmin
      .from('households')
      .upsert(
        {
          subscriber_id: subscriberId,
          memory: memory
        },
        { onConflict: 'subscriber_id' }
      );

    console.log(`[updateHouseholdMemory] Updated memory for subscriber ${subscriberId}`);
  } catch (error) {
    console.error(`[updateHouseholdMemory] Error updating memory for ${subscriberId}:`, error);
  }
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
    get_last_list: tool({
      description: "Returns the user's most recent saved grocery list with all items, stores, and prices paid.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!subscriberId) return { items: [], found: false };
        const { data } = await supabaseAdmin
          .from('saved_lists')
          .select('items, name, generated_at, store_totals')
          .eq('subscriber_id', subscriberId)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (!data) return { items: [], found: false };
        const history = await queryUserHistory(subscriberId);
        return { ...data, history, found: true };
      },
    }),
    reprice_list: tool({
      description: 'Takes a list of product names and returns current best prices + any promotions. Use after get_last_list to build an updated "same again" list.',
      inputSchema: z.object({
        items: z.array(z.string()).describe('Array of canonical_name values from the previous list'),
      }),
      execute: async ({ items }: { items: string[] }) => {
        // Batch query all products at once
        const { data } = await supabaseAdmin
          .from('latest_prices')
          .select('canonical_name, store, price, was_price, on_promotion, store_product_name, category')
          .in('canonical_name', items);
        const rows = (data ?? []) as unknown as PriceRow[];
        return items.map(name => ({
          canonical_name: name,
          prices: rows.filter(r => r.canonical_name === name),
          promotions: rows.filter(r => r.canonical_name === name && r.on_promotion),
        }));
      },
    }),
    get_flavour_pairings: tool({
      description: `Query the Epicure flavour model (trained on 4.14M recipes) to find what ingredients pair well with a set of ingredients. Returns BRIDGES — ingredients that connect multiple flavour clusters — which are the best non-obvious additions to a dish or meal plan. Use this when:
- Suggesting what else to add to a meal (e.g. "you have chicken and garlic, you'll also want...")
- Building a meal plan around specific hero ingredients
- Suggesting accompaniments or complementary sides
- The user asks "what goes well with X?"
Always cross-reference results against our catalogue — only suggest items we actually stock. The catalogue has ~2,500 products so most bridges will be available.`,
      inputSchema: z.object({
        ingredients: z.array(z.string()).describe('1–4 ingredient names (use simple names: "chicken", "beef", "pasta", "salmon" — not full canonical names)'),
      }),
      execute: async ({ ingredients }: { ingredients: string[] }) => {
        // 1. Try DB lookup first (pre-computed, fast)
        const dbResults = await supabaseAdmin
          .from('product_pairings')
          .select('canonical_name, epicure_key, bridges, primaries')
          .eq('found', true)
          .or(ingredients.map(i => `epicure_key.eq.${i.toLowerCase()}`).join(','));

        if (dbResults.data && dbResults.data.length > 0) {
          // Merge bridges across all matched ingredients
          const allBridges = [...new Set(dbResults.data.flatMap((r: { bridges: string[] }) => r.bridges))].slice(0, 10);
          const allPrimaries = [...new Set(dbResults.data.flatMap((r: { primaries: string[] }) => r.primaries))].slice(0, 15);

          // Cross-reference bridges against our catalogue
          if (allBridges.length > 0) {
            const { data: inCatalogue } = await supabaseAdmin
              .from('product_pairings')
              .select('canonical_name, epicure_key')
              .in('epicure_key', allBridges)
              .eq('found', true)
              .limit(20);

            const catalogueBridges = (inCatalogue ?? []).map((r: { canonical_name: string; epicure_key: string }) =>
              `${r.epicure_key} (stocked as "${r.canonical_name}")`
            );

            return {
              found: true,
              source: 'db',
              ingredients: ingredients.join(', '),
              bridges: allBridges,
              bridges_in_catalogue: catalogueBridges,
              primaries: allPrimaries,
              message: `Found ${allBridges.length} pairing bridges from pre-computed model. ${catalogueBridges.length} confirmed in catalogue.`,
            };
          }
        }

        // 2. Fall back to live Epicure API
        const result = await getPairings(ingredients);
        if (!result) return { found: false, message: 'Ingredients not found in flavour model' };
        return {
          found: true,
          source: 'live',
          ingredient: result.ingredient,
          bridges: result.bridges,
          full_graph: result.rawText,
        };
      },
    }),
    get_substitutes: tool({
      description: `Find the most similar/substitutable ingredients for a given item, grounded in 4.14M recipes. Use this when:
- An item is expensive this week and you want a cheaper swap
- A user has a dietary restriction that rules out an ingredient
- You want to suggest "if you don't like X, try Y instead"
Always cross-reference against our catalogue to confirm we stock the substitute and compare prices.`,
      inputSchema: z.object({
        ingredient: z.string().describe('Single ingredient — use simple name like "chicken", "butter", "cheddar"'),
      }),
      execute: async ({ ingredient }: { ingredient: string }) => {
        const epicureKey = ingredient.toLowerCase().trim();

        // 1. Try DB lookup — find products with similar epicure_key
        const { data: similar } = await supabaseAdmin
          .from('product_pairings')
          .select('canonical_name, epicure_key, bridges')
          .eq('found', true)
          .neq('epicure_key', epicureKey)
          .limit(20);

        // Filter to those whose bridges overlap with the target ingredient's bridges
        const { data: target } = await supabaseAdmin
          .from('product_pairings')
          .select('bridges, primaries')
          .eq('found', true)
          .ilike('epicure_key', `%${epicureKey.split(' ')[0]}%`)
          .limit(3);

        if (target && target.length > 0) {
          const targetBridges = new Set((target as Array<{ bridges: string[] }>).flatMap(t => t.bridges));
          const candidates = (similar ?? [])
            .filter((s: { bridges: string[] }) => s.bridges.some((b: string) => targetBridges.has(b)))
            .slice(0, 6);

          if (candidates.length > 0) {
            return {
              found: true,
              source: 'db',
              ingredient: epicureKey,
              substitutes: candidates.map((c: { canonical_name: string; epicure_key: string }) => ({
                name: c.epicure_key,
                canonical_name: c.canonical_name,
                similarity: 'high', // recipe co-occurrence based
              })),
            };
          }
        }

        // 2. Fall back to live Epicure API
        const result = await getSubstitutes(epicureKey, 6);
        if (!result) return { found: false, message: 'Ingredient not found in flavour model' };
        return {
          found: true,
          source: 'live',
          ingredient: result.ingredient,
          substitutes: result.substitutes,
        };
      },
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

    save_list: tool({
      description: 'Saves the completed grocery list to the database as structured data. Call this ONCE after building the complete list and BEFORE writing the markdown summary to the user. Returns list_id.',
      inputSchema: z.object({
        name: z.string().describe('Short descriptive name e.g. "Weekly shop · 3 Jun" or "Family of 4 · vegetarian"'),
        items: z.array(z.object({
          canonical_name: z.string(),
          store: z.string(),
          price: z.number(),
          quantity: z.number().default(1),
          category: z.string().optional(),
          store_product_name: z.string().optional(),
          on_promotion: z.boolean().optional(),
        })).describe('Every item on the list with canonical_name, store, and price. This is required — do not pass an empty array.'),
        store_totals: z.array(z.object({
          store: z.string(),
          total: z.number(),
          item_count: z.number(),
        })),
        recommended_store: z.string().optional().describe('The single best store for the whole shop'),
      }),
      execute: async ({ name, items, store_totals, recommended_store }) => {
        if (!subscriberId) return { saved: false, reason: 'User not signed in', list_id: null };
        try {
          // Cap at 10 lists — delete oldest if needed
          const { data: existing } = await supabaseAdmin
            .from('saved_lists')
            .select('id, created_at')
            .eq('subscriber_id', subscriberId)
            .order('created_at', { ascending: true });
          if (existing && existing.length >= 10) {
            const toDelete = existing.slice(0, existing.length - 9);
            await supabaseAdmin.from('saved_lists').delete().in('id', toDelete.map((r: { id: string }) => r.id));
          }
          // Clear is_default on existing lists
          await supabaseAdmin.from('saved_lists').update({ is_default: false }).eq('subscriber_id', subscriberId);
          // Insert new list
          const { data, error } = await supabaseAdmin
            .from('saved_lists')
            .insert({
              subscriber_id: subscriberId,
              name,
              items,
              store_totals,
              recommended_store: recommended_store ?? null,
              is_default: true,
              generated_at: new Date().toISOString(),
            })
            .select('id')
            .single();
          if (error || !data) return { saved: false, reason: error?.message ?? 'Unknown error', list_id: null };
          const listId = (data as { id: string }).id;
          // Write list_items for history/memory — use passed items if available, 
          // otherwise fall back to recently written list_items with null list_id
          const itemsToWrite = items.length > 0 ? items : [];
          if (itemsToWrite.length > 0) {
            await supabaseAdmin.from('list_items').insert(
              itemsToWrite.map(item => ({
                subscriber_id: subscriberId,
                list_id: listId,
                canonical_name: item.canonical_name,
                store: item.store,
                price_paid: item.price,
                quantity: item.quantity ?? 1,
                category: item.category ?? null,
                observed_at: new Date().toISOString(),
              }))
            );
          } else {
            // Back-fill list_id on recently orphaned list_items (null list_id for this subscriber)
            await supabaseAdmin.from('list_items')
              .update({ list_id: listId })
              .eq('subscriber_id', subscriberId)
              .is('list_id', null);
          }
          return { saved: true, list_id: listId };
        } catch (err) {
          console.error('[save_list] error:', err);
          return { saved: false, reason: 'Unexpected error', list_id: null };
        }
      },
    }),

    update_list: tool({
      description: 'Replaces items in an existing saved list with updated prices. Use for "Same Again" — pass the list_id from get_last_list. Do NOT call save_list when updating an existing list.',
      inputSchema: z.object({
        list_id: z.string().describe('The ID of the list to update, from get_last_list'),
        items: z.array(z.object({
          canonical_name: z.string(),
          store: z.string(),
          price: z.number(),
          quantity: z.number().default(1),
          category: z.string().optional(),
          store_product_name: z.string().optional(),
          on_promotion: z.boolean().optional(),
        })),
        store_totals: z.array(z.object({
          store: z.string(),
          total: z.number(),
          item_count: z.number(),
        })),
        recommended_store: z.string().optional(),
      }),
      execute: async ({ list_id, items, store_totals, recommended_store }) => {
        if (!subscriberId) return { saved: false, reason: 'User not signed in' };
        try {
          const { error } = await supabaseAdmin
            .from('saved_lists')
            .update({
              items,
              store_totals,
              recommended_store: recommended_store ?? null,
              generated_at: new Date().toISOString(),
            })
            .eq('id', list_id)
            .eq('subscriber_id', subscriberId);
          if (error) return { saved: false, reason: error.message };
          // Replace list_items
          await supabaseAdmin.from('list_items').delete().eq('list_id', list_id);
          if (items.length > 0) {
            supabaseAdmin.from('list_items').insert(
              items.map(item => ({
                subscriber_id: subscriberId,
                list_id,
                canonical_name: item.canonical_name,
                store: item.store,
                price_paid: item.price,
                quantity: item.quantity ?? 1,
                category: item.category ?? null,
                observed_at: new Date().toISOString(),
              }))
            ).then(() => {});
          }
          return { saved: true, list_id };
        } catch (err) {
          console.error('[update_list] error:', err);
          return { saved: false, reason: 'Unexpected error' };
        }
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
  hasLastList?: boolean;
  householdMemory?: HouseholdMemory | null;
}): string {
  const sameAgainContext = opts?.returningUser && opts?.hasLastList
    ? `\n\n## Returning User — "Same Again" Mode\n\nThe user wants their usual list updated with this week's prices. Their last list is available via get_last_list.\n\nYour job:\n1. Call get_last_list to get their previous items (use the history field for canonical_names)\n2. Call reprice_list with those item canonical_names\n3. Present the updated list with clear callouts:\n   - ✅ Items that got cheaper (show saving)\n   - ⚠️ Items that got more expensive (show increase)\n   - 🏷️ Items with new promotions at a different store (suggest swap)\n   - ❌ Items no longer available (suggest alternative)\n4. Show the new total vs last time\n5. Ask if they want any changes\n\nKeep it brief. They know what they want — just show what's different.`
    : '';

  const returningContext = opts?.returningUser && opts?.profileSummary && !opts?.hasLastList
    ? `\n\n## Returning User Context\nThis user has shopped before. Their saved profile:\n${opts.profileSummary}\n\nGreet them warmly, mention their household briefly, and offer to plan the same way or update anything. If they say "same again" or similar, go straight to generating.`
    : '';

  const memoryContext = opts?.householdMemory && opts.householdMemory.totalShops > 0
    ? (() => {
        const m = opts.householdMemory!;
        const lines = [`- ${m.totalShops} shop${m.totalShops !== 1 ? 's' : ''} completed. Average weekly spend: €${m.avgWeeklySpend}.`];
        if (m.usualStore) lines.push(`- They usually shop at ${m.usualStore}.`);
        if (m.frequentItems.length > 0) lines.push(`- Items they always buy: ${m.frequentItems.join(', ')}.`);
        if (m.droppedItems.length > 0) lines.push(`- Items they have removed from past lists (do NOT suggest these): ${m.droppedItems.join(', ')}.`);
        if (m.notedPreferences.length > 0) lines.push(`- Notes: ${m.notedPreferences.join('; ')}.`);
        if (m.lastShopSummary && m.lastShopSummary !== 'No previous shops') lines.push(`- Last shop: ${m.lastShopSummary}.`);
        return `\n\n## Your Memory of This Household\n${lines.join('\n')}\nStart from this context. Don't mention you have memory — just use it naturally.`;
      })()
    : '';

  return `You are the supermarket.ie grocery planning assistant — Ireland's smartest AI grocery planner.${memoryContext}

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
6. **FLAVOUR INTELLIGENCE: For 2–3 hero ingredients in the planned meals (e.g. the protein + a vegetable), call get_flavour_pairings. Use the BRIDGES from the result to suggest non-obvious but recipe-grounded accompaniments that we actually stock. This is what makes you feel smarter than a basic list tool.**
7. **SUBSTITUTIONS: If any item on the list is expensive (>€5) or if there's a significantly cheaper alternative, call get_substitutes to find a recipe-grounded swap. Cross-reference against prices to confirm the substitute is actually cheaper. When you find a valid swap, mention it naturally in the list (e.g. 'Pork Mince 500g (swap for Beef Mince — saves €1.80, works just as well in bolognese)').**
8. **FINAL CHECK: Re-read the user's dietary requirements and verify EVERY item complies. Remove any that don't.**
9. Call save_list with all items, store_totals, and a short descriptive name. Do this BEFORE writing the markdown output. For "Same Again", call update_list with the list_id from get_last_list instead of save_list.

Rules:
- Only use products from the catalogue. Do not invent products.
- Pick cheapest store per product unless a promotion elsewhere is better.
- Scale quantities for the household size.
- Include staples (bread, milk, butter, eggs), household essentials, and personal care basics.
- Never mention tool calls to the user.
- Gather ALL data via tools before writing any output.
- Always call save_list (or update_list for Same Again) before writing the markdown output. Never skip this step.
- When you use a flavour pairing bridge to add an item, naturally weave it in: "Garlic pairs brilliantly with the chicken here" not "the model suggested garlic".

## Output Format (when generating the list)

### 🛒 Your weekly grocery list
_For [household description] · [meals covered]_

**[Category]**
- [Product name] — [Store] €[price]
- ...

**[Next category]**
- ...

---
**🏪 Store totals** (always include this section — exact format, no extra commentary, no grand total)
- Tesco: €X.XX (N items)
- Dunnes: €X.XX (N items)
- SuperValu: €X.XX (N items)
- Aldi: €X.XX (N items)

## Post-List Modifications
After generating, the user may ask to change things. Help them — swap items, add/remove products, adjust quantities. Always show the full updated list.${returningContext}${sameAgainContext}`;
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
7. **FLAVOUR INTELLIGENCE: For 2–3 hero ingredients in the planned meals, call get_flavour_pairings. Use the BRIDGES to suggest non-obvious recipe-grounded accompaniments we actually stock. This is what makes you feel smarter than a basic list tool.**
8. **SUBSTITUTIONS: If any item is expensive (>€5) or has a clearly cheaper alternative, call get_substitutes. Only suggest the swap if our catalogue confirms it's cheaper. Mention valid swaps naturally in the list (e.g. 'Pork Mince 500g (cheaper swap for Beef Mince — saves €1.80)').**
9. save_list — call with all items and store_totals BEFORE writing output. For Same Again, call update_list instead.

Rules:
- Gather ALL data via tools before writing any output.
- Only use products from the catalogue. Do not invent products.
- Match ingredients to the closest catalogue product. Skip silently if no match.
- Pick cheapest store per product unless a promotion elsewhere is better value.
${!profile.preferredStores.includes('all') ? `- ONLY show prices from: ${storesPref}. Ignore other stores entirely.` : ''}
- Never mention tool calls to the user.
- Always call save_list (or update_list for Same Again) before writing output.
- When you use a flavour pairing to add an item, weave it in naturally: "Garlic goes brilliantly with the chicken here" — not "the model suggested it".
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
**🏪 Store totals** (always include this section — exact format, no extra commentary, no grand total)
- Tesco: €X.XX (N items)
- Dunnes: €X.XX (N items)
- SuperValu: €X.XX (N items)
- Aldi: €X.XX (N items)

${profile.weeklyBudget ? `**Budget:** €X.XX of €${profile.weeklyBudget} (€X.XX ${profile.weeklyBudget ? 'under' : 'over'} budget)\n` : ''}`;
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
**🏪 Store totals** (always include this section — exact format, no extra commentary, no grand total)
- Tesco: €X.XX (N items)
- Dunnes: €X.XX (N items)
- SuperValu: €X.XX (N items)
- Aldi: €X.XX (N items)`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Agent factory
// ---------------------------------------------------------------------------

export async function createPlannerAgent(opts: {
  subscriberId: string | null;
  profile?: PlannerProfile;
  householdSize?: number;
  isModification?: boolean;
  intakeMode?: boolean;
  returningUser?: boolean;
  profileSummary?: string;
  hasLastList?: boolean;
}) {
  // Fetch household memory if subscriber is signed in
  let householdMemory: HouseholdMemory | null = null;
  if (opts.subscriberId && opts.intakeMode) {
    const { data: household } = await supabaseAdmin
      .from('households')
      .select('memory')
      .eq('subscriber_id', opts.subscriberId)
      .single();

    householdMemory = household?.memory as HouseholdMemory | null;
  }

  let instructions: string;

  if (opts.intakeMode) {
    // AI-driven conversation from message 1
    instructions = buildIntakePrompt({
      returningUser: opts.returningUser,
      profileSummary: opts.profileSummary,
      hasLastList: opts.hasLastList,
      householdMemory: householdMemory,
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
