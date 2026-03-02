import { NextRequest } from 'next/server';
import { getExtractor } from '@/lib/stores/extractors';
import type { StoreName } from '@/lib/stores/types';
import { VALID_STORES } from '@/lib/stores/types';

// --- Types ---

interface ExtractPayload {
  store: StoreName;
  store_product_id: string;
  source_url: string;
  html: string;
  text: string;
}

// --- Validation ---

function validatePayload(
  body: unknown
): { valid: true; payload: ExtractPayload } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.store !== 'string' || !VALID_STORES.has(obj.store as StoreName)) {
    return { valid: false, error: `store must be one of: ${[...VALID_STORES].join(', ')}` };
  }

  if (typeof obj.store_product_id !== 'string' || !obj.store_product_id) {
    return { valid: false, error: 'store_product_id is required and must be a non-empty string' };
  }

  if (typeof obj.source_url !== 'string' || !obj.source_url) {
    return { valid: false, error: 'source_url is required and must be a non-empty string' };
  }

  if (typeof obj.html !== 'string') {
    return { valid: false, error: 'html is required and must be a string' };
  }

  if (typeof obj.text !== 'string') {
    return { valid: false, error: 'text is required and must be a string' };
  }

  if (!obj.html && !obj.text) {
    return { valid: false, error: 'At least one of html or text must be non-empty' };
  }

  return {
    valid: true,
    payload: {
      store: obj.store as StoreName,
      store_product_id: obj.store_product_id as string,
      source_url: obj.source_url as string,
      html: obj.html as string,
      text: obj.text as string,
    },
  };
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

  const { store, store_product_id, source_url, html, text } = validation.payload;

  console.log(`[extract-price] store=${store} store_product_id=${store_product_id} url=${source_url}`);

  try {
    // 3. Run the store-specific extractor
    const extractor = getExtractor(store);
    const result = extractor.extract({ source_url, html, text });

    if (!result) {
      console.log(`[extract-price] No price found — returning price=null`);
      return Response.json({
        success: true,
        store,
        store_product_id,
        data: null,
      });
    }

    console.log(`[extract-price] Extracted: ${result.product_name} @ €${result.price}`);

    // 4. Return the extracted price payload (same shape as ingest products[])
    return Response.json({
      success: true,
      store,
      store_product_id,
      data: {
        product_name: result.product_name,
        price: result.price,
        was_price: result.was_price,
        on_promotion: result.on_promotion,
        url: result.url,
      },
    });
  } catch (error) {
    console.error(`[extract-price] Unexpected error:`, error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
