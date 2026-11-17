import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';

const PAGE = 1000;

/**
 * Current trusted store offers for canonical names: only `relationship_type = exact` and
 * `freshness_state = fresh` rows from latest_prices, paged past PostgREST's 1,000-row default so a large
 * basket is never silently truncated. Throws on a query error so callers fail closed.
 */
export async function fetchCurrentExactOffers<T extends Record<string, unknown>>(
  canonicalNames: string[],
  columns: string,
  stores?: string[],
): Promise<T[]> {
  const names = [...new Set(canonicalNames.filter(Boolean))];
  if (!names.length) return [];
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabaseAdmin.from('latest_prices').select(columns)
      .in('canonical_name', names)
      .eq('relationship_type', 'exact')
      .eq('freshness_state', 'fresh');
    if (stores?.length) query = query.in('store', stores);
    const { data, error } = await query.order('store_product_id').range(from, from + PAGE - 1);
    if (error) throw new Error(`latest_prices lookup failed: ${error.message}`);
    rows.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}
