import type { ResolvedProduct, RetailerOffer } from './contracts';

export type CataloguePriceRow = {
  canonical_name: string;
  category: string | null;
  store: string;
  store_product_name: string;
  price: number;
  was_price: number | null;
  on_promotion: boolean | null;
};

export function normaliseCatalogueText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function getCatalogueQueryTokens(query: string): string[] {
  return normaliseCatalogueText(query)
    .split(' ')
    .filter(token => token.length >= 2);
}

export function getCatalogueSeed(query: string): string | null {
  const tokens = getCatalogueQueryTokens(query);
  if (!tokens.length) return null;
  return [...tokens].sort((a, b) => b.length - a.length)[0] ?? null;
}

export function resolveCatalogueRows(
  query: string,
  rows: CataloguePriceRow[],
  limit = 5,
): ResolvedProduct[] {
  const tokens = getCatalogueQueryTokens(query);
  if (!tokens.length) return [];

  const grouped = new Map<string, CataloguePriceRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.canonical_name) ?? [];
    existing.push(row);
    grouped.set(row.canonical_name, existing);
  }

  const queryNorm = normaliseCatalogueText(query);
  const scored: ResolvedProduct[] = [];

  for (const [canonicalName, productRows] of grouped) {
    const canonicalNorm = normaliseCatalogueText(canonicalName);
    const storeNames = productRows
      .map(row => normaliseCatalogueText(row.store_product_name))
      .join(' ');
    const haystack = `${canonicalNorm} ${storeNames}`;

    let score = 0;
    for (const token of tokens) {
      if (canonicalNorm.includes(token)) score += 3;
      else if (haystack.includes(token)) score += 1;
    }
    if (canonicalNorm === queryNorm) score += 10;
    if (canonicalNorm.startsWith(queryNorm) || queryNorm.startsWith(canonicalNorm)) score += 3;

    const matchedTokens = tokens.filter(token => haystack.includes(token)).length;
    if (matchedTokens < Math.ceil(tokens.length * 0.6)) continue;

    const sortedRows = [...productRows].sort((a, b) => Number(a.price) - Number(b.price));
    const best = sortedRows[0];
    const offers: RetailerOffer[] = sortedRows.map(row => ({
      retailer: row.store,
      retailer_product_name: row.store_product_name,
      price: Number(row.price),
      was_price: row.was_price == null ? null : Number(row.was_price),
      on_promotion: row.on_promotion === true,
    }));

    scored.push({
      canonical_name: canonicalName,
      category: productRows[0]?.category ?? null,
      score,
      best_price: best ? Number(best.price) : null,
      best_store: best?.store ?? null,
      on_promotion: productRows.some(row => row.on_promotion === true),
      offers,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || (a.best_price ?? Infinity) - (b.best_price ?? Infinity))
    .slice(0, limit);
}
