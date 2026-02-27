import type { StoreExtractor, ExtractedPrice } from '../types';

/**
 * Tesco Ireland price extractor.
 *
 * Parses Tesco product pages for:
 * - Product name from <h1> or og:title
 * - Current price from data attributes or price spans
 * - Was-price / clubcard price
 * - Promotion badges
 */
export const TescoExtractor: StoreExtractor = {
  extract({ source_url, html, text }): ExtractedPrice | null {
    const productName = extractProductName(html, text);
    if (!productName) return null;

    const price = extractPrice(html, text);
    if (price === null) return null;

    const wasPrice = extractWasPrice(html, text);
    const onPromotion = detectPromotion(html, text);

    return {
      product_name: productName,
      price,
      was_price: wasPrice,
      on_promotion: onPromotion,
      url: source_url,
    };
  },
};

function extractProductName(html: string, text: string): string | null {
  // Try og:title first
  const ogMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i);
  if (ogMatch) return ogMatch[1].trim();

  // Try <h1> tag
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();

  // Fall back to first non-empty line of text
  const firstLine = text.split('\n').find((l) => l.trim().length > 0);
  return firstLine?.trim() ?? null;
}

function extractPrice(html: string, text: string): number | null {
  // Tesco uses data-value or spans with price classes
  const dataValueMatch = html.match(/data-value="(\d+\.?\d*)"/i);
  if (dataValueMatch) return parseFloat(dataValueMatch[1]);

  // Try common Tesco price span pattern: €X.XX
  const priceSpanMatch = html.match(/class="[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)/i);
  if (priceSpanMatch) return parseFloat(priceSpanMatch[1]);

  // Fall back to text-based euro price extraction
  const textPrice = extractEuroPrice(text);
  return textPrice;
}

function extractWasPrice(html: string, text: string): number | null {
  // Look for was/original price patterns
  const wasMatch = html.match(/class="[^"]*was[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)/i);
  if (wasMatch) return parseFloat(wasMatch[1]);

  const textWas = text.match(/was\s+[€£]?\s*(\d+\.?\d*)/i);
  if (textWas) return parseFloat(textWas[1]);

  return null;
}

function detectPromotion(html: string, text: string): boolean {
  const promoPatterns = /clubcard|offer|save|promotion|price\s*drop|reduced/i;
  return promoPatterns.test(html) || promoPatterns.test(text);
}

function extractEuroPrice(text: string): number | null {
  const match = text.match(/€\s*(\d+\.?\d*)/);
  return match ? parseFloat(match[1]) : null;
}
