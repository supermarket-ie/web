import { supabaseAdmin } from '@/lib/supabase';

const DUNNES_HOST = 'www.dunnesstoresgrocery.com';
const MAX_SCRIPTS = 10;
const MAX_SCRIPT_BYTES = 1_500_000;

function authorized(request: Request) {
  if (process.env.VERCEL_ENV === 'preview') return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

function absoluteDunnesUrl(src: string, base: string) {
  try {
    const url = new URL(src, base);
    return url.protocol === 'https:' && url.hostname === DUNNES_HOST ? url.toString() : null;
  } catch {
    return null;
  }
}

function extractScriptUrls(html: string, base: string) {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    const url = absoluteDunnesUrl(match[1], base);
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

function detectSessionContract(text: string) {
  const lower = text.toLowerCase();
  return {
    has_authorization_header_logic: lower.includes('authorization') && lower.includes('bearer'),
    has_oidc_client: lower.includes('oidc_client_id') || lower.includes('oidcprovider'),
    has_user_session_cart_id: lower.includes('usersession') && lower.includes('cartid'),
    has_customer_session_cookie: lower.includes('customer_session_id_cookie'),
    has_rsid_session_cookie: lower.includes('rsid_session_cookie'),
    dunnes_gateway_referenced: lower.includes('dunnes') && lower.includes('gateway') && lower.includes('/api/'),
    auth_host_reference: [...new Set((text.match(/https:\/\/[a-z0-9.-]*dunnes[a-z0-9.-]*/gi) || []).map((value) => {
      try { return new URL(value).hostname; } catch { return ''; }
    }).filter(Boolean))].slice(0, 5),
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
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams.get('q')?.trim();

  let builder = supabaseAdmin
    .from('store_products')
    .select('id, store_product_name, store_url, store_sku, products!inner(canonical_name)')
    .eq('store', 'dunnes')
    .eq('url_status', 'resolved')
    .like('store_url', '%/product/%')
    .limit(1);

  if (query) builder = builder.ilike('products.canonical_name', `%${query}%`);

  const { data, error } = await builder;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.length) return Response.json({ error: 'No Dunnes product found' }, { status: 404 });

  const row = data[0];
  const storeUrl = row.store_url as string;
  const page = await fetchText(storeUrl);
  if (!page.text) return Response.json({ error: 'Failed to fetch Dunnes product page', status: page.status }, { status: 502 });

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
  const session = {
    has_authorization_header_logic: false,
    has_oidc_client: false,
    has_user_session_cart_id: false,
    has_customer_session_cookie: false,
    has_rsid_session_cookie: false,
    dunnes_gateway_referenced: false,
    auth_host_reference: [] as string[],
  };

  const allText = [page.text];
  for (const url of scriptUrls) {
    try {
      const result = await fetchText(url);
      if (!result.text) continue;
      allText.push(result.text);
      const detected = detectCartContract(result.text);
      for (const key of Object.keys(contracts) as Array<keyof typeof contracts>) contracts[key] ||= detected[key];
    } catch {
      // Read-only structural probe: missing bundles are ignored and raw response state is never returned.
    }
  }

  for (const text of allText) {
    const detected = detectSessionContract(text);
    session.has_authorization_header_logic ||= detected.has_authorization_header_logic;
    session.has_oidc_client ||= detected.has_oidc_client;
    session.has_user_session_cart_id ||= detected.has_user_session_cart_id;
    session.has_customer_session_cookie ||= detected.has_customer_session_cookie;
    session.has_rsid_session_cookie ||= detected.has_rsid_session_cookie;
    session.dunnes_gateway_referenced ||= detected.dunnes_gateway_referenced;
    session.auth_host_reference = [...new Set([...session.auth_host_reference, ...detected.auth_host_reference])].slice(0, 5);
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
    session_contract: session,
    note: 'Read-only structural probe. No cart mutation. Raw Storefront state, cookies, session identifiers, credentials and payment data are never returned.',
  });
}
