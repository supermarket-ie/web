import { getAllLatestPrices } from '@/lib/price-data';
import { buildHomepageExample } from '@/lib/homepage-shop-example';
import { ProductProofContent } from './ProductProofContent';

export async function ProductProofSection() {
  let example;
  try {
    example = buildHomepageExample(await getAllLatestPrices());
  } catch {
    // An unavailable price dependency must not take the agent homepage down.
    console.warn('[homepage-example] Trusted prices unavailable; displaying unpriced intentions');
    example = buildHomepageExample([]);
  }
  return <ProductProofContent example={example} />;
}

export function ProductProofLoading() {
  return <ProductProofContent example={buildHomepageExample([])} loading />;
}
