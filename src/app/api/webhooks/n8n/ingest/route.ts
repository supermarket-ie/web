import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// --- Types ---

interface ScrapedProduct {
  product_name: string;
  price: number;
  was_price?: number | null;
  on_promotion?: boolean;
  url?: string;
}

interface IngestPayload {
  scrape_id: string;
  store: 'tesco' | 'dunnes' | 'supervalu' | 'lidl' | 'aldi';
  scraped_at: string;
  products: ScrapedProduct[];
}

interface SearchProfile {
  required_tokens: string[];
  exclude_tokens: string[];
  preferred_tokens: string[];
}

interface StoreProductRow {
  id: string;
  product_id: string;
  store: string;
  store_product_name: string;
  products: {
    id: string;
    canonical_name: string;
    search_profile: SearchProfile;
  };
}

interface UnmatchedEntry {
  product_name: string;
  reason: 'no_candidates' | 'tokens_failed' | 'low_confidence';
}

const VALID_STORES = new Set(['tesco', 'dunnes', 'supervalu', 'lidl', 'aldi']);
const MIN_CONFIDENCE = 0.7;

// --- Matching Logic ---

function matchProduct(
  scrapedName: string,
  candidates: StoreProductRow[]
): { storeProductId: string; confidence: number } | null {
  const nameLower = scrapedName.toLowerCase();
  let bestMatch: { storeProductId: string; confidence: number } | null = null;

  for (const candidate of candidates) {
    const profile = candidate.products.search_profile;
    if (!profile || !profile.required_tokens) continue;

    // All required tokens must be present
    const hasAllRequired = profile.required_tokens.every(
      (token) => nameLower.includes(token.toLowerCase())
    );
    if (!hasAllRequired) continue;

    // No exclude tokens can be present
    const hasExcluded = (profile.exclude_tokens ?? []).some(
      (token) => nameLower.includes(token.toLowerCase())
    );
    if (hasExcluded) continue;

    // Calculate confidence: base 0.5 + 0.1 per preferred token, max 1.0
    let confidence = 0.5;
    for (const token of profile.preferred_tokens ?? []) {
      if (nameLower.includes(token.toLowerCase())) {
        confidence += 0.1;
      }
    }
    confidence = Math.min(confidence, 1.0);

    if (confidence >= MIN_CONFIDENCE && (!bestMatch || confidence > bestMatch.confidence)) {
      bestMatch = { storeProductId: candidate.id, confidence };
    }
  }

  return bestMatch;
}

// --- Validation ---

function validatePayload(body: unknown): { valid: true; payload: IngestPayload } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.scrape_id !== 'string' || !obj.scrape_id) {
    return { valid: false, error: 'scrape_id is required and must be a string' };
  }

  if (typeof obj.store !== 'string' || !VALID_STORES.has(obj.store)) {
    return { valid: false, error: `store must be one of: ${[...VALID_STORES].join(', ')}` };
  }

  if (typeof obj.scraped_at !== 'string' || !obj.scraped_at) {
    return { valid: false, error: 'scraped_at is required and must be an ISO timestamp string' };
  }

  if (!Array.isArray(obj.products) || obj.products.length === 0) {
    return { valid: false, error: 'products must be a non-empty array' };
  }

  for (let i = 0; i < obj.products.length; i++) {
    const p = obj.products[i];
    if (typeof p.product_name !== 'string' || !p.product_name) {
      return { valid: false, error: `products[${i}].product_name is required` };
    }
    if (typeof p.price !== 'number' || p.price < 0) {
      return { valid: false, error: `products[${i}].price must be a non-negative number` };
    }
  }

  return { valid: true, payload: obj as unknown as IngestPayload };
}

// --- Route Handler ---

export async function POST(request: NextRequest) {
  // 1. Validate webhook secret
  const secret = request.headers.get('X-N8N-Secret');
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

  const { payload } = validation;
  const { scrape_id, store, scraped_at, products } = payload;

  console.log(`[n8n-ingest] scrape_id=${scrape_id} store=${store} products=${products.length}`);

  try {
    // 3. Fetch all store_products for this store, joined with product search profiles
    const { data: candidates, error: fetchError } = await supabaseAdmin
      .from('store_products')
      .select('id, product_id, store, store_product_name, products(id, canonical_name, search_profile)')
      .eq('store', store);

    if (fetchError) {
      console.error(`[n8n-ingest] Failed to fetch store products:`, fetchError);
      return Response.json({ error: 'Database error fetching products' }, { status: 500 });
    }

    const storeProducts = (candidates ?? []) as unknown as StoreProductRow[];

    // 4. Match each scraped product and collect inserts
    const inserts: Array<{
      store_product_id: string;
      price: number;
      was_price: number | null;
      on_promotion: boolean;
      observed_at: string;
    }> = [];
    const unmatched: UnmatchedEntry[] = [];
    let failedInserts = 0;

    for (const scraped of products) {
      if (storeProducts.length === 0) {
        unmatched.push({ product_name: scraped.product_name, reason: 'no_candidates' });
        continue;
      }

      const match = matchProduct(scraped.product_name, storeProducts);

      if (!match) {
        // Determine reason: check if any candidate had required tokens match
        const nameLower = scraped.product_name.toLowerCase();
        let hadTokenMatch = false;

        for (const candidate of storeProducts) {
          const profile = candidate.products.search_profile;
          if (!profile || !profile.required_tokens) continue;

          const hasAllRequired = profile.required_tokens.every(
            (token) => nameLower.includes(token.toLowerCase())
          );
          if (hasAllRequired) {
            hadTokenMatch = true;
            break;
          }
        }

        unmatched.push({
          product_name: scraped.product_name,
          reason: hadTokenMatch ? 'low_confidence' : 'tokens_failed',
        });
        continue;
      }

      inserts.push({
        store_product_id: match.storeProductId,
        price: scraped.price,
        was_price: scraped.was_price ?? null,
        on_promotion: scraped.on_promotion ?? false,
        observed_at: scraped_at,
      });
    }

    // 5. Batch insert matched price observations
    let insertedCount = 0;
    if (inserts.length > 0) {
      const { error: insertError, count } = await supabaseAdmin
        .from('price_observations')
        .insert(inserts, { count: 'exact' });

      if (insertError) {
        console.error(`[n8n-ingest] Insert error:`, insertError);
        failedInserts = inserts.length;
      } else {
        insertedCount = count ?? inserts.length;
      }
    }

    // 6. Return response with stats
    const stats = {
      total: products.length,
      matched: inserts.length,
      inserted: insertedCount,
      failed: failedInserts,
    };

    console.log(`[n8n-ingest] Complete: ${JSON.stringify(stats)}`);

    return Response.json({
      success: true,
      scrape_id,
      store,
      stats,
      unmatched,
    });
  } catch (error) {
    console.error(`[n8n-ingest] Unexpected error:`, error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
