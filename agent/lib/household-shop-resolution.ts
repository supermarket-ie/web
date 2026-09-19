import {
  getCatalogueSeed,
  normaliseCatalogueText,
  resolveCatalogueRows,
  type CataloguePriceRow,
} from '../../src/lib/shopping/catalogue-core';
import type {
  HouseholdShopProposal,
  TrustedCatalogueProduct,
} from '../../src/lib/shopping/household-shop-contract';

const MIN_CLEAR_MATCH_SCORE = 18;

function itemQueries(item: HouseholdShopProposal['items'][number]) {
  const display = item.display_label.trim();
  const withPack = `${display} ${item.unit_or_pack_expectation}`.trim();
  return normaliseCatalogueText(display) === normaliseCatalogueText(withPack)
    ? [display]
    : [display, withPack];
}

function clearResolvedId(query: string, rows: CataloguePriceRow[]) {
  const candidates = resolveCatalogueRows(query, rows, 2);
  const top = candidates[0];
  if (!top?.canonical_product_id || top.score < MIN_CLEAR_MATCH_SCORE) return null;

  const exact = normaliseCatalogueText(top.canonical_name) === normaliseCatalogueText(query);
  const second = candidates[1];
  const scoreGap = second ? top.score - second.score : Number.POSITIVE_INFINITY;
  return exact || scoreGap >= 8 ? String(top.canonical_product_id) : null;
}

/**
 * Resolve a complete proposed shop in one deterministic pass. The model may
 * still provide exact IDs, but missing or invalid IDs no longer require one
 * tool call per line. Only exact catalogue-name matches or clearly separated
 * current-offer matches are accepted; ambiguous families remain unresolved.
 */
export function resolveHouseholdShopProposal(
  proposal: HouseholdShopProposal,
  catalogueProducts: TrustedCatalogueProduct[],
  priceRows: CataloguePriceRow[],
): HouseholdShopProposal {
  const productsById = new Map(catalogueProducts.map(product => [product.canonical_product_id, product]));
  const exactNames = new Map<string, TrustedCatalogueProduct[]>();

  for (const product of catalogueProducts) {
    const key = normaliseCatalogueText(product.canonical_name);
    const matches = exactNames.get(key) ?? [];
    matches.push(product);
    exactNames.set(key, matches);
  }

  return {
    ...proposal,
    items: proposal.items.map(item => {
      if (item.canonical_product_id && productsById.has(item.canonical_product_id)) return item;

      const queries = itemQueries(item);
      let resolvedId: string | null = null;

      for (const query of queries) {
        const exact = exactNames.get(normaliseCatalogueText(query)) ?? [];
        if (exact.length === 1) {
          resolvedId = exact[0].canonical_product_id;
          break;
        }
      }

      if (!resolvedId) {
        for (const query of queries) {
          resolvedId = clearResolvedId(query, priceRows);
          if (resolvedId) break;
        }
      }

      return resolvedId
        ? { ...item, canonical_product_id: resolvedId }
        : { ...item, canonical_product_id: null, unresolved_need: item.unresolved_need ?? item.display_label };
    }),
  };
}

export function householdShopResolutionSeeds(proposal: HouseholdShopProposal) {
  return [...new Set(proposal.items.flatMap(item => itemQueries(item).map(getCatalogueSeed).filter((seed): seed is string => Boolean(seed))))];
}
