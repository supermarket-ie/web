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
import { hasProductIdentityConflict } from '../../src/lib/shopping/product-identity';

const MIN_CLEAR_MATCH_SCORE = 18;

export function normaliseHouseholdProductQuery(value: string) {
  return value.toLowerCase()
    .replace(/\bdozen\b/g, '12 pack')
    .replace(/\bbeef mince\b/g, 'minced beef')
    .replace(/\bsliced pan\b/g, 'sliced bread')
    .replace(/\b(?:bag|pack) of (\d+)\b/g, '$1 pack')
    .replace(/\b(?:litres?|liters?)\b/g, 'l')
    .replace(/\b(?:kilograms?)\b/g, 'kg')
    .replace(/\b(?:grams?)\b/g, 'g')
    .replace(/\b(\d+(?:\.\d+)?)\s+(kg|g|ml|l)\b/g, '$1$2')
    .replace(/\b(?:bag|bottle|carton|loaf|tin|tub|block)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function itemQueries(item: HouseholdShopProposal['items'][number]) {
  const display = normaliseHouseholdProductQuery(item.display_label);
  const withPack = normaliseHouseholdProductQuery(`${item.display_label} ${item.unit_or_pack_expectation}`);
  return [...new Set([withPack, display])];
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
    const key = normaliseCatalogueText(normaliseHouseholdProductQuery(product.canonical_name));
    const matches = exactNames.get(key) ?? [];
    matches.push(product);
    exactNames.set(key, matches);
  }

  return {
    ...proposal,
    items: proposal.items.map(item => {
      const supplied = item.canonical_product_id ? productsById.get(item.canonical_product_id) : null;
      if (supplied && !hasProductIdentityConflict(`${item.display_label} ${item.unit_or_pack_expectation}`, supplied.canonical_name)) return item;

      const queries = itemQueries(item);
      let resolvedId: string | null = null;

      for (const query of queries) {
        const exact = (exactNames.get(normaliseCatalogueText(query)) ?? []).filter(product =>
          !hasProductIdentityConflict(`${item.display_label} ${item.unit_or_pack_expectation}`, product.canonical_name));
        if (exact.length === 1) {
          resolvedId = exact[0].canonical_product_id;
          break;
        }
      }

      if (!resolvedId) {
        for (const query of queries) {
          resolvedId = clearResolvedId(query, priceRows.filter(row =>
            !hasProductIdentityConflict(`${item.display_label} ${item.unit_or_pack_expectation}`, row.canonical_name)));
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
