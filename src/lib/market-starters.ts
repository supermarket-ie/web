import type { ProductPrice } from '@/lib/price-data';
import { fallbackStarters, type MarketStarter } from '@/lib/market-starter-options';

/**
 * Homepage starters are deliberately stable in v3.
 *
 * Live catalogue and price intelligence belongs inside the agent after a visitor
 * chooses a job. Keeping the entry points independent of current price rows gives
 * us durable tracking IDs and a clean conversion experiment.
 */
export function buildMarketStarters(_prices: ProductPrice[] = [], _rotationWindow = 0): MarketStarter[] {
  return fallbackStarters();
}
