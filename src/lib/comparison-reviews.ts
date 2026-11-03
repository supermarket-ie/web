import { supabaseAdmin } from '@/lib/supabase';
import { validPairReview, type PairReview } from './comparison-policy';

/**
 * A separate read-only, evidence-bound relationship ledger. This never changes
 * latest_prices, store_products, trusted collection receipts or mapping status.
 * Until its protected migration is installed (or when evidence is missing),
 * all multi-retailer groups remain unverified.
 */
export async function getCurrentPairReviews(now = Date.now()): Promise<PairReview[]> {
  try {
    const all: PairReview[] = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await supabaseAdmin.from('retailer_offer_pair_reviews')
        .select('left_offer_id,right_offer_id,classification,left_source_hash,right_source_hash,left_captured_at,right_captured_at,reviewed_at,rationale,reviewer')
        .order('reviewed_at', { ascending: false }).range(from, from + 499);
      if (error) throw error;
      if (!data?.length) break;
      all.push(...data as PairReview[]);
      if (data.length < 500) break;
    }
    return all.filter(review => validPairReview(review, now));
  } catch (error) {
    // Price availability is separate from pairwise equivalence. Failure must
    // not invent approved edges, and must never downgrade latest_prices.
    console.warn('[comparison] review ledger unavailable; comparisons unverified', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return [];
  }
}
