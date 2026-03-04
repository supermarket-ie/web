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

export const PARSE_VERSION = 'aldi:v1';

export async function scrape(url: string, ctx: ScrapeContext): Promise<ScrapeResult> {
  const result = await fetchWithRetry(url, { timeoutMs: ctx.timeoutMs, maxAttempts: 3, delayMinMs: 100, delayMaxMs: 600 });

  if (!result.ok) {
    throw new ScrapeError(result.error, result.errorCode, result.status, result.attempts);
  }

  const { html } = result;
  const text = htmlToText(html);

  // --- JSON-LD (Aldi uses this reliably) ---
  const jsonLd = extractJsonLdProduct(html);
  if (jsonLd) {
    const { price, currency, availability } = extractJsonLdOffer(jsonLd);
    const { price_per_unit, unit } = extractPricePerUnit(html);

    return {
      product_name: typeof jsonLd['name'] === 'string' ? jsonLd['name'] : undefined,
      brand: extractBrand(jsonLd),
      size: extractSize(html),
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
    size: extractSize(html),
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

function extractSize(html: string): string | undefined {
  const m = html.match(/(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl|fl\.?\s*oz))\b/i);
  return m ? m[1].trim() : undefined;
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
  // Aldi product-price or price container
  const m = html.match(/class="[^"]*product[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+[.,]?\d*)/i)
    ?? html.match(/class="[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+[.,]?\d*)/i);
  if (m) return parsePrice(m[1]);
  const t = text.match(/€\s*(\d+[.,]?\d*)/);
  return t ? parsePrice(t[1]) : undefined;
}

function extractWasPrice(html: string, text: string): number | undefined {
  const m = html.match(/class="[^"]*(?:was|old|original)[^"]*"[^>]*>\s*[€£]?\s*(\d+[.,]?\d*)/i);
  if (m) return parsePrice(m[1]);
  const t = text.match(/was\s+[€£]?\s*(\d+[.,]?\d*)/i);
  return t ? parsePrice(t[1]) : undefined;
}

function extractPromoText(html: string): string | undefined {
  const m = html.match(/class="[^"]*(?:promo|offer|badge|super.?saver)[^"]*"[^>]*>([^<]{3,80})</i);
  if (m) return m[1].trim();
  return undefined;
}
