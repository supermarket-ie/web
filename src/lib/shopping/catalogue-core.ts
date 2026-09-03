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

  // A possessive first token is normally a brand (for example, Hellmann's),
  // and is safer as the initial catalogue seed than the following generic noun.
  if (/^[^\s]+['’]s\b/i.test(query.trim()) && tokens[0]) return tokens[0];

  return [...tokens].sort((a, b) => b.length - a.length)[0] ?? null;
}

function catalogueTokenMatches(token: string, queryToken: string): boolean {
  if (token === queryToken) return true;
  if (token === `${queryToken}s`) return true;
  if (queryToken.endsWith('s') && queryToken.slice(0, -1) === token) return true;
  if (/(?:o|s|x|ch|sh)$/.test(queryToken) && token === `${queryToken}es`) return true;
  return false;
}

function stripPackSuffix(tokens: string[]): string[] {
  const result = [...tokens];
  while (result.length > 0) {
    const token = result[result.length - 1];
    if (/^\d+(?:\.\d+)?(?:g|kg|ml|l|cl|oz)?$/.test(token) || /^(?:pack|pk|each)$/.test(token)) {
      result.pop();
      continue;
    }
    break;
  }
  return result;
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
  const queryPhrase = ` ${queryNorm} `;
  const boundaryCategoryCounts = new Map<string, number>();
  for (const [canonicalName, productRows] of grouped) {
    const titleCore = stripPackSuffix(normaliseCatalogueText(canonicalName).split(' ').filter(Boolean));
    const coreHead = titleCore.slice(0, tokens.length);
    const coreTail = titleCore.slice(-tokens.length);
    const isBoundaryMatch = tokens.length > 0 && (
      tokens.every((token, index) => catalogueTokenMatches(coreHead[index] ?? '', token))
      || tokens.every((token, index) => catalogueTokenMatches(coreTail[index] ?? '', token))
    );
    if (!isBoundaryMatch) continue;
    const category = normaliseCatalogueText(productRows[0]?.category ?? '');
    if (category) boundaryCategoryCounts.set(category, (boundaryCategoryCounts.get(category) ?? 0) + 1);
  }
  const strongestCategoryCount = Math.max(0, ...boundaryCategoryCounts.values());
  const scored: ResolvedProduct[] = [];

  for (const [canonicalName, productRows] of grouped) {
    const canonicalNorm = normaliseCatalogueText(canonicalName);
    const canonicalTokens = canonicalNorm.split(' ').filter(Boolean);
    const paddedCanonical = ` ${canonicalNorm} `;
    const storeNames = productRows.map(row => normaliseCatalogueText(row.store_product_name)).join(' ');
    const haystack = `${canonicalNorm} ${storeNames}`;

    let score = 0;
    for (const token of tokens) {
      if (canonicalTokens.some(candidateToken => catalogueTokenMatches(candidateToken, token))) score += 8;
      else if (canonicalNorm.includes(token)) score += 2;
      else if (haystack.includes(token)) score += 1;
    }
    if (canonicalNorm === queryNorm) score += 30;
    if (paddedCanonical.includes(queryPhrase)) score += 8;
    if (canonicalNorm.startsWith(`${queryNorm} `) || canonicalNorm.endsWith(` ${queryNorm}`)) score += 3;

    const titleCore = stripPackSuffix(canonicalTokens);
    const coreHead = titleCore.slice(0, tokens.length);
    const coreTail = titleCore.slice(-tokens.length);
    const isProductHead = tokens.length > 0
      && tokens.every((token, index) => catalogueTokenMatches(coreHead[index] ?? '', token));
    const isProductTail = tokens.length > 0
      && tokens.every((token, index) => catalogueTokenMatches(coreTail[index] ?? '', token));

    // In grocery titles the product noun is most often the final semantic token
    // before size/pack data ("whole milk 2L", "ground coffee 227g"). Give that
    // position a modest edge over incidental compounds beginning with the same
    // word ("milk & honey shower cream", "coffee chocolate biscuits"). Concise
    // product-headed titles still win where the noun genuinely belongs first.
    if (isProductTail) score += 13;
    else if (isProductHead) score += 10;

    const category = normaliseCatalogueText(productRows[0]?.category ?? '');
    const categoryCount = boundaryCategoryCounts.get(category) ?? 0;
    if (strongestCategoryCount > 0) score += (categoryCount / strongestCategoryCount) * 8;

    score -= Math.max(0, canonicalTokens.length - tokens.length) * 0.75;

    const haystackTokens = haystack.split(' ').filter(Boolean);
    const matchedTokens = tokens.filter(token => (
      haystackTokens.some(candidateToken => catalogueTokenMatches(candidateToken, token))
      || haystack.includes(token)
    )).length;
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
