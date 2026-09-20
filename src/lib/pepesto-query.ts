import type { TescoQueueProduct } from './tesco-queue-worker';

export function pepestoSearchQuery(products: TescoQueueProduct[]) {
  return products.map((product) => product.discoveryMode === 'audited_candidate_discovery'
    ? product.canonicalName
    : product.storeProductName || product.canonicalName).join(', ');
}
