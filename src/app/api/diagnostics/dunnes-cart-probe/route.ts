import { supabaseAdmin } from '@/lib/supabase';

const STORE_ID = 258;
const SITE_URL = 'https://www.dunnesstoresgrocery.com';
const GATEWAY_BASE = 'https://storefrontgateway.dunnesstoresgrocery.com/api';
const GATEWAY_ORIGIN = 'https://storefrontgateway.dunnesstoresgrocery.com';
const SHOPPING_MODE = '22222222-2222-2222-2222-222222222222';

function authorized(request: Request) {
  if (process.env.VERCEL_ENV === 'preview') return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

function headers() {
  return {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'x-site-host': SITE_URL,
    'x-site-location': 'HeadersBuilderInterceptor',
    'x-correlation-id': crypto.randomUUID(),
    'x-shopping-mode': SHOPPING_MODE,
  };
}

async function probe(url: string, method: 'GET' | 'OPTIONS') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { method, headers: headers(), cache: 'no-store', redirect: 'manual', signal: controller.signal });
    const contentType = response.headers.get('content-type');
    let bodyHint: string | null = null;
    if (method === 'GET' && response.ok && contentType?.includes('json')) {
      const text = (await response.text()).slice(0, 2000);
      bodyHint = [
        text.includes('openapi') ? 'openapi' : null,
        text.includes('swagger') ? 'swagger' : null,
        text.includes('AddProductLineItemToCart') ? 'single_add_model' : null,
        text.includes('AddProductLineItemsToCart') ? 'bulk_add_model' : null,
      ].filter(Boolean).join(',') || null;
    }
    return {
      status: response.status,
      ok: response.ok,
      content_type: contentType,
      allow: response.headers.get('allow'),
      www_authenticate_present: Boolean(response.headers.get('www-authenticate')),
      body_hint: bodyHint,
    };
  } catch (error) {
    return { status: null, ok: false, error: error instanceof Error ? error.name : 'unknown' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('store_products')
    .select('id, store_product_name, store_url, store_sku, products!inner(canonical_name)')
    .eq('store', 'dunnes')
    .eq('url_status', 'resolved')
    .not('store_sku', 'is', null)
    .limit(1);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.length) return Response.json({ error: 'No mapped Dunnes product found' }, { status: 404 });

  const row = data[0];
  const canonical = row.products as unknown as { canonical_name: string };
  const searchUrl = `${GATEWAY_BASE}/stores/${STORE_ID}/search?q=${encodeURIComponent(String(row.store_product_name).split(' ').slice(0, 4).join(' '))}&take=1&page=1&skip=0`;
  const cartUrl = `${GATEWAY_BASE}/stores/${STORE_ID}/cart`;
  const schemaPaths = ['/openapi.json', '/swagger/v1/swagger.json', '/swagger.json', '/api/openapi.json'];

  const [searchGet, cartOptions, cartGet, ...schemaResults] = await Promise.all([
    probe(searchUrl, 'GET'),
    probe(cartUrl, 'OPTIONS'),
    probe(cartUrl, 'GET'),
    ...schemaPaths.map((path) => probe(`${GATEWAY_ORIGIN}${path}`, 'GET')),
  ]);

  return Response.json({
    mode: 'read_only_gateway_probe',
    product: {
      id: row.id,
      canonical_name: canonical.canonical_name,
      store_product_name: row.store_product_name,
      store_sku: row.store_sku,
      store_url: row.store_url,
    },
    gateway: {
      host: 'storefrontgateway.dunnesstoresgrocery.com',
      retailer_store_id: STORE_ID,
      shopping_mode_id: SHOPPING_MODE,
      known_production_search_path: `/api/stores/${STORE_ID}/search`,
      candidate_cart_path: `/api/stores/${STORE_ID}/cart`,
      search_get: searchGet,
      cart_options: cartOptions,
      cart_get_unauthenticated: cartGet,
      schema_probes: schemaPaths.map((path, index) => ({ path, result: schemaResults[index] })),
    },
    note: 'Read-only gateway/schema metadata probe. No POST, cart mutation, shopper authentication, cookies, session identifiers, credentials or payment data are used or returned.',
  });
}
