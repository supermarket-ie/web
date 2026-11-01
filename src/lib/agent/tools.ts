import { dynamicTool, tool } from 'ai';
import { z } from 'zod';
import {
  householdShopProposalSchema,
  type HouseholdShopToolOutput,
} from '../shopping/household-shop-contract';
import type { CataloguePriceRow } from '../shopping/catalogue-core';
import { groundHouseholdShop } from '../shopping/household-shop';
import { compareBasketStores } from '../shopping/compare';
import { findDietaryViolations } from '../list-validation';
import { getSubstitutes as getEpicureSubstitutes } from '../epicure-client';
// Reuse the Eve runtime's shopping helpers directly — these are the SAME
// functions the production agent uses, so every product-identity and
// price-truth invariant lives inside them, not here.
import { resolveCatalogueProduct, getCurrentProductSnapshot } from '../../../agent/lib/catalogue';
import {
  householdShopResolutionSeeds,
  resolveHouseholdShopProposal,
} from '../../../agent/lib/household-shop-resolution';
import { groundIngredient } from '../../../agent/lib/ingredient-intelligence';
import { catalogueSupabase } from './supabase';

const QUERY_CHUNK_SIZE = 12;

function chunks<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

function uniqueBy<T>(rows: T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map(row => [key(row), row])).values()];
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Context the route passes to tool construction. `subscriberId` is null for a
 * guest; the household-scoped tools (find_substitutes) degrade gracefully when
 * absent, matching the Eve guest boundary.
 */
export type AgentToolContext = {
  subscriberId: string | null;
};

