import { defineTool } from 'eve/tools';
import { householdShopProposalSchema } from '../../src/lib/shopping/household-shop-contract';
import type { CataloguePriceRow } from '../../src/lib/shopping/catalogue-core';
import { groundHouseholdShop } from '../../src/lib/shopping/household-shop';
import { householdShopResolutionSeeds, resolveHouseholdShopProposal } from '../lib/household-shop-resolution';
import { agentSupabase } from '../lib/supabase';

const QUERY_CHUNK_SIZE = 12;

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function uniqueBy<T>(rows: T[], key: (row: T) => string) {
  return [...new Map(rows.map(row => [key(row), row])).values()];
}

export default defineTool({
  description: `Present a complete household shop in Supermarket.ie’s native structured shopping UI. Use this for complete, weekly or value-led household-shop outcomes after the household assumptions are known. Submit the complete proposal directly rather than making one product-lookup call per line: this tool batch-resolves ordinary product wording server-side, validates any supplied canonical_product_id values and leaves genuinely ambiguous needs unresolved. Never invent an ID. This tool owns current prices, promotion truth, totals and retailer coverage; never write those values in the input. After calling it, introduce the result briefly instead of repeating every shop line in prose.`,
  inputSchema: householdShopProposalSchema,
  async execute(rawProposal) {
    const startedAt = Date.now();
    const proposal = householdShopProposalSchema.parse(rawProposal);
    const suppliedIds = [...new Set(proposal.items.flatMap(item => item.canonical_product_id ? [item.canonical_product_id] : []))];
    const seedChunks = chunks(householdShopResolutionSeeds(proposal), QUERY_CHUNK_SIZE);
    const seedProductQueries = seedChunks.map(seeds => {
      const productFilter = seeds.map(seed => `canonical_name.ilike.%${seed}%`).join(',');
      return agentSupabase.from('products').select('id, canonical_name, category').or(productFilter).limit(2000);
    });
    const seedPriceQueries = seedChunks.map(seeds => {
      const priceFilter = seeds.flatMap(seed => [
        `canonical_name.ilike.%${seed}%`,
        `store_product_name.ilike.%${seed}%`,
      ]).join(',');
      return agentSupabase.from('latest_prices').select('canonical_product_id, canonical_name, category, store_product_id, store, store_product_name, store_sku, store_url, price, was_price, on_promotion, observed_at, source, relationship_type, freshness_state').or(priceFilter).limit(2000);
    });
    const suppliedProductQuery = suppliedIds.length
      ? [agentSupabase.from('products').select('id, canonical_name, category').in('id', suppliedIds)]
      : [];
    const suppliedPriceQuery = suppliedIds.length
      ? [agentSupabase.from('latest_prices').select('canonical_product_id, canonical_name, category, store_product_id, store, store_product_name, store_sku, store_url, price, was_price, on_promotion, observed_at, source, relationship_type, freshness_state').in('canonical_product_id', suppliedIds)]
      : [];
    const [productResults, priceResults] = await Promise.all([
      Promise.all([...seedProductQueries, ...suppliedProductQuery]),
      Promise.all([...seedPriceQueries, ...suppliedPriceQuery]),
    ]);
    const failed = [...productResults, ...priceResults].find(result => result.error)?.error;
    if (failed) throw new Error(`Unable to batch-resolve household-shop products: ${failed.message}`);

    const catalogueRows = uniqueBy(
      productResults.flatMap(result => result.data ?? []) as Array<{ id: string; canonical_name: string; category: string | null }>,
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

    const resolutionCounts = shop.items.reduce((counts, item) => {
      counts[item.coverage_status] += 1;
      return counts;
    }, { resolved: 0, partial: 0, unavailable: 0, unresolved: 0 });
    const { error: telemetryError } = await agentSupabase.from('agent_events').insert({
      event_type: 'household_shop_resolution_completed',
      metadata: {
        total_lines: shop.items.length,
        ...resolutionCounts,
        catalogue_candidates: catalogueProducts.length,
        price_candidates: priceRows.length,
        query_chunks: seedChunks.length,
        duration_ms: Date.now() - startedAt,
      },
    });
    if (telemetryError) console.warn('[household-shop-resolution] telemetry insert failed', telemetryError.message);

    return { kind: 'household_shop' as const, shop };
  },
});
