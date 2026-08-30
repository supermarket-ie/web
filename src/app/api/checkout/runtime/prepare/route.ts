import { NextRequest } from 'next/server';
import { getSubscriberId } from '@/lib/auth';
import {
  CheckoutRuntimePlanError,
  prepareOwnedCheckoutRuntimePlan,
} from '@/lib/shopping/checkout-runtime-plan.server';
import type { StorefrontRetailer } from '@/lib/shopping/retailers/storefront';

const SUPPORTED_RETAILERS = new Set<StorefrontRetailer>(['supervalu', 'dunnes']);

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

  try {
    return Response.json(await prepareOwnedCheckoutRuntimePlan({
      subscriberId,
      listId: body.list_id,
      retailer,
    }));
  } catch (error) {
    if (error instanceof CheckoutRuntimePlanError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: 'Could not prepare checkout' }, { status: 500 });
  }
}
