import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from './supabase';
import { getAllLatestPrices } from './price-data';
import { buildProductCatalogue, type CatalogueRecord } from './product-catalogue';
import { getCurrentPairReviews } from './comparison-reviews';
import { isPreviewEnv } from './runtime-env';

const getProductRecords = unstable_cache(async (): Promise<CatalogueRecord[]> => {
  if (process.env.CI === 'true' && process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://example.supabase.co') return [];
  const records: CatalogueRecord[] = [];
  try {
    while (true) {
      const { data, error } = await supabaseAdmin.from('products')
        .select('id,canonical_name,category,description,image_url,brand,created_at')
        .order('id').range(records.length, records.length + 999);
      if (error) throw new Error(`Product catalogue unavailable: ${error.message}`);
      if (!data?.length) break;
      records.push(...data);
    }
  } catch (error) {
    // Preview-only: never fail a build/render because the ISOLATED preview DB is
    // briefly unreachable. Returns an EMPTY catalogue (never substitutes data),
    // so it cannot weaken production — production still throws fail-closed.
    if (isPreviewEnv()) {
      console.warn('[product-catalogue] preview: catalogue unavailable, rendering empty', {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
    throw error;
  }
  return records;
}, ['public-product-records-v1'], { revalidate: 1800 });

// Metadata, page content and discovery all use the same identities and guarded prices.
// The built catalogue is shared across requests for at most CATALOGUE_TTL_MS (60 s, the pair-review cache TTL;
// prices are cached 10 min upstream), so freshness and verification are re-evaluated at least every minute.
// Concurrent renders share ONE in-flight build instead of each rebuilding the whole catalogue on one vCPU.
// A failed build is never cached.
export const CATALOGUE_TTL_MS = 60_000;
type Catalogue = ReturnType<typeof buildProductCatalogue>;
let built: { at: number; catalogue: Catalogue } | null = null;
let building: Promise<Catalogue> | null = null;
async function buildCatalogue(): Promise<Catalogue> {
  const [records, prices, reviews] = await Promise.all([getProductRecords(), getAllLatestPrices(), getCurrentPairReviews()]);
  const at = Date.now();
  const catalogue = buildProductCatalogue(records, prices, at, reviews);
  built = { at, catalogue };
  return catalogue;
}
export const getProductCatalogue = cache(async (): Promise<Catalogue> => {
  if (built && Date.now() - built.at < CATALOGUE_TTL_MS) return built.catalogue;
  if (!building) building = buildCatalogue().finally(() => { building = null; });
  return building;
});
/** Test hook: clear the process-local catalogue cache. */
export function resetProductCatalogueCache() { built = null; building = null; }
