import { defineTool } from 'eve/tools';
import { householdShopProposalSchema } from '../../src/lib/shopping/household-shop-contract';
import { groundHouseholdShop } from '../../src/lib/shopping/household-shop';
import { agentSupabase } from '../lib/supabase';

export default defineTool({
  description: `Present a complete household shop in Supermarket.ie’s native structured shopping UI. Use this for complete, weekly or value-led household-shop outcomes after the household assumptions are known. Resolve exact catalogue products first when practical and pass their canonical_product_id values. Leave uncertain needs unresolved rather than inventing an ID. This tool owns current prices, promotion truth, totals and retailer coverage; never write those values in the input. After calling it, introduce the result briefly instead of repeating every shop line in prose.`,
  inputSchema: householdShopProposalSchema,
  async execute(proposal) {
    const canonicalIds = [...new Set(
      proposal.items
        .map(item => item.canonical_product_id)
        .filter((id): id is string => Boolean(id)),
    )];

    const [catalogueResult, pricesResult] = canonicalIds.length
      ? await Promise.all([
          agentSupabase
            .from('products')
            .select('id, canonical_name, category')
            .in('id', canonicalIds),
          agentSupabase
            .from('latest_prices')
            .select('canonical_product_id, canonical_name, category, store_product_id, store, store_product_name, store_sku, store_url, price, was_price, on_promotion, observed_at, source, relationship_type, freshness_state')
            .in('canonical_product_id', canonicalIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

    if (catalogueResult.error) throw new Error(`Unable to validate household-shop products: ${catalogueResult.error.message}`);
    if (pricesResult.error) throw new Error(`Unable to ground household-shop prices: ${pricesResult.error.message}`);

    const shop = groundHouseholdShop({
      proposal,
      catalogue_products: (catalogueResult.data ?? []).map(product => ({
        canonical_product_id: String(product.id),
        canonical_name: product.canonical_name,
        category: product.category ?? null,
      })),
      latest_prices: (pricesResult.data ?? []).map(offer => ({
        canonical_product_id: String(offer.canonical_product_id),
        canonical_name: offer.canonical_name,
        category: offer.category ?? null,
        store_product_id: String(offer.store_product_id),
        store: offer.store,
        store_product_name: offer.store_product_name,
        store_sku: offer.store_sku,
        store_url: offer.store_url ?? null,
        price: Number(offer.price),
        was_price: offer.was_price == null ? null : Number(offer.was_price),
        on_promotion: offer.on_promotion === true,
        observed_at: offer.observed_at,
        source: offer.source,
        relationship_type: offer.relationship_type as 'exact',
        freshness_state: offer.freshness_state as 'fresh',
      })),
      comparison_retailers: ['tesco', 'dunnes', 'supervalu'],
    });

    return { kind: 'household_shop' as const, shop };
  },
});
