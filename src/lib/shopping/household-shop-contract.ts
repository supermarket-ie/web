import { z } from 'zod';

export const HOUSEHOLD_SHOP_SCHEMA_VERSION = 'household_shop.v1' as const;

export const householdShopCoverageSchema = z.enum([
  'resolved',
  'partial',
  'unresolved',
  'unavailable',
]);

export const householdShopSectionKindSchema = z.enum([
  'food',
  'drink',
  'toiletries',
  'cleaning',
  'household',
  'other',
]);

export const householdShopProposalSchema = z.object({
  schema_version: z.literal(HOUSEHOLD_SHOP_SCHEMA_VERSION),
  household: z.object({
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20).optional(),
    dietary_requirements: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    budget: z.number().positive().max(10_000).nullable().optional(),
    planning_period: z.object({
      days: z.number().int().min(1).max(31),
      label: z.string().trim().min(1).max(80),
    }),
    assumptions_made: z.array(z.string().trim().min(1).max(240)).max(30).default([]),
  }),
  sections: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(100),
    kind: householdShopSectionKindSchema,
  })).min(1).max(30),
  items: z.array(z.object({
    line_id: z.string().trim().min(1).max(100),
    section_id: z.string().trim().min(1).max(80),
    canonical_product_id: z.string().trim().min(1).max(100).nullable().optional(),
    unresolved_need: z.string().trim().min(1).max(200).nullable().optional(),
    display_label: z.string().trim().min(1).max(200),
    quantity: z.number().int().min(1).max(50),
    unit_or_pack_expectation: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(300),
    purpose: z.string().trim().min(1).max(200).nullable().optional(),
    preferred_retailer: z.string().trim().min(1).max(80).nullable().optional(),
  }).refine(
    item => Boolean(item.canonical_product_id || item.unresolved_need),
    'An item must identify a canonical product or an unresolved need.',
  )).min(1).max(200),
});

export type HouseholdShopProposal = z.infer<typeof householdShopProposalSchema>;
export type HouseholdShopCoverage = z.infer<typeof householdShopCoverageSchema>;
export type HouseholdShopSectionKind = z.infer<typeof householdShopSectionKindSchema>;

export type TrustedCatalogueProduct = {
  canonical_product_id: string;
  canonical_name: string;
  category: string | null;
};

/** A row supplied only from the trusted `latest_prices` boundary. */
export type TrustedHouseholdShopOfferRow = {
  canonical_product_id: string;
  canonical_name: string;
  category: string | null;
  store_product_id: string;
  store: string;
  store_product_name: string;
  store_sku: string;
  store_url: string | null;
  price: number;
  was_price: number | null;
  on_promotion: boolean;
  observed_at: string;
  source: string;
  relationship_type: 'exact';
  freshness_state: 'fresh';
};

export type HouseholdShopOffer = {
  retailer: string;
  retailer_product_id: string;
  retailer_sku: string;
  retailer_product_name: string;
  retailer_url: string | null;
  current_price: number;
  observed_at: string;
  source: string;
  promotion: {
    retailer_marked: boolean;
    confirmed_monetary_saving: boolean;
    was_price: number | null;
    saving: number | null;
  };
};

export type HouseholdShopItem = Omit<HouseholdShopProposal['items'][number], 'canonical_product_id'> & {
  canonical_product_id: string | null;
  canonical_name: string | null;
  category: string | null;
  candidate_offers: HouseholdShopOffer[];
  selected_offer: HouseholdShopOffer | null;
  coverage_status: HouseholdShopCoverage;
  coverage_note: string | null;
  line_total: number | null;
};

export type HouseholdShopContract = {
  schema_version: typeof HOUSEHOLD_SHOP_SCHEMA_VERSION;
  household: HouseholdShopProposal['household'];
  sections: HouseholdShopProposal['sections'];
  items: HouseholdShopItem[];
  totals: {
    selected_total: number;
    priced_lines: number;
    total_lines: number;
    currency: 'EUR';
    by_selected_retailer: Array<{ retailer: string; total: number; lines: number; units: number }>;
  };
  store_coverage: Array<{
    retailer: string;
    covered_lines: number;
    total_lines: number;
    complete: boolean;
    basket_total: number | null;
    missing_line_ids: string[];
  }>;
  missing_or_uncertain_items: Array<{
    line_id: string;
    display_label: string;
    status: HouseholdShopCoverage;
    reason: string;
  }>;
  recommended_retailer_strategy: {
    kind: 'single_retailer' | 'mixed_retailer' | 'insufficient_coverage';
    retailer: string | null;
    rationale: string;
  };
  provenance: {
    generated_at: string;
    price_boundary: 'latest_prices';
    totals_calculated_by: 'server';
    decision_trace: Array<{
      line_id: string;
      outcome: HouseholdShopCoverage;
      canonical_product_id: string | null;
      selected_retailer: string | null;
      reason: string;
    }>;
  };
};
