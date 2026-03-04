import type { ScrapeResult, ScrapeContext } from '../types';
import { ScrapeError } from '../types';
import { fetchWithRetry } from '../fetch';
import {
  htmlToText,
  extractOgImage,
  extractIsAvailable,
  extractJsonLdProduct,
  extractJsonLdOffer,
  extractPricePerUnit,
  parsePrice,
} from '../parse-helpers';

export const PARSE_VERSION = 'tesco:v1';

export async function scrape(url: string, ctx: ScrapeContext): Promise<ScrapeResult> {
  const result = await fetchWithRetry(url, { timeoutMs: ctx.timeoutMs, maxAttempts: 3, delayMinMs: 200, delayMaxMs: 800 });

  if (!result.ok) {
    throw new ScrapeError(result.error, result.errorCode, result.status, result.attempts);
  }

  const { html } = result;
  const text = htmlToText(html);

  // --- Try JSON-LD first ---
  const jsonLd = extractJsonLdProduct(html);
  if (jsonLd) {
    const { price, currency, availability } = extractJsonLdOffer(jsonLd);
    const { price_per_unit, unit } = extractPricePerUnit(html);
    const wasPrice = extractWasPrice(html, text);
    const promoText = extractPromoText(html);

    return {
      product_name: typeof jsonLd['name'] === 'string' ? jsonLd['name'] : undefined,
      brand: typeof jsonLd['brand'] === 'object' && jsonLd['brand'] !== null
        ? String((jsonLd['brand'] as Record<string, unknown>)['name'] ?? '')
        : undefined,
      currency: (currency as 'EUR') ?? 'EUR',
      price,
      was_price: wasPrice,
      promo_text: promoText,
      price_per_unit,
      unit,
      is_available: availability,
      image_url: extractOgImage(html),
      raw: { jsonLd },
      parse_version: PARSE_VERSION,
    };
  }

  // --- Try __NEXT_DATA__ embedded JSON ---
  const nextData = extractNextData(html);
  if (nextData) {
    const product = resolveNextDataProduct(nextData);
    if (product) {
      const { price_per_unit, unit } = extractPricePerUnit(html);
      return {
        product_name: product.product_name,
        price: product.price,
        was_price: product.was_price,
        promo_text: product.promo_text,
        price_per_unit,
        unit,
        is_available: product.is_available,
        image_url: extractOgImage(html),
        currency: 'EUR',
        raw: { source: '__NEXT_DATA__', title: product.product_name },
        parse_version: PARSE_VERSION,
      };
    }
  }

  // --- HTML fallback ---
  const product_name = extractProductName(html, text);
  const price = extractPrice(html, text);

  if (!product_name && price === undefined) {
    throw new ScrapeError('Could not extract product data', 'PARSE_FAIL', result.status, result.attempts);
  }

  const { price_per_unit, unit } = extractPricePerUnit(html);

  return {
    product_name: product_name ?? undefined,
    price,
    was_price: extractWasPrice(html, text),
    promo_text: extractPromoText(html),
    price_per_unit,
    unit,
    is_available: extractIsAvailable(html),
    image_url: extractOgImage(html),
    currency: 'EUR',
    parse_version: PARSE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function extractNextData(html: string): Record<string, unknown> | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(\{[\s\S]*?\})<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface NextProduct {
  product_name?: string;
  price?: number;
  was_price?: number;
  promo_text?: string;
  is_available?: boolean;
}

function resolveNextDataProduct(data: Record<string, unknown>): NextProduct | null {
  try {
    // Tesco Next.js data path varies; attempt common paths
    const pageProps = ((data['props'] as Record<string, unknown>)?.['pageProps'] as Record<string, unknown>) ?? {};
    const product = (pageProps['product'] ?? pageProps['data']) as Record<string, unknown> | undefined;
    if (!product) return null;

    const price = typeof product['price'] === 'number'
      ? product['price']
      : parsePrice(String(product['price'] ?? ''));

    return {
      product_name: typeof product['name'] === 'string' ? product['name'] : undefined,
      price,
      was_price: typeof product['wasPrice'] === 'number' ? product['wasPrice'] : undefined,
      promo_text: typeof product['promotionText'] === 'string' ? product['promotionText'] : undefined,
      is_available: typeof product['isAvailable'] === 'boolean' ? product['isAvailable'] : undefined,
    };
  } catch {
    return null;
  }
}

function extractProductName(html: string, text: string): string | null {
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    ?? html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
  if (og) return og[1].trim();

  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1) return h1[1].trim();

  const firstLine = text.split('\n').find((l) => l.trim().length > 4);
  return firstLine?.trim() ?? null;
}

function extractPrice(html: string, text: string): number | undefined {
  // Tesco data-value attribute
  const dv = html.match(/data-value="(\d+\.?\d*)"/i);
  if (dv) return parseFloat(dv[1]);

  // Price span class pattern
  const ps = html.match(/class="[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+[.,]?\d*)/i);
  if (ps) return parsePrice(ps[1]);

  // Inline euro
  const m = text.match(/€\s*(\d+[.,]?\d*)/);
  return m ? parsePrice(m[1]) : undefined;
}

function extractWasPrice(html: string, text: string): number | undefined {
  const m = html.match(/class="[^"]*was[^"]*"[^>]*>\s*[€£]?\s*(\d+[.,]?\d*)/i);
  if (m) return parsePrice(m[1]);
  const t = text.match(/was\s+[€£]?\s*(\d+[.,]?\d*)/i);
  return t ? parsePrice(t[1]) : undefined;
}

function extractPromoText(html: string): string | undefined {
  // Tesco promo badges
  const m = html.match(/class="[^"]*(?:clubcard|promo|offer|badge)[^"]*"[^>]*>([^<]{3,80})</i);
  if (m) return m[1].trim();
  if (/clubcard price/i.test(html)) return 'Clubcard Price';
  if (/multi.?buy/i.test(html)) return 'Multi-buy offer';
  return undefined;
}
