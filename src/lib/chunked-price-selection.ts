import { supabaseAdmin } from '@/lib/supabase';

const PREVIOUS_PRICE_CHUNK_SIZE = 100;

type PreviousPriceRow = {
  store_product_id: string;
  price: number;
  observed_at: string;
};

export async function loadLatestPreviousPrices(ids: string[], storeLabel: string) {
  const latest = new Map<string, number>();

  for (let i = 0; i < ids.length; i += PREVIOUS_PRICE_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + PREVIOUS_PRICE_CHUNK_SIZE);
    const { data, error } = await supabaseAdmin
      .from('price_observations')
      .select('store_product_id, price, observed_at')
      .in('store_product_id', chunk)
      .order('observed_at', { ascending: false });

    if (error) throw new Error(`Failed loading ${storeLabel} previous prices: ${error.message}`);

    for (const observation of (data ?? []) as PreviousPriceRow[]) {
      if (!latest.has(observation.store_product_id)) {
        latest.set(observation.store_product_id, observation.price);
      }
    }
  }

  return latest;
}
