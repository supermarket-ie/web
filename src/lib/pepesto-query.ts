import type { TescoQueueProduct } from './tesco-queue-worker';

export function pepestoSearchQuery(products: TescoQueueProduct[]) {
  if (products.length !== 1) {
    throw new Error('Pepesto Tesco search requires exactly one independently attributable product');
  }
  const product = products[0];
  return product.discoveryMode === 'audited_candidate_discovery'
    ? product.canonicalName
    : product.storeProductName || product.canonicalName;
}
