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

export const PARSE_VERSION = 'supervalu:v1';

export async function scrape(url: string, ctx: ScrapeContext): Promise<ScrapeResult> {
  const result = await fetchWithRetry(url, { timeoutMs: ctx.timeoutMs, maxAttempts: 3, delayMinMs: 200, delayMaxMs: 700 });

  if (!result.ok) {
    throw new ScrapeError(result.error, result.errorCode, result.status, result.attempts);
  }

  const { html } = result;
  const text = htmlToText(html);

  // --- JSON-LD ---
  const jsonLd = extractJsonLdProduct(html);
  if (jsonLd) {
    const { price, currency, availability } = extractJsonLdOffer(jsonLd);
    const { price_per_unit, unit } = extractPricePerUnit(html);

    return {
      product_name: typeof jsonLd['name'] === 'string' ? jsonLd['name'] : undefined,
      brand: extractBrand(jsonLd),
      size: typeof jsonLd['size'] === 'string' ? jsonLd['size'] : undefined,
      currency: (currency as 'EUR') ?? 'EUR',
      price,
      was_price: extractWasPrice(html, text),
      promo_text: extractPromoText(html),
      price_per_unit,
      unit,
      is_available: availability ?? extractIsAvailable(html),
      image_url: extractOgImage(html),
      raw: { jsonLd },
      parse_version: PARSE_VERSION,
    };
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

function extractBrand(jsonLd: Record<string, unknown>): string | undefined {
  const b = jsonLd['brand'];
  if (!b) return undefined;
  if (typeof b === 'string') return b;
  if (typeof b === 'object' && b !== null) return String((b as Record<string, unknown>)['name'] ?? '');
  return undefined;
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
  // SuperValu uses selling/current price classes
  const m = html.match(/class="[^"]*(?:selling|current)[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+[.,]?\d*)/i)
    ?? html.match(/class="[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+[.,]?\d*)/i);
  if (m) return parsePrice(m[1]);
  const t = text.match(/€\s*(\d+[.,]?\d*)/);
  return t ? parsePrice(t[1]) : undefined;
}

function extractWasPrice(html: string, text: string): number | undefined {
  const m = html.match(/class="[^"]*(?:was|original)[^"]*"[^>]*>\s*[€£]?\s*(\d+[.,]?\d*)/i);
  if (m) return parsePrice(m[1]);
  const t = text.match(/was\s+[€£]?\s*(\d+[.,]?\d*)/i);
  return t ? parsePrice(t[1]) : undefined;
}

function extractPromoText(html: string): string | undefined {
  const m = html.match(/class="[^"]*(?:promo|offer|badge|discount|save)[^"]*"[^>]*>([^<]{3,80})</i);
  if (m) return m[1].trim();
  if (/multi.?buy/i.test(html)) return 'Multi-buy offer';
  return undefined;
}
