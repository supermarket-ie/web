const ALDI_DAIRY_CATEGORY = 'https://www.aldi.ie/products/chilled-food/dairy/k/1588161416978076002';

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') return new Response(null, { status: 404 });

  const response = await fetch(ALDI_DAIRY_CATEGORY, {
    cache: 'no-store',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-IE,en;q=0.9',
    },
  });
  const html = await response.text();
  const target = html.match(/CLONBAWN[\s\S]{0,300}Irish Double Cream/i) || html.match(/Irish Double Cream/i);
  const euroPrices = Array.from(html.matchAll(/€\s*(\d+(?:\.\d{1,2})?)/g))
    .map((match) => Number(match[1]))
    .filter((value, index, values) => value > 0 && value < 1000 && values.indexOf(value) === index)
    .slice(0, 10);

  return Response.json({
    region: process.env.VERCEL_REGION ?? null,
    http_status: response.status,
    final_url: response.url,
    bytes: html.length,
    category_contains_target: Boolean(target),
    euro_prices: euroPrices,
    body_preview: html.slice(0, 160),
  });
}
