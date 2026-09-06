import {
  householdShopProposalSchema,
  type HouseholdShopContract,
  type HouseholdShopCoverage,
  type HouseholdShopItem,
  type HouseholdShopOffer,
  type HouseholdShopProposal,
  type TrustedCatalogueProduct,
  type TrustedHouseholdShopOfferRow,
} from './household-shop-contract';

export type GroundHouseholdShopInput = {
  proposal: unknown;
  catalogue_products: TrustedCatalogueProduct[];
  latest_prices: TrustedHouseholdShopOfferRow[];
  comparison_retailers?: string[];
  generated_at?: Date;
};

const money = (value: number) => Number(value.toFixed(2));
const DEFAULT_COMPARISON_RETAILERS = ['tesco', 'dunnes', 'supervalu'];

function trustedOffer(row: TrustedHouseholdShopOfferRow): HouseholdShopOffer | null {
  const price = Number(row.price);
  if (
    !row.canonical_product_id
    || !row.store_product_id
    || !row.store
    || !row.store_sku
    || !row.store_product_name
    || !row.observed_at
    || !row.source
    || !Number.isFinite(price)
    || price <= 0
    || row.relationship_type !== 'exact'
    || row.freshness_state !== 'fresh'
  ) return null;

  const rawWasPrice = row.was_price == null ? null : Number(row.was_price);
  const confirmedSaving = rawWasPrice != null && Number.isFinite(rawWasPrice) && rawWasPrice > price;

  return {
    retailer: row.store,
    retailer_product_id: row.store_product_id,
    retailer_sku: row.store_sku,
    retailer_product_name: row.store_product_name,
    retailer_url: row.store_url,
    current_price: money(price),
    observed_at: row.observed_at,
    source: row.source,
    promotion: {
      retailer_marked: row.on_promotion === true,
      confirmed_monetary_saving: confirmedSaving,
      was_price: confirmedSaving ? money(rawWasPrice) : null,
      saving: confirmedSaving ? money(rawWasPrice - price) : null,
    },
  };
}

function chooseOffer(offers: HouseholdShopOffer[], preferredRetailer?: string | null) {
  const preferred = preferredRetailer
    ? offers.filter(offer => offer.retailer.toLowerCase() === preferredRetailer.toLowerCase())
    : [];
  return [...(preferred.length ? preferred : offers)]
    .sort((a, b) => a.current_price - b.current_price)[0] ?? null;
}

function coverageFor(
  hasCanonicalProduct: boolean,
  offers: HouseholdShopOffer[],
  comparisonRetailers: string[],
): { status: HouseholdShopCoverage; note: string | null } {
  if (!hasCanonicalProduct) return { status: 'unresolved', note: 'No valid canonical catalogue product was resolved.' };
  if (!offers.length) return { status: 'unavailable', note: 'The product is known but has no trusted current retailer offer.' };
  const covered = new Set(offers.map(offer => offer.retailer.toLowerCase()));
  const missing = comparisonRetailers.filter(retailer => !covered.has(retailer.toLowerCase()));
  if (missing.length) return { status: 'partial', note: `No trusted current offer from ${missing.join(', ')}.` };
  return { status: 'resolved', note: null };
}

