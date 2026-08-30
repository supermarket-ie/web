import type { StorefrontBasketContext, StorefrontRetailer } from './retailers/storefront';
import { getStorefrontExecutionConfig, prepareStorefrontBasketContext } from './retailers/storefront';

export type CheckoutRuntimeState =
  | 'prepared'
  | 'awaiting_shopper_auth'
  | 'awaiting_store_context'
  | 'populating_trolley'
  | 'trolley_ready'
  | 'failed'
  | 'expired';

export type CheckoutRuntimeItem = {
  canonicalName: string;
  retailerUrl: string;
  retailerProductId: string;
  retailerProductName: string;
  quantity: number;
  price: number;
};

export type CheckoutRuntimePlan = {
  retailer: StorefrontRetailer;
  state: 'prepared';
  executionMethod: 'controlled_browser';
  context: StorefrontBasketContext;
  items: CheckoutRuntimeItem[];
  mappedItemCount: number;
  totalItemCount: number;
  approximateValue: number;
  launchEnabled: boolean;
  launchBlocker: 'provider_not_configured' | 'retailer_runtime_unproven' | null;
};

const ALLOWED_TRANSITIONS: Record<CheckoutRuntimeState, readonly CheckoutRuntimeState[]> = {
  prepared: ['awaiting_shopper_auth', 'failed', 'expired'],
  awaiting_shopper_auth: ['awaiting_store_context', 'populating_trolley', 'failed', 'expired'],
  awaiting_store_context: ['populating_trolley', 'failed', 'expired'],
  populating_trolley: ['trolley_ready', 'failed', 'expired'],
  trolley_ready: ['expired'],
  failed: ['expired'],
  expired: [],
};

export function assertCheckoutRuntimeTransition(from: CheckoutRuntimeState, to: CheckoutRuntimeState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid checkout runtime transition: ${from} -> ${to}.`);
  }
}

export function createCheckoutRuntimePlan(input: {
  retailer: StorefrontRetailer;
  items: CheckoutRuntimeItem[];
  totalItemCount?: number;
  providerConfigured?: boolean;
}): CheckoutRuntimePlan {
  const config = getStorefrontExecutionConfig(input.retailer);
  if (!config) throw new Error(`Unsupported checkout retailer: ${input.retailer}.`);

  const context = prepareStorefrontBasketContext(
    input.retailer,
    input.items.map(item => ({
      retailer: input.retailer,
      retailerUrl: item.retailerUrl,
      retailerProductId: item.retailerProductId,
      quantity: item.quantity,
    })),
  );

  const runtimeProven = config.controlledBrowserRuntimeConfirmed;
  const providerConfigured = input.providerConfigured === true;

  return {
    retailer: input.retailer,
    state: 'prepared',
    executionMethod: 'controlled_browser',
    context,
    items: input.items,
    mappedItemCount: input.items.length,
    totalItemCount: input.totalItemCount ?? input.items.length,
    approximateValue: Number(input.items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)),
    launchEnabled: runtimeProven && providerConfigured,
    launchBlocker: !runtimeProven
      ? 'retailer_runtime_unproven'
      : providerConfigured
        ? null
        : 'provider_not_configured',
  };
}

export interface CheckoutRuntimeProvider {
  createSession(plan: CheckoutRuntimePlan): Promise<{ sessionId: string; shopperUrl: string; expiresAt: string }>;
  getState(sessionId: string): Promise<CheckoutRuntimeState>;
  destroySession(sessionId: string): Promise<void>;
}