// ---------------------------------------------------------------------------
// get_current_price — wraps resolveCatalogueProduct (read-only catalogue)
// ---------------------------------------------------------------------------
function getCurrentPriceTool() {
  return tool({
    description:
      'Resolve a natural-language product request against the current Supermarket.ie catalogue. Returns several strong candidate products with current retailer prices so you can infer ordinary shopper intent instead of treating the first match as the requested SKU. Do not repeat the lookup for the same wording in one turn.',
    inputSchema: z.object({
      productQuery: z.string().min(2),
    }),
    async execute({ productQuery }) {
      const candidates = await resolveCatalogueProduct(productQuery, 6);
      if (candidates.length === 0) {
        return { found: false as const, query: productQuery, resolution: 'none' as const, matches: [] };
      }
      const matches = candidates.map((candidate, index) => ({
        rank: index + 1,
        canonical_product_id: candidate.canonical_product_id,
        canonical_name: candidate.canonical_name,
        category: candidate.category,
        relevance_score: candidate.score,
        best_price: candidate.best_price,
        best_store: candidate.best_store,
        on_promotion: candidate.on_promotion,
        stores: candidate.stores,
      }));
      const queryNorm = normalise(productQuery);
      const top = candidates[0];
      const second = candidates[1];
      const exactCanonicalMatch = normalise(top.canonical_name) === queryNorm;
      const scoreGap = second ? top.score - second.score : Number.POSITIVE_INFINITY;
      const clearSingleMatch = exactCanonicalMatch || !second || scoreGap >= 8;
      return {
        found: true as const,
        query: productQuery,
        resolution: clearSingleMatch ? ('single' as const) : ('product_family' as const),
        exact_canonical_match: exactCanonicalMatch,
        matches,
        canonical_product_id: clearSingleMatch ? top.canonical_product_id : null,
        canonical_name: clearSingleMatch ? top.canonical_name : null,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// present_household_shop — wraps groundHouseholdShop; COPIES the exact batch
// resolution query logic from agent/tools/present_household_shop.ts so the
// `dynamic-tool` UIMessage contract and all price-truth invariants are preserved.
// Returns exactly { kind: 'household_shop', shop }.
// ---------------------------------------------------------------------------
function presentHouseholdShopTool() {
  // A DYNAMIC tool: streamed to the UIMessage stream as a `dynamic-tool` part
  // (type:'dynamic-tool', toolName:'present_household_shop'), which is exactly
  // the part the frontend reads to render the structured shop card. The name
  // MUST stay 'present_household_shop' and the output MUST be
  // { kind:'household_shop', shop }.
  return dynamicTool({
    description:
      'Present a complete household shop in Supermarket.ie’s native structured shopping UI. Use this for complete, weekly or value-led household-shop outcomes once the household assumptions are known. Submit the complete proposal directly; this tool batch-resolves ordinary product wording server-side, validates supplied canonical_product_id values and leaves genuinely ambiguous needs unresolved. Never invent an ID. This tool owns current prices, promotion truth, totals and retailer coverage. After calling it, introduce the result briefly instead of repeating every line in prose.',
    inputSchema: householdShopProposalSchema,
    async execute(rawProposal): Promise<HouseholdShopToolOutput> {
      const proposal = householdShopProposalSchema.parse(rawProposal);
      const suppliedIds = [
        ...new Set(proposal.items.flatMap(item => (item.canonical_product_id ? [item.canonical_product_id] : []))),
      ];
      const seedChunks = chunks(householdShopResolutionSeeds(proposal), QUERY_CHUNK_SIZE);
      const seedProductQueries = seedChunks.map(seeds => {
        const productFilter = seeds.map(seed => `canonical_name.ilike.%${seed}%`).join(',');
        return catalogueSupabase.from('products').select('id, canonical_name, category').or(productFilter).limit(2000);
      });
      const seedPriceQueries = seedChunks.map(seeds => {
        const priceFilter = seeds
          .flatMap(seed => [`canonical_name.ilike.%${seed}%`, `store_product_name.ilike.%${seed}%`])
          .join(',');
        return catalogueSupabase
          .from('latest_prices')
          .select(
            'canonical_product_id, canonical_name, category, store_product_id, store, store_product_name, store_sku, store_url, price, was_price, on_promotion, observed_at, source, relationship_type, freshness_state',
          )
          .or(priceFilter)
          .limit(2000);
      });
      const suppliedProductQuery = suppliedIds.length
        ? [catalogueSupabase.from('products').select('id, canonical_name, category').in('id', suppliedIds)]
        : [];
      const suppliedPriceQuery = suppliedIds.length
        ? [
            catalogueSupabase
              .from('latest_prices')
              .select(
                'canonical_product_id, canonical_name, category, store_product_id, store, store_product_name, store_sku, store_url, price, was_price, on_promotion, observed_at, source, relationship_type, freshness_state',
              )
              .in('canonical_product_id', suppliedIds),
          ]
        : [];
      const [productResults, priceResults] = await Promise.all([
        Promise.all([...seedProductQueries, ...suppliedProductQuery]),
        Promise.all([...seedPriceQueries, ...suppliedPriceQuery]),
      ]);
      const failed = [...productResults, ...priceResults].find(result => result.error)?.error;
      if (failed) throw new Error(`Unable to batch-resolve household-shop products: ${failed.message}`);

      const catalogueRows = uniqueBy(
        productResults.flatMap(result => result.data ?? []) as Array<{
          id: string;
          canonical_name: string;
          category: string | null;
        }>,
        row => String(row.id),
      );
      const priceRows = uniqueBy(
        priceResults.flatMap(result => result.data ?? []) as Array<Record<string, unknown>>,
        row => `${row.canonical_product_id}:${row.store_product_id}`,
      );
      const catalogueProducts = catalogueRows.map(product => ({
        canonical_product_id: String(product.id),
        canonical_name: product.canonical_name,
        category: product.category ?? null,
      }));
      const resolvedProposal = resolveHouseholdShopProposal(
        proposal,
        catalogueProducts,
        priceRows.map(row => ({
          canonical_product_id: String(row.canonical_product_id),
          canonical_name: String(row.canonical_name),
          category: row.category == null ? null : String(row.category),
          store: String(row.store),
          store_product_name: String(row.store_product_name),
          price: Number(row.price),
          was_price: row.was_price == null ? null : Number(row.was_price),
          on_promotion: row.on_promotion === true,
        })) satisfies CataloguePriceRow[],
      );

      const shop = groundHouseholdShop({
        proposal: resolvedProposal,
        catalogue_products: catalogueProducts,
        latest_prices: priceRows.map(offer => ({
          canonical_product_id: String(offer.canonical_product_id),
          canonical_name: String(offer.canonical_name),
          category: offer.category == null ? null : String(offer.category),
          store_product_id: String(offer.store_product_id),
          store: String(offer.store),
          store_product_name: String(offer.store_product_name),
          store_sku: String(offer.store_sku),
          store_url: offer.store_url == null ? null : String(offer.store_url),
          price: Number(offer.price),
          was_price: offer.was_price == null ? null : Number(offer.was_price),
          on_promotion: offer.on_promotion === true,
          observed_at: String(offer.observed_at),
          source: String(offer.source),
          relationship_type: offer.relationship_type as 'exact',
          freshness_state: offer.freshness_state as 'fresh',
        })),
        comparison_retailers: ['tesco', 'dunnes', 'supervalu'],
      });

      return { kind: 'household_shop' as const, shop };
    },
  });
}

// ---------------------------------------------------------------------------
// compare_shop_stores — wraps compareBasketStores (read-only prices)
// ---------------------------------------------------------------------------
type ComparePriceRow = { canonical_name: string; store: string; price: number; on_promotion: boolean | null };

function compareShopStoresTool() {
  return tool({
    description:
      'Compare a basket of exact catalogue products across supermarkets using current catalogue prices. Returns coverage and comparable basket totals by store. Use for questions like “would it be worth doing this all in Dunnes?”. A store missing any product is never presented as a complete basket total.',
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            canonical_name: z.string().min(2),
            quantity: z.number().int().min(1).max(50).default(1),
            current_price: z.number().positive().nullable().optional(),
          }),
        )
        .min(1)
        .max(200),
      store: z.string().min(2).max(60).optional().describe('Optional single supermarket to compare against.'),
    }),
    async execute({ items, store }) {
      const names = [...new Set(items.map(item => item.canonical_name).filter(Boolean))];
      const { data, error } = await catalogueSupabase
        .from('latest_prices')
        .select('canonical_name, store, price, on_promotion')
        .in('canonical_name', names);
      if (error) throw new Error(`Unable to compare current supermarket prices: ${error.message}`);
      const comparison = compareBasketStores(
        items.map(item => ({
          canonical_name: item.canonical_name,
          quantity: item.quantity ?? 1,
          current_price: item.current_price ?? null,
        })),
        ((data ?? []) as ComparePriceRow[]).map(row => ({
          canonical_name: row.canonical_name,
          store: row.store,
          price: Number(row.price),
        })),
        store,
      );
      return {
        ok: true as const,
        current_mixed_total: comparison.current_total,
        comparisons: comparison.comparisons,
        note: 'Only exact catalogue products are compared. A store with missing products is not presented as a complete basket total.',
      };
    },
  });
}