export function groundHouseholdShop(input: GroundHouseholdShopInput): HouseholdShopContract {
  const proposal: HouseholdShopProposal = householdShopProposalSchema.parse(input.proposal);
  const sectionIds = new Set(proposal.sections.map(section => section.id));
  if (sectionIds.size !== proposal.sections.length) throw new Error('Duplicate section id.');
  const lineIds = new Set<string>();
  for (const item of proposal.items) {
    if (!sectionIds.has(item.section_id)) throw new Error(`Unknown section_id: ${item.section_id}`);
    if (lineIds.has(item.line_id)) throw new Error(`Duplicate line_id: ${item.line_id}`);
    lineIds.add(item.line_id);
  }

  const catalogue = new Map(input.catalogue_products.map(product => [product.canonical_product_id, product]));
  const comparisonRetailers = [...new Set(
    (input.comparison_retailers?.length ? input.comparison_retailers : DEFAULT_COMPARISON_RETAILERS)
      .map(retailer => retailer.trim())
      .filter(Boolean),
  )];
  const offersByProduct = new Map<string, HouseholdShopOffer[]>();
  for (const row of input.latest_prices) {
    if (!catalogue.has(row.canonical_product_id)) continue;
    const offer = trustedOffer(row);
    if (!offer) continue;
    const offers = offersByProduct.get(row.canonical_product_id) ?? [];
    const duplicate = offers.findIndex(existing => existing.retailer.toLowerCase() === offer.retailer.toLowerCase());
    if (duplicate === -1) offers.push(offer);
    else if (offer.current_price < offers[duplicate].current_price) offers[duplicate] = offer;
    offersByProduct.set(row.canonical_product_id, offers);
  }

  const items: HouseholdShopItem[] = proposal.items.map(item => {
    const product = item.canonical_product_id ? catalogue.get(item.canonical_product_id) : undefined;
    const offers = product
      ? [...(offersByProduct.get(product.canonical_product_id) ?? [])]
        .sort((a, b) => a.current_price - b.current_price)
      : [];
    const selectedOffer = chooseOffer(offers, item.preferred_retailer);
    const coverage = coverageFor(Boolean(product), offers, comparisonRetailers);

    return {
      ...item,
      canonical_product_id: product?.canonical_product_id ?? null,
      canonical_name: product?.canonical_name ?? null,
      category: product?.category ?? null,
      unresolved_need: product ? item.unresolved_need ?? null : item.unresolved_need ?? item.display_label,
      candidate_offers: offers,
      selected_offer: selectedOffer,
      coverage_status: coverage.status,
      coverage_note: coverage.note,
      line_total: selectedOffer ? money(selectedOffer.current_price * item.quantity) : null,
    };
  });

  const selectedByRetailer = new Map<string, { retailer: string; total: number; lines: number; units: number }>();
  for (const item of items) {
    if (!item.selected_offer || item.line_total == null) continue;
    const retailer = item.selected_offer.retailer;
    const row = selectedByRetailer.get(retailer) ?? { retailer, total: 0, lines: 0, units: 0 };
    row.total += item.line_total;
    row.lines += 1;
    row.units += item.quantity;
    selectedByRetailer.set(retailer, row);
  }

  const storeCoverage = comparisonRetailers.map(retailer => {
    let total = 0;
    const missing: string[] = [];
    for (const item of items) {
      const offer = item.candidate_offers.find(candidate => candidate.retailer.toLowerCase() === retailer.toLowerCase());
      if (!offer) missing.push(item.line_id);
      else total += offer.current_price * item.quantity;
    }
    const complete = missing.length === 0;
    return {
      retailer,
      covered_lines: items.length - missing.length,
      total_lines: items.length,
      complete,
      basket_total: complete ? money(total) : null,
      missing_line_ids: missing,
    };
  }).sort((a, b) => Number(b.complete) - Number(a.complete) || (a.basket_total ?? Infinity) - (b.basket_total ?? Infinity));

  const bestCompleteStore = storeCoverage.find(store => store.complete);
  const pricedLines = items.filter(item => item.selected_offer).length;
  const strategy = bestCompleteStore
    ? {
        kind: 'single_retailer' as const,
        retailer: bestCompleteStore.retailer,
        rationale: `${bestCompleteStore.retailer} has trusted current offers for every shop line.`,
      }
    : pricedLines === items.length
      ? {
          kind: 'mixed_retailer' as const,
          retailer: null,
          rationale: 'No single retailer has trusted current coverage for every line; selected offers span retailers.',
        }
      : {
          kind: 'insufficient_coverage' as const,
          retailer: null,
          rationale: 'One or more shop lines are unresolved or lack a trusted current offer.',
        };

  return {
    schema_version: proposal.schema_version,
    household: proposal.household,
    sections: proposal.sections,
    items,
    totals: {
      selected_total: money(items.reduce((sum, item) => sum + (item.line_total ?? 0), 0)),
      priced_lines: pricedLines,
      total_lines: items.length,
      currency: 'EUR',
      by_selected_retailer: [...selectedByRetailer.values()].map(row => ({ ...row, total: money(row.total) })),
    },
    store_coverage: storeCoverage,
    missing_or_uncertain_items: items
      .filter(item => item.coverage_status !== 'resolved')
      .map(item => ({
        line_id: item.line_id,
        display_label: item.display_label,
        status: item.coverage_status,
        reason: item.coverage_note ?? 'Retailer coverage is incomplete.',
      })),
    recommended_retailer_strategy: strategy,
    provenance: {
      generated_at: (input.generated_at ?? new Date()).toISOString(),
      price_boundary: 'latest_prices',
      totals_calculated_by: 'server',
      decision_trace: items.map(item => ({
        line_id: item.line_id,
        outcome: item.coverage_status,
        canonical_product_id: item.canonical_product_id,
        selected_retailer: item.selected_offer?.retailer ?? null,
        reason: item.coverage_note ?? 'Canonical identity and requested retailer coverage were validated.',
      })),
    },
  };
}
