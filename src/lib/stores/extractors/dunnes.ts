import type { StoreExtractor, ExtractedPrice } from '../types';

/**
 * Dunnes Stores price extractor.
 *
 * Dunnes grocery pages (dunnesstoresgrocery.com) are SPA-rendered,
 * so we rely on structured data (JSON-LD), meta tags, or the text
 * representation provided by the headless browser.
 */
export const DunnesExtractor: StoreExtractor = {
  extract({ source_url, html, text }): ExtractedPrice | null {
    // Try JSON-LD first (most reliable)
    const jsonLd = extractJsonLd(html);
    if (jsonLd) {
      return { ...jsonLd, url: source_url };
    }

    // Fall back to HTML/text parsing
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

function extractJsonLd(html: string): Omit<ExtractedPrice, 'url'> | null {
  const scriptMatch = html.match(
    /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  );
  if (!scriptMatch) return null;

  for (const block of scriptMatch) {
    try {
      const jsonStr = block.replace(/<\/?script[^>]*>/gi, '');
      const data = JSON.parse(jsonStr);

      if (data['@type'] === 'Product' && data.offers) {
        const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
        const price = parseFloat(offer.price);
        if (isNaN(price)) continue;

        return {
          product_name: data.name ?? '',
          price,
          was_price: null,
          on_promotion: false,
        };
      }
    } catch {
      // JSON parse failed, try next block
    }
  }
  return null;
}

function extractProductName(html: string, text: string): string | null {
  const ogMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i);
  if (ogMatch) return ogMatch[1].trim();

  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();

  const firstLine = text.split('\n').find((l) => l.trim().length > 0);
  return firstLine?.trim() ?? null;
}

function extractPrice(html: string, text: string): number | null {
  // Dunnes uses various price container classes
  const priceMatch = html.match(/class="[^"]*price[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)/i);
  if (priceMatch) return parseFloat(priceMatch[1]);

  // Text fallback
  const textMatch = text.match(/€\s*(\d+\.?\d*)/);
  return textMatch ? parseFloat(textMatch[1]) : null;
}

function extractWasPrice(html: string, text: string): number | null {
  const wasMatch = html.match(/class="[^"]*was[^"]*"[^>]*>\s*[€£]?\s*(\d+\.?\d*)/i);
  if (wasMatch) return parseFloat(wasMatch[1]);

  const textWas = text.match(/was\s+[€£]?\s*(\d+\.?\d*)/i);
  if (textWas) return parseFloat(textWas[1]);

  return null;
}

function detectPromotion(html: string, text: string): boolean {
  const promoPatterns = /offer|save|promotion|price\s*drop|reduced|multi.?buy/i;
  return promoPatterns.test(html) || promoPatterns.test(text);
}
