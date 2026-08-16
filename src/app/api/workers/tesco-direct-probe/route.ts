export const dynamic = 'force-dynamic';

const TESCO_SEARCH_URL = 'https://www.tesco.ie/groceries/en-IE/search?query=Butter%20Unsalted%20250g';

function classify(html: string) {
  const lower = html.toLowerCase();
  const blocked =
    lower.includes('access denied') ||
    lower.includes('security checks') ||
    lower.includes('akamai') ||
    lower.includes('captcha') ||
    (lower.includes('not right') && lower.includes('security'));

  return {
    blocked,
    hasProductHeading: lower.includes('product-heading'),
    hasPriceText: lower.includes('pricetext'),
    hasTescoBranding: lower.includes('tesco'),
  };
}

export async function GET(): Promise<Response> {
  // Preview-only diagnostic endpoint. It never writes data or invokes ScrapingBee.
  if (process.env.VERCEL_ENV !== 'preview') {
    return Response.json({ error: 'Not available' }, { status: 404 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(TESCO_SEARCH_URL, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-IE,en;q=0.9',
      },
    });

    const html = await response.text();
    const markers = classify(html);

    return Response.json({
      status: response.status,
      ok: response.ok,
      finalUrl: response.url,
      bytes: html.length,
      ...markers,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
