import 'server-only';

import { supabaseAdmin } from '@/lib/supabase';
import { createCheckoutRuntimePlan } from './checkout-runtime';
import type { StorefrontRetailer } from './retailers/storefront';

type SavedItem = { canonical_name?: unknown; quantity?: unknown };
type TrustedOffer = {
  canonical_name: string;
  retailer: string;
  retailer_sku: string;
  retailer_product_name: string;
  retailer_product_url: string;
  price: number;
};

export class CheckoutRuntimePlanError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function prepareOwnedCheckoutRuntimePlan(input: {
  subscriberId: string;
  listId: string;
  retailer: StorefrontRetailer;
}) {
  const { data: list, error: listError } = await supabaseAdmin
    .from('saved_lists')
    .select('id, items')
    .eq('id', input.listId)
    .eq('subscriber_id', input.subscriberId)
    .maybeSingle();

  if (listError) throw new CheckoutRuntimePlanError('Failed to load shop', 500);
  if (!list) throw new CheckoutRuntimePlanError('Shop not found', 404);

  const savedItems = (Array.isArray(list.items) ? list.items : []) as SavedItem[];
  const canonicalNames = [...new Set(savedItems
    .map(item => typeof item.canonical_name === 'string' ? item.canonical_name.trim() : '')
    .filter(Boolean))];
  if (!canonicalNames.length) throw new CheckoutRuntimePlanError('Shop has no structured items', 422);

  const { data: offers, error: offersError } = await supabaseAdmin
    .from('trusted_retailer_offers')
    .select('canonical_name, retailer, retailer_sku, retailer_product_name, retailer_product_url, price')
    .eq('retailer', input.retailer)
    .in('canonical_name', canonicalNames);
  if (offersError) throw new CheckoutRuntimePlanError('Failed to map retailer products', 500);

  const offerByName = new Map<string, TrustedOffer>();
  for (const row of (offers ?? []) as TrustedOffer[]) {
    if (!offerByName.has(row.canonical_name)) offerByName.set(row.canonical_name, row);
  }

  const mappedItems = savedItems.flatMap(item => {
    const canonicalName = typeof item.canonical_name === 'string' ? item.canonical_name.trim() : '';
    const offer = offerByName.get(canonicalName);
    if (!offer) return [];
    const rawQuantity = typeof item.quantity === 'number' ? item.quantity : 1;
    return [{
      canonicalName,
      retailerUrl: offer.retailer_product_url,
      retailerProductId: offer.retailer_sku,
      retailerProductName: offer.retailer_product_name,
      quantity: Math.max(1, Math.floor(rawQuantity)),
      price: Number(offer.price),
    }];
  });
  if (!mappedItems.length) {
    throw new CheckoutRuntimePlanError(`No ${input.retailer} products could be mapped`, 422);
  }

  return {
    plan: createCheckoutRuntimePlan({
      retailer: input.retailer,
      items: mappedItems,
      totalItemCount: savedItems.length,
      providerConfigured: process.env.CHECKOUT_RUNTIME_PROVIDER_CONFIGURED === 'true',
    }),
    unmatchedItems: canonicalNames.filter(name => !offerByName.has(name)),
  };
}
