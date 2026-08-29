import { supabaseAdmin } from '@/lib/supabase';

const SUPERVALU_HOST = 'shop.supervalu.ie';
const MAX_SCRIPTS = 10;
const MAX_SCRIPT_BYTES = 1_500_000;
const TERMS = [
  'addtocart',
  'add_to_cart',
  'add-to-cart',
  'addtotrolley',
  'trolley',
  'cartitem',
  'cart_items',
  'graphql',
  '/cart',
  'quantity',
  'retailerlocationid',
  'retailer_location_id',
  'rsid',
];

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

function snippets(text: string) {
  const lower = text.toLowerCase();
  const hits: Array<{ term: string; snippet: string }> = [];
  for (const term of TERMS) {
    let from = 0;
    while (hits.length < 40) {
      const index = lower.indexOf(term, from);
      if (index < 0) break;
      const start = Math.max(0, index - 180);
      const end = Math.min(text.length, index + term.length + 260);
      hits.push({
        term,
        snippet: text.slice(start, end).replace(/\s+/g, ' ').slice(0, 500),
      });
      from = index + term.length;
    }
    if (hits.length >= 40) break;
  }
  return hits;
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
  const scriptResults = [];

  for (const url of scriptUrls) {
    try {
      const result = await fetchText(url);
      const hits = result.text ? snippets(result.text) : [];
      if (hits.length) scriptResults.push({ url, status: result.status, hits });
    } catch (error) {
      scriptResults.push({
        url,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
        hits: [],
      });
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
    page: {
      status: page.status,
      storefront_markers: snippets(page.text),
      script_count: scriptUrls.length,
    },
    scripts: scriptResults,
    note: 'This diagnostic performs GET requests only. It does not create or modify a SuperValu trolley and does not capture cookies, credentials, or payment data.',
  });
}
