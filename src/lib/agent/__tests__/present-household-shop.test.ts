import './setup-env';
import { describe, expect, it, vi } from 'vitest';
import {
  HOUSEHOLD_SHOP_SCHEMA_VERSION,
  householdShopToolOutputSchema,
  type HouseholdShopProposal,
} from '../../shopping/household-shop-contract';

/**
 * Proves the present_household_shop tool returns exactly
 * { kind:'household_shop', shop } and that the shop validates against the SAME
 * `householdShopToolOutputSchema` the frontend contract is built on — so the
 * `dynamic-tool` output part will carry a contract-valid payload.
 *
 * The catalogue Supabase client is mocked so no database is touched; it returns
 * a trusted product + two fresh retailer offers for a single butter line.
 */

const PRODUCT_ID = '11111111-1111-1111-1111-111111111111';

function priceRow(store: string, price: number) {
  return {
    canonical_product_id: PRODUCT_ID,
    canonical_name: 'Irish Butter 454g',
    category: 'dairy',
    store_product_id: `sp-${store}`,
    store,
    store_product_name: 'Irish Butter 454g',
    store_sku: `sku-${store}`,
    store_url: `https://example.ie/${store}`,
    price,
    was_price: null,
    on_promotion: false,
    observed_at: new Date().toISOString(),
    source: `${store}_direct`,
    relationship_type: 'exact',
    freshness_state: 'fresh',
  };
}

// A chainable query-builder stub whose terminal awaits resolve to our fixtures.
function queryResult(table: string) {
  const data =
    table === 'products'
      ? [{ id: PRODUCT_ID, canonical_name: 'Irish Butter 454g', category: 'dairy' }]
      : [priceRow('tesco', 3.49), priceRow('dunnes', 3.29), priceRow('supervalu', 3.59)];
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.or = chain;
  builder.in = chain;
  builder.limit = () => Promise.resolve({ data, error: null });
  // Also resolve directly if awaited without .limit (supplied-id .in path).
  builder.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
    resolve({ data, error: null });
  return builder;
}

vi.mock('../supabase', () => ({
  catalogueSupabase: { from: (table: string) => queryResult(table) },
}));

const proposal: HouseholdShopProposal = {
  schema_version: HOUSEHOLD_SHOP_SCHEMA_VERSION,
  household: {
    adults: 2,
    children: 1,
    dietary_requirements: [],
    budget: null,
    planning_period: { days: 7, label: 'This week' },
    assumptions_made: [],
  },
  sections: [{ id: 'dairy', label: 'Dairy', kind: 'food' }],
  items: [
    {
      line_id: 'line-1',
      section_id: 'dairy',
      canonical_product_id: PRODUCT_ID,
      display_label: 'Irish butter',
      quantity: 1,
      unit_or_pack_expectation: '454g block',
      reason: 'Weekly staple',
    },
  ],
};

describe('present_household_shop tool output', () => {
  it('returns { kind: household_shop, shop } that validates against the contract schema', async () => {
    const { buildAgentTools } = await import('../tools');
    const tools = buildAgentTools({ subscriberId: 'sub-1' });
    const present = tools.present_household_shop;

    const output = (await present.execute!(proposal, {
      toolCallId: 'call-1',
      messages: [],
    } as never)) as import('../../shopping/household-shop-contract').HouseholdShopToolOutput;

    expect(output.kind).toBe('household_shop');
    // The FULL output object must satisfy the frontend contract schema.
    const parsed = householdShopToolOutputSchema.safeParse(output);
    expect(parsed.success).toBe(true);

    // Price truth preserved: the butter line is priced from the trusted offers
    // and the cheapest complete retailer basket is recommended.
    expect(output.shop.totals.total_lines).toBe(1);
    expect(output.shop.items[0].selected_offer?.current_price).toBe(3.29);
    expect(output.shop.recommended_retailer_strategy.kind).toBe('single_retailer');
    expect(output.shop.provenance.price_boundary).toBe('latest_prices');
  });
});
