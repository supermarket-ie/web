import { supabaseAdmin } from '@/lib/supabase';
import { validPairReview, type PairReview } from './comparison-policy';

const HORIZON_MS = 14 * 86400000;
/** Reviews change only through the protected postgres insert, so a short process-local cache is safe. */
const CACHE_TTL_MS = 60_000;
let cached: { at: number; reviews: PairReview[] } | null = null;
let warned = false;

/**
 * A separate read-only, evidence-bound relationship ledger. This never changes
 * latest_prices, store_products, trusted collection receipts or mapping status.
 * Until its protected migration is installed (or when evidence is missing),
 * all multi-retailer groups remain unverified. Reads are cached for 60s and
 * limited in SQL to the 14-day evidence horizon; failure returns [] (fail closed).
 */
export async function getCurrentPairReviews(now = Date.now()): Promise<PairReview[]> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.reviews.filter(review => validPairReview(review, now));
  try {
    const all: PairReview[] = [];
    const since = new Date(now - HORIZON_MS).toISOString();
    for (let from = 0; ; from += 500) {
      const { data, error } = await supabaseAdmin.from('retailer_offer_pair_reviews')
        .select('left_offer_id,right_offer_id,classification,left_source_hash,right_source_hash,left_captured_at,right_captured_at,reviewed_at,rationale,reviewer')
        .gte('reviewed_at', since)
        .order('reviewed_at', { ascending: false }).range(from, from + 499);
      if (error) throw error;
      if (!data?.length) break;
      all.push(...data as PairReview[]);
      if (data.length < 500) break;
    }
    cached = { at: now, reviews: all };
    warned = false;
    return all.filter(review => validPairReview(review, now));
  } catch (error) {
    // Price availability is separate from pairwise equivalence. Failure must
    // not invent approved edges, and must never downgrade latest_prices.
    if (!warned) {
      warned = true;
      console.warn('[comparison] review ledger unavailable; comparisons unverified', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
    return [];
  }
}

/** Test hook: clear the process-local cache. */
export function resetPairReviewCache() { cached = null; warned = false; }
