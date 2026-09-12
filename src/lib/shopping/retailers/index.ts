import type { RetailerAdapter } from './adapter';
import { superValuAdapter } from './supervalu';

const adapters = new Map<string, RetailerAdapter>([
  [superValuAdapter.retailer, superValuAdapter],
]);

export function getRetailerAdapter(retailer: string): RetailerAdapter | null {
  return adapters.get(retailer.toLowerCase()) ?? null;
}

export { superValuAdapter } from './supervalu';
export type { RetailerAdapter, RetailerAdapterContext } from './adapter';
