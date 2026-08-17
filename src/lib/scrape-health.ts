import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Freshness targets per store (days)
const FRESHNESS_TARGETS: Record<string, number> = {
  tesco:     14,
  supervalu:  7,
  dunnes:     7,
  aldi:       7,
};

export async function getStalePrices(
  storeSlug: string,
  daysThreshold: number
): Promise<{ count: number; oldest: Date | null }> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });

  const cutoff = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000).toISOString();

  // Get all resolved store_products for this store
  const { data: sps } = await supabase
    .from('store_products')
    .select('id')
    .eq('store', storeSlug)
    .eq('url_status', 'resolved');

  if (!sps || sps.length === 0) return { count: 0, oldest: null };

  const ids = sps.map(sp => sp.id);

  // For each store_product, find the most recent price_observation
  // Count those where the latest is older than the cutoff
  let staleCount = 0;
  let oldestDate: Date | null = null;

  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data: obs } = await supabase
      .from('price_observations')
      .select('store_product_id, observed_at')
      .in('store_product_id', chunk)
      .order('observed_at', { ascending: false });

    if (!obs) continue;

    // Build latest-per-product map
    const latestMap = new Map<string, string>();
    for (const o of obs) {
      if (!latestMap.has(o.store_product_id)) {
        latestMap.set(o.store_product_id, o.observed_at);
      }
    }

    for (const id of chunk) {
      const latest = latestMap.get(id);
      if (!latest || latest < cutoff) {
        staleCount++;
        if (latest) {
          const d = new Date(latest);
          if (!oldestDate || d < oldestDate) oldestDate = d;
        }
      }
    }
  }

  return { count: staleCount, oldest: oldestDate };
}

export { FRESHNESS_TARGETS };
