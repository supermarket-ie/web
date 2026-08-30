import { describe, expect, it } from 'vitest';
import {
  assertCheckoutRuntimeSessionOwner,
  assertCheckoutRuntimeTransition,
  createCheckoutRuntimePlan,
  isVerifiedTrolleyLineSnapshot,
} from './checkout-runtime';

const supervaluItems = [
  {
    canonicalName: 'Whole milk',
    retailerUrl: 'https://shop.supervalu.ie/sm/delivery/rsid/5552/product/example/1001',
    retailerProductId: '1001',
    retailerProductName: 'SuperValu Fresh Irish Whole Milk 2L',
    quantity: 2,
    price: 2.25,
  },
];

describe('Checkout Runtime v0', () => {
  it('prepares a truthful SuperValu plan but blocks launch without a provider', () => {
    const plan = createCheckoutRuntimePlan({ retailer: 'supervalu', items: supervaluItems });
    expect(plan.state).toBe('prepared');
    expect(plan.executionMethod).toBe('controlled_browser');
    expect(plan.approximateValue).toBe(4.5);
    expect(plan.launchEnabled).toBe(false);
    expect(plan.launchBlocker).toBe('provider_not_configured');
  });

  it('allows launch only when the proven runtime has a configured provider', () => {
    const plan = createCheckoutRuntimePlan({ retailer: 'supervalu', items: supervaluItems, providerConfigured: true });
    expect(plan.launchEnabled).toBe(true);
    expect(plan.launchBlocker).toBeNull();
  });

  it('keeps Dunnes blocked even if a provider is configured', () => {
    const plan = createCheckoutRuntimePlan({
      retailer: 'dunnes',
      providerConfigured: true,
      items: [{
        ...supervaluItems[0],
        retailerUrl: 'https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/example/1001',
      }],
    });
    expect(plan.launchEnabled).toBe(false);
    expect(plan.launchBlocker).toBe('retailer_runtime_unproven');
  });

  it('enforces the runtime state machine', () => {
    expect(() => assertCheckoutRuntimeTransition('prepared', 'awaiting_shopper_auth')).not.toThrow();
    expect(() => assertCheckoutRuntimeTransition('populating_trolley', 'trolley_ready')).not.toThrow();
    expect(() => assertCheckoutRuntimeTransition('prepared', 'trolley_ready')).toThrow(/invalid checkout runtime transition/i);
    expect(() => assertCheckoutRuntimeTransition('expired', 'prepared')).toThrow(/invalid checkout runtime transition/i);
  });

  it('prevents one shopper from accessing another shopper session', () => {
    expect(() => assertCheckoutRuntimeSessionOwner('shopper-a', 'shopper-a')).not.toThrow();
    expect(() => assertCheckoutRuntimeSessionOwner('shopper-a', 'shopper-b')).toThrow(/does not belong/i);
  });

  it('cannot report trolley success from a partial retailer snapshot', () => {
    expect(isVerifiedTrolleyLineSnapshot('SuperValu Fresh Irish Whole Milk 2L', 2, 'SuperValu Fresh Irish Whole Milk 2L · Qty 1')).toBe(false);
    expect(isVerifiedTrolleyLineSnapshot('SuperValu Fresh Irish Whole Milk 2L', 2, 'SuperValu Fresh Irish Whole Milk 2L · Qty 2')).toBe(true);
  });
});
