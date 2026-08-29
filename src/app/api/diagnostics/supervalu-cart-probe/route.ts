import { supabaseAdmin } from '@/lib/supabase';

const SUPERVALU_HOST = 'shop.supervalu.ie';
const MAX_SCRIPTS = 10;
const MAX_SCRIPT_BYTES = 1_500_000;

function authorized(request: Request) {
  if (process.env.VERCEL_ENV === 'preview') return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

function absoluteSupervaluUrl(src: string, base: string) {
  try {
    const url = new URL(src, base);
    return url.protocol === 'https:' && url.hostname === SUPERVALU_HOST ? url.toString() : null;
  } catch {
    return null;
  }
}

function extractScriptUrls(html: string, base: string) {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    const url = absoluteSupervaluUrl(match[1], base);
    if (url) urls.add(url);
    if (urls.size >= MAX_SCRIPTS) break;
  }
  return [...urls];
}

function extractRetailerStoreId(html: string) {
  const match = html.match(/\\?"retailerStoreId\\?"\s*:\s*\\?"(\d+)\\?"/i);
  return match?.[1] ?? null;
}

function extractAnonymousCart(html: string) {
  if (/\\?"anonymousCart\\?"\s*:\s*false/i.test(html)) return false;
  if (/\\?"anonymousCart\\?"\s*:\s*true/i.test(html)) return true;
  return null;
}

function extractShoppingModeId(html: string) {
  const patterns = [
    /\\?"selectedShoppingMode\\?"\s*:\s*\{[^}]*\\?"shoppingModeId\\?"\s*:\s*\\?"([^"\\]+)\\?"/i,
    /\\?"shoppingModeId\\?"\s*:\s*\\?"([^"\\]+)\\?"[^}]*\\?"displayName\\?"\s*:\s*\\?"delivery\\?"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function detectCartContract(text: string) {
  return {
    add_product_line_item: text.includes('domain-model=AddProductLineItemToCart'),
    add_many_product_line_items: text.includes('domain-model=AddProductLineItemsToCart'),
    set_line_item_quantity: text.includes('domain-model=SetLineItemQuantity'),
    endpoint_store_scoped: text.includes('stores/${') && text.includes('/cart'),
    payload_has_quantity: text.includes('quantity:t.quantity'),
    payload_has_sku: text.includes('sku:t.sku'),
    payload_has_catalog_source: text.includes('source:{type:"catalog"}'),
    payload_has_shopping_mode: text.includes('shoppingModeId:o.shoppingModes.selectedShoppingMode.shoppingModeId'),
  };
}

async function fetchText(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        accept: '*/*',
        'accept-language': 'en-IE,en;q=0.9',
      },
    });
    if (!response.ok) return { status: response.status, text: '' };
    const text = (await response.text()).slice(0, MAX_SCRIPT_BYTES);
    return { status: response.status, text };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams.get('q')?.trim();

  let builder = supabaseAdmin
    .from('store_products')
    .select('id, store_product_name, store_url, store_sku, products!inner(canonical_name)')
    .eq('store', 'supervalu')
    .eq('url_status', 'resolved')
    .like('store_url', '%/product/%')
    .limit(1);

  if (query) builder = builder.ilike('products.canonical_name', `%${query}%`);

  const { data, error } = await builder;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.length) return Response.json({ error: 'No SuperValu product found' }, { status: 404 });

  const row = data[0];
  const storeUrl = row.store_url as string;
  const page = await fetchText(storeUrl);
  if (!page.text) {
    return Response.json({ error: 'Failed to fetch SuperValu product page', status: page.status }, { status: 502 });
  }

  const scriptUrls = extractScriptUrls(page.text, storeUrl);
  const contracts = {
    add_product_line_item: false,
    add_many_product_line_items: false,
    set_line_item_quantity: false,
    endpoint_store_scoped: false,
    payload_has_quantity: false,
    payload_has_sku: false,
    payload_has_catalog_source: false,
    payload_has_shopping_mode: false,
  };

  for (const url of scriptUrls) {
    try {
      const result = await fetchText(url);
      if (!result.text) continue;
      const detected = detectCartContract(result.text);
      for (const key of Object.keys(contracts) as Array<keyof typeof contracts>) {
        contracts[key] ||= detected[key];
      }
    } catch {
      // A missing bundle should not cause the read-only probe to expose raw errors or response state.
    }
  }

  const product = row.products as unknown as { canonical_name: string };

  return Response.json({
    mode: 'read_only_storefront_probe',
    product: {
      id: row.id,
      canonical_name: product.canonical_name,
      store_product_name: row.store_product_name,
      store_sku: row.store_sku,
      store_url: storeUrl,
    },
    storefront: {
      page_status: page.status,
      retailer_store_id: extractRetailerStoreId(page.text),
      anonymous_cart_enabled: extractAnonymousCart(page.text),
      shopping_mode_id: extractShoppingModeId(page.text),
      script_count: scriptUrls.length,
    },
    cart_contract: contracts,
    add_product_contract: {
      method: 'POST',
      path: 'stores/{retailerStoreId}/cart',
      content_type: 'application/vnd.cart.v1+json;domain-model=AddProductLineItemToCart',
      body_fields: ['quantity', 'sku', 'source.type=catalog', 'shoppingModeId'],
    },
    note: 'Read-only structural probe. Raw Storefront state, cookies, session identifiers, credentials and payment data are never returned.',
  });
}
