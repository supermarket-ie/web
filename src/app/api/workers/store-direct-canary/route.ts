import { supabaseAdmin } from '@/lib/supabase';

const ALLOWED = new Set(['dunnes', 'supervalu', 'aldi']);

function text(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function positiveNumbers(matches: IterableIterator<RegExpMatchArray>) {
  const values: number[] = [];
  for (const match of matches) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && value < 1000 && !values.includes(value)) values.push(value);
    if (values.length >= 12) break;
  }
  return values;
}

function parseHtml(html: string) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const documentTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1];
  const metaPrice = html.match(/<meta[^>]+(?:property|itemprop)=["'](?:product:price:amount|price)["'][^>]+content=["'](\d+(?:\.\d{1,2})?)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["'](\d+(?:\.\d{1,2})?)["'][^>]+(?:property|itemprop)=["'](?:product:price:amount|price)["']/i)?.[1];

  const euroPrices = positiveNumbers(html.matchAll(/€\s*(\d+(?:\.\d{1,2})?)/g));
  const jsonPrices = positiveNumbers(html.matchAll(/["']price["']\s*:\s*["']?(\d+(?:\.\d{1,2})?)/gi));
  const contentPrices = positiveNumbers(html.matchAll(/(?:content|value)=["'](\d+(?:\.\d{1,2})?)["'][^>]*(?:itemprop|property)=["'][^"']*price/gi));

  const title = h1 ? text(h1) : documentTitle ? text(documentTitle) : ogTitle ? text(ogTitle) : null;
  const price = metaPrice ? Number(metaPrice) : euroPrices[0] ?? jsonPrices[0] ?? contentPrices[0] ?? null;
  return {
    title,
    price,
    diagnostics: {
      document_title: documentTitle ? text(documentTitle) : null,
      og_title: ogTitle ? text(ogTitle) : null,
      meta_price: metaPrice ? Number(metaPrice) : null,
      euro_prices: euroPrices,
      json_prices: jsonPrices,
      content_prices: contentPrices,
      json_ld_blocks: Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["']/gi)).length,
    },
  };
}

async function probeDunnes(canonicalName: string) {
  const storeId = 258;
  const base = 'https://storefrontgateway.dunnesstoresgrocery.com/api';
  const site = 'https://www.dunnesstoresgrocery.com';
  const query = canonicalName.split(' ').slice(0, 5).join(' ').slice(0, 60);
  const url = `${base}/stores/${storeId}/search?q=${encodeURIComponent(query)}&take=5&page=1&skip=0`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'x-site-host': site,
      'x-site-location': 'HeadersBuilderInterceptor',
      'x-correlation-id': crypto.randomUUID(),
      'x-shopping-mode': '22222222-2222-2222-2222-222222222222',
    },
  });
  const body = await response.text();
  let candidates: Array<{ name?: string; priceNumeric?: number; sku?: string | number }> = [];
  try { candidates = (JSON.parse(body).items ?? []).slice(0, 5); } catch { /* return raw preview below */ }
  return {
    transport_url: url,
    http_status: response.status,
    candidates: candidates.map((item) => ({ name: item.name ?? null, price: item.priceNumeric ?? null, sku: item.sku ?? null })),
    body_preview: candidates.length ? null : body.slice(0, 160),
  };
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview') return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const store = url.searchParams.get('store')?.toLowerCase() ?? '';
  const q = url.searchParams.get('q')?.trim();
  if (!ALLOWED.has(store)) return Response.json({ error: 'store must be dunnes, supervalu, or aldi' }, { status: 400 });

  let builder = supabaseAdmin
    .from('store_products')
    .select('id, store_product_name, store_url, products!inner(canonical_name)')
    .eq('store', store)
    .eq('url_status', 'resolved')
    .limit(1);
  if (q) builder = builder.ilike('products.canonical_name', `%${q}%`);
  if (store === 'supervalu' || store === 'aldi') builder = builder.like('store_url', '%/product/%');

  const { data, error } = await builder.maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: 'No matching mapping found' }, { status: 404 });

  const product = data.products as unknown as { canonical_name: string };
  const common = {
    store,
    canonical_name: product.canonical_name,
    stored_name: data.store_product_name,
    stored_url: data.store_url,
  };

  if (store === 'dunnes') {
    return Response.json({ ...common, ...(await probeDunnes(product.canonical_name)) });
  }

  if (!data.store_url) return Response.json({ ...common, error: 'Missing product URL' }, { status: 422 });
  const response = await fetch(data.store_url, {
    cache: 'no-store',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-IE,en;q=0.9',
    },
  });
  const html = await response.text();
  return Response.json({
    ...common,
    http_status: response.status,
    final_url: response.url,
    bytes: html.length,
    ...parseHtml(html),
    body_preview: html.slice(0, 120),
  });
}
