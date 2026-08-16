const isPreview = process.env.VERCEL_ENV === 'preview';

if (!isPreview) {
  console.log('[tesco-network-probe] skipped: not a Vercel Preview build');
  process.exit(0);
}

const url = 'https://www.tesco.ie/groceries/en-IE/search?query=Butter%20Unsalted%20250g';
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 20000);

try {
  const response = await fetch(url, {
    signal: controller.signal,
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'en-IE,en;q=0.9',
    },
  });

  const html = await response.text();
  const lower = html.toLowerCase();
  const result = {
    status: response.status,
    ok: response.ok,
    finalUrl: response.url,
    bytes: html.length,
    blocked:
      lower.includes('access denied') ||
      lower.includes('security checks') ||
      lower.includes('akamai') ||
      lower.includes('captcha') ||
      (lower.includes('not right') && lower.includes('security')),
    hasProductHeading: lower.includes('product-heading'),
    hasPriceText: lower.includes('pricetext'),
    hasTescoBranding: lower.includes('tesco'),
  };

  console.log('[tesco-network-probe]', JSON.stringify(result));
} catch (error) {
  console.log('[tesco-network-probe]', JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
} finally {
  clearTimeout(timeout);
}
