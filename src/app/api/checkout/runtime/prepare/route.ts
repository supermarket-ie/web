import { NextRequest } from 'next/server';
import { getSubscriberId } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { createCheckoutRuntimePlan } from '@/lib/shopping/checkout-runtime';
import type { StorefrontRetailer } from '@/lib/shopping/retailers/storefront';

const SUPPORTED_RETAILERS = new Set<StorefrontRetailer>(['supervalu', 'dunnes']);

type SavedItem = {
  canonical_name?: unknown;
  quantity?: unknown;
};

type TrustedOffer = {
  canonical_name: string;
  retailer: string;
  retailer_sku: string;
  retailer_product_name: string;
  retailer_product_url: string;
  price: number;
};

export async function POST(request: NextRequest) {
  const subscriberId = getSubscriberId(request.cookies.get('sm_session')?.value);
  if (!subscriberId) return Response.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await request.json().catch(() => null) as { list_id?: unknown; retailer?: unknown } | null;
  if (!body || typeof body.list_id !== 'string' || typeof body.retailer !== 'string') {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const retailer = body.retailer.toLowerCase() as StorefrontRetailer;
  if (!SUPPORTED_RETAILERS.has(retailer)) {
    return Response.json({ error: 'Unsupported retailer' }, { status: 400 });
  }

  const { data: list, error: listError } = await supabaseAdmin
    .from('saved_lists')
    .select('id, items')
    .eq('id', body.list_id)
    .eq('subscriber_id', subscriberId)
    .maybeSingle();

  if (listError) return Response.json({ error: 'Failed to load shop' }, { status: 500 });
  if (!list) return Response.json({ error: 'Shop not found' }, { status: 404 });

  const savedItems = (Array.isArray(list.items) ? list.items : []) as SavedItem[];
  const canonicalNames = [...new Set(savedItems
    .map(item => typeof item.canonical_name === 'string' ? item.canonical_name.trim() : '')
    .filter(Boolean))];

  if (!canonicalNames.length) {
    return Response.json({ error: 'Shop has no structured items' }, { status: 422 });
  }

  const { data: offers, error: offersError } = await supabaseAdmin
    .from('trusted_retailer_offers')
    .select('canonical_name, retailer, retailer_sku, retailer_product_name, retailer_product_url, price')
    .eq('retailer', retailer)
    .in('canonical_name', canonicalNames);

  if (offersError) return Response.json({ error: 'Failed to map retailer products' }, { status: 500 });

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
    return Response.json({ error: `No ${retailer} products could be mapped` }, { status: 422 });
  }

  const plan = createCheckoutRuntimePlan({
    retailer,
    items: mappedItems,
    totalItemCount: savedItems.length,
    providerConfigured: process.env.CHECKOUT_RUNTIME_PROVIDER_CONFIGURED === 'true',
  });

  return Response.json({
    plan,
    unmatchedItems: canonicalNames.filter(name => !offerByName.has(name)),
  });
}