// ---------------------------------------------------------------------------
// find_substitutes — reuses the SAME src/lib/shopping helpers the Eve
// find_substitutes tool calls (epicure substitutes, groundIngredient,
// getCurrentProductSnapshot, dietary screening). Household-scoped: requires a
// signed-in subscriber, otherwise returns a guest-boundary message.
// ---------------------------------------------------------------------------
type SubPriceRow = { canonical_name: string; store: string; price: number; on_promotion: boolean | null };

function isDisliked(name: string, dislikes?: string | null): boolean {
  if (!dislikes?.trim()) return false;
  const haystack = normalise(name);
  return dislikes
    .split(/[,;\n]/)
    .map(value => normalise(value))
    .filter(value => value.length >= 2)
    .some(value => haystack.includes(value) || value.includes(haystack));
}

function findSubstitutesTool(context: AgentToolContext) {
  return tool({
    description:
      'Find catalogue-grounded functional substitute candidates for an exact product, combining ingredient similarity, household dietary requirements and dislikes, current prices and promotions. Use before suggesting a cheaper or similar alternative. Requires a signed-in household.',
    inputSchema: z.object({
      canonical_name: z.string().min(2).describe('Exact canonical product name to find alternatives for.'),
      limit: z.number().int().min(1).max(8).default(5),
    }),
    async execute({ canonical_name, limit }) {
      const subscriberId = context.subscriberId;
      if (!subscriberId) {
        return {
          ok: false as const,
          reason: 'sign_in_required' as const,
          message: 'Finding household substitutes uses saved dietary and store preferences, which require sign-in.',
        };
      }
      const [{ data: household, error: householdError }, sourceSnapshot] = await Promise.all([
        catalogueSupabase
          .from('households')
          .select('dietary, dislikes, preferred_stores')
          .eq('subscriber_id', subscriberId)
          .maybeSingle(),
        getCurrentProductSnapshot(canonical_name),
      ]);
      if (householdError) throw new Error(`Unable to load household substitution context: ${householdError.message}`);
      const dietary = (household?.dietary as string[] | null) ?? [];
      const dislikes = (household?.dislikes as string | null) ?? null;
      const preferredStores = (household?.preferred_stores as string[] | null) ?? [];

      const candidatesByName = new Map<string, { canonical_name: string; ingredient: string | null; similarity_signals: number }>();
      const live = await getEpicureSubstitutes(canonical_name, 8);
      for (const substitute of live?.substitutes ?? []) {
        const grounded = await groundIngredient(
          substitute.name,
          { dietary, dislikes, preferred_stores: preferredStores },
          2,
        );
        for (const product of grounded) {
          if (product.canonical_name === canonical_name || candidatesByName.has(product.canonical_name)) continue;
          if (findDietaryViolations([{ canonical_name: product.canonical_name }], dietary).length > 0) continue;
          if (isDisliked(product.canonical_name, dislikes)) continue;
          candidatesByName.set(product.canonical_name, {
            canonical_name: product.canonical_name,
            ingredient: substitute.name,
            similarity_signals: Math.max(1, Math.round(substitute.similarity * 10)),
          });
        }
        if (candidatesByName.size >= Math.max(limit * 2, 10)) break;
      }

      const ranked = [...candidatesByName.values()]
        .sort((a, b) => b.similarity_signals - a.similarity_signals)
        .slice(0, 30);
      if (ranked.length === 0) {
        return {
          ok: false as const,
          reason: 'no_substitutes' as const,
          message: 'I could not find a sufficiently grounded substitute that fits this household.',
        };
      }
      const names = ranked.map(row => row.canonical_name);
      const { data: priceRows, error: pricesError } = await catalogueSupabase
        .from('latest_prices')
        .select('canonical_name, store, price, on_promotion')
        .in('canonical_name', names);
      if (pricesError) throw new Error(`Unable to price substitute candidates: ${pricesError.message}`);
      const prices = (priceRows ?? []) as SubPriceRow[];
      const sourcePrice = sourceSnapshot?.best_price ?? null;

      const preferred = new Set(preferredStores.map(normalise).filter(storeName => storeName !== 'all'));
      const substitutes = ranked
        .map(candidate => {
          const rows = prices.filter(row => row.canonical_name === candidate.canonical_name);
          const preferredRows = preferred.size > 0 ? rows.filter(row => preferred.has(normalise(row.store))) : [];
          const best = [...(preferredRows.length > 0 ? preferredRows : rows)].sort(
            (a, b) => Number(a.price) - Number(b.price),
          )[0];
          if (!best) return null;
          const price = Number(best.price);
          return {
            canonical_name: candidate.canonical_name,
            ingredient_role: candidate.ingredient,
            similarity_signals: candidate.similarity_signals,
            store: best.store,
            price,
            on_promotion: Boolean(best.on_promotion),
            saving_vs_source_best: sourcePrice == null ? null : Number((sourcePrice - price).toFixed(2)),
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .sort((a, b) =>
          a.similarity_signals !== b.similarity_signals
            ? b.similarity_signals - a.similarity_signals
            : a.price - b.price,
        )
        .slice(0, limit);

      return {
        ok: substitutes.length > 0,
        source_product: canonical_name,
        source_best_price: sourcePrice,
        household_constraints_applied: { dietary, dislikes, preferred_stores: preferredStores },
        substitutes,
        guidance:
          'Similarity is one signal only. Prefer a substitute that serves the same meal function and offers a useful price advantage; do not replace automatically when function is ambiguous.',
      };
    },
  });
}

/**
 * Build the full tool set for a turn. The tool NAMES are the contract the
 * frontend consumes — `present_household_shop` MUST stay exactly named so
 * `toUIMessageStreamResponse()` emits the `dynamic-tool` part the UI renders.
 */
export function buildAgentTools(context: AgentToolContext) {
  return {
    get_current_price: getCurrentPriceTool(),
    present_household_shop: presentHouseholdShopTool(),
    compare_shop_stores: compareShopStoresTool(),
    find_substitutes: findSubstitutesTool(context),
  };
}

export type AgentTools = ReturnType<typeof buildAgentTools>;
