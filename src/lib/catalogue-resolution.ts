import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';

export interface CatalogueCandidate {
  canonical_name: string;
  category: string | null;
  score: number;
  best_price: number | null;
  best_store: string | null;
  on_promotion: boolean;
  stores: Array<{
    store: string;
    price: number;
    was_price: number | null;
    on_promotion: boolean;
    store_product_name: string;
  }>;
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function queryTokens(query: string): string[] {
  return normalise(query)
    .split(' ')
    .filter(token => token.length >= 2);
}

/**
 * Resolve natural product wording ("Hellmann's mayonnaise") to our canonical
 * catalogue. The LLM may choose between close candidates, but catalogue
 * lookup and scoring remain deterministic and price-grounded.
 */
export async function resolveCatalogueProduct(
  query: string,
  limit = 5,
): Promise<CatalogueCandidate[]> {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];

  // Use the most distinctive token as a bounded PostgREST filter, then score
  // all returned rows locally. Alphanumeric-only tokenisation avoids filter
  // injection and wildcard surprises.
  const seed = [...tokens].sort((a, b) => b.length - a.length)[0];
  const { data, error } = await supabaseAdmin
    .from('latest_prices')
    .select('canonical_name, category, store, store_product_name, price, was_price, on_promotion')
    .or(`canonical_name.ilike.%${seed}%,store_product_name.ilike.%${seed}%`)
    .limit(200);

  if (error) throw new Error(`Catalogue lookup failed: ${error.message}`);

  type Row = {
    canonical_name: string;
    category: string | null;
    store: string;
    store_product_name: string;
    price: number;
    was_price: number | null;
    on_promotion: boolean | null;
  };

  const grouped = new Map<string, Row[]>();
  for (const row of (data ?? []) as Row[]) {
    const rows = grouped.get(row.canonical_name) ?? [];
    rows.push(row);
    grouped.set(row.canonical_name, rows);
  }

  const scored: CatalogueCandidate[] = [];
  const queryNorm = normalise(query);

  for (const [canonicalName, rows] of grouped) {
    const canonicalNorm = normalise(canonicalName);
    const storeNames = rows.map(row => normalise(row.store_product_name)).join(' ');
    const haystack = `${canonicalNorm} ${storeNames}`;

    let score = 0;
    for (const token of tokens) {
      if (canonicalNorm.includes(token)) score += 3;
      else if (haystack.includes(token)) score += 1;
    }
    if (canonicalNorm === queryNorm) score += 10;
    if (canonicalNorm.startsWith(queryNorm) || queryNorm.startsWith(canonicalNorm)) score += 3;

    // Require the majority of meaningful query terms to be represented.
    const matchedTokens = tokens.filter(token => haystack.includes(token)).length;
    if (matchedTokens < Math.ceil(tokens.length * 0.6)) continue;

    const sortedRows = [...rows].sort((a, b) => a.price - b.price);
    const best = sortedRows[0];

    scored.push({
      canonical_name: canonicalName,
      category: rows[0]?.category ?? null,
      score,
      best_price: best?.price ?? null,
      best_store: best?.store ?? null,
      on_promotion: rows.some(row => row.on_promotion === true),
      stores: sortedRows.map(row => ({
        store: row.store,
        price: row.price,
        was_price: row.was_price,
        on_promotion: row.on_promotion === true,
        store_product_name: row.store_product_name,
      })),
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || (a.best_price ?? Infinity) - (b.best_price ?? Infinity))
    .slice(0, limit);
}

export async function getCurrentProductSnapshot(canonicalName: string) {
  const { data, error } = await supabaseAdmin
    .from('latest_prices')
    .select('canonical_name, category, store, store_product_name, price, was_price, on_promotion')
    .eq('canonical_name', canonicalName);

  if (error) throw new Error(`Current price lookup failed: ${error.message}`);

  const rows = (data ?? []) as Array<{
    canonical_name: string;
    category: string | null;
    store: string;
    store_product_name: string;
    price: number;
    was_price: number | null;
    on_promotion: boolean | null;
  }>;

  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.price - b.price);
  return {
    canonical_name: canonicalName,
    best_price: sorted[0].price,
    best_store: sorted[0].store,
    any_promotion: rows.some(row => row.on_promotion === true),
    stores: sorted.map(row => ({
      store: row.store,
      price: row.price,
      was_price: row.was_price,
      on_promotion: row.on_promotion === true,
      store_product_name: row.store_product_name,
    })),
    captured_at: new Date().toISOString(),
  };
}
