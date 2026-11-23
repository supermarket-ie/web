import type { SupabaseClient } from '@supabase/supabase-js';

/** Page size of the paged fallback; equals PostgREST's server row cap (Supabase max_rows = 1000). */
export const PAIR_STATUS_PAGE = 1000;

// Only "function does not exist" means a migration is not applied; every other error is returned to the caller.
const isMissingFunction = (error: { code?: string } | null) => !!error && (error.code === 'PGRST202' || error.code === '42883');

/**
 * Every row of current_pair_review_status(now(), activeOnly) in ONE database execution (migration 20261125090000,
 * current_pair_review_status_json). Until that migration is applied, falls back to the paged read, which re-runs
 * the status function once per 1,000-row page and stops at the first short page.
 * Returns null only when the status function itself does not exist; any other error throws.
 */
export async function readPairStatusRows<T = Record<string, unknown>>(sb: SupabaseClient, activeOnly: boolean): Promise<T[] | null> {
  const single = await sb.rpc('current_pair_review_status_json', { p_active_only: activeOnly });
  if (!single.error) {
    if (!Array.isArray(single.data)) throw new Error('current_pair_review_status_json did not return an array');
    return single.data as T[];
  }
  if (!isMissingFunction(single.error)) throw single.error;
  const rows: T[] = [];
  for (let from = 0; ;) {
    const { data, error } = await sb.rpc('current_pair_review_status', { p_active_only: activeOnly }).range(from, from + PAIR_STATUS_PAGE - 1);
    if (isMissingFunction(error)) return null;
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAIR_STATUS_PAGE) break;
    from += data.length;
  }
  return rows;
}
