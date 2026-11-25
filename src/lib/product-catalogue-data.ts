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
// The built catalogue is shared across requests. After CATALOGUE_TTL_MS (60 s, the pair-review cache TTL; prices are cached
// 10 min upstream) the NEXT request starts ONE background rebuild and is served the previous catalogue (stale-while-
// revalidate), so no visitor waits for a rebuild (5-10 s at 25 Nov 2026 catalogue size). A catalogue older than
// CATALOGUE_MAX_STALE_MS is never served: that request waits for the rebuild. The first build always blocks.
// Concurrent renders share ONE in-flight build. A failed build is never cached; the previous catalogue keeps being served
// only within the max-stale bound.
export const CATALOGUE_TTL_MS = 60_000;
export const CATALOGUE_MAX_STALE_MS = 10 * 60_000;
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
function startBuild(): Promise<Catalogue> {
  if (!building) building = buildCatalogue().finally(() => { building = null; });
  return building;
}
export const getProductCatalogue = cache(async (): Promise<Catalogue> => {
  const age = built ? Date.now() - built.at : Infinity;
  if (built && age < CATALOGUE_TTL_MS) return built.catalogue;
  if (built && age < CATALOGUE_MAX_STALE_MS) {
    // Background refresh; a failure is logged and retried by a later request (the stale copy stays bounded).
    startBuild().catch(error => console.warn('[product-catalogue] background rebuild failed', { message: error instanceof Error ? error.message : String(error) }));
    return built.catalogue;
  }
  return startBuild();
});
/** Test hook: clear the process-local catalogue cache. */
export function resetProductCatalogueCache() { built = null; building = null; }
