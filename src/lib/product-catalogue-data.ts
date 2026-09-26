import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from './supabase';
import { getAllLatestPrices } from './price-data';
import { buildProductCatalogue, type CatalogueRecord } from './product-catalogue';

const getProductRecords = unstable_cache(async (): Promise<CatalogueRecord[]> => {
  if (process.env.CI === 'true' && process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://example.supabase.co') return [];
  const records: CatalogueRecord[] = [];
  while (true) {
    const { data, error } = await supabaseAdmin.from('products')
      .select('id,canonical_name,category,description,image_url,brand,created_at')
      .order('id').range(records.length, records.length + 999);
    if (error) throw new Error(`Product catalogue unavailable: ${error.message}`);
    if (!data?.length) break;
    records.push(...data);
  }
  return records;
}, ['public-product-records-v1'], { revalidate: 1800 });

// Metadata, page content and discovery all use the same identities and guarded prices.
// Reapply freshness at render time rather than caching a derived eligibility decision.
export const getProductCatalogue = cache(async () => {
  const [records, prices] = await Promise.all([getProductRecords(), getAllLatestPrices()]);
  return buildProductCatalogue(records, prices);
});
