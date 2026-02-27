import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getResolver } from '@/lib/stores/resolvers';
import type { StoreName, StoreProductRow } from '@/lib/stores/types';
import { VALID_STORES } from '@/lib/stores/types';

// --- Validation ---

interface ResolvePayload {
  store_product_id: string;
}

function validatePayload(
  body: unknown
): { valid: true; payload: ResolvePayload } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.store_product_id !== 'string' || !obj.store_product_id) {
    return { valid: false, error: 'store_product_id is required and must be a non-empty string' };
  }

  return { valid: true, payload: { store_product_id: obj.store_product_id } };
}

// --- Route Handler ---

export async function POST(request: NextRequest) {
  // 1. Validate webhook secret
  const secret = request.headers.get('x-n8n-secret');
  if (!secret || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse and validate payload
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = validatePayload(body);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const { store_product_id } = validation.payload;

  console.log(`[resolve-store-url] store_product_id=${store_product_id}`);

  try {
    // 3. Load the store_product with its product search profile
    const { data, error: fetchError } = await supabaseAdmin
      .from('store_products')
      .select('id, product_id, store, store_product_name, store_url, store_sku, products(id, canonical_name, search_profile)')
      .eq('id', store_product_id)
      .single();

    if (fetchError || !data) {
      console.error(`[resolve-store-url] Fetch error:`, fetchError);
      return Response.json(
        { error: fetchError?.code === 'PGRST116' ? 'Store product not found' : 'Database error' },
        { status: fetchError?.code === 'PGRST116' ? 404 : 500 }
      );
    }

    const storeProduct = data as unknown as StoreProductRow;
    const store = storeProduct.store as StoreName;

    if (!VALID_STORES.has(store)) {
      return Response.json(
        { error: `Unknown store: ${store}` },
        { status: 400 }
      );
    }

    // 4. Run the store-specific resolver
    const resolver = getResolver(store);
    let result;
    try {
      result = resolver.resolve(storeProduct);
    } catch (resolveError) {
      console.error(`[resolve-store-url] Resolver failed:`, resolveError);

      // Write failure status back to DB
      await supabaseAdmin
        .from('store_products')
        .update({
          url_status: 'failed',
          url_last_error: resolveError instanceof Error ? resolveError.message : 'Unknown resolver error',
        })
        .eq('id', store_product_id);

      return Response.json({
        success: false,
        store_product_id,
        store,
        url_status: 'failed',
        url_last_error: resolveError instanceof Error ? resolveError.message : 'Unknown resolver error',
      });
    }

    // 5. Write resolved URL back to DB
    const { error: updateError } = await supabaseAdmin
      .from('store_products')
      .update({
        store_url: result.store_url,
        store_sku: result.store_sku ?? null,
        url_status: 'resolved',
        url_last_error: null,
      })
      .eq('id', store_product_id);

    if (updateError) {
      console.error(`[resolve-store-url] Update error:`, updateError);
      return Response.json({ error: 'Database error updating store product' }, { status: 500 });
    }

    console.log(`[resolve-store-url] Resolved: ${result.store_url}`);

    return Response.json({
      success: true,
      store_product_id,
      store,
      store_url: result.store_url,
      store_sku: result.store_sku ?? null,
      url_status: 'resolved',
    });
  } catch (error) {
    console.error(`[resolve-store-url] Unexpected error:`, error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
