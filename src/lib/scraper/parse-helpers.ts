/** Strip HTML tags to produce plain text */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a price string like "€1.99", "1,99", "1.99" → number */
export function parsePrice(str: string): number | undefined {
  if (!str) return undefined;
  const cleaned = str.replace(/[€£\s,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

/** Extract og:image URL */
export function extractOgImage(html: string): string | undefined {
  const m =
    html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ??
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
  return m?.[1]?.trim();
}

/** Detect availability from HTML text */
export function extractIsAvailable(html: string): boolean | undefined {
  if (/out[\s-]of[\s-]stock|sold\s+out|unavailable|not\s+available|currently\s+unavailable/i.test(html)) {
    return false;
  }
  if (/add\s+to\s+(cart|basket|trolley)|in\s+stock/i.test(html)) {
    return true;
  }
  return undefined;
}

/** Parse all JSON-LD blocks in HTML; return the first Product schema found */
export function extractJsonLdProduct(html: string): Record<string, unknown> | null {
  const blocks = [...html.matchAll(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      const data = JSON.parse(block[1]) as Record<string, unknown>;
      if (data['@type'] === 'Product') return data;
      // Sometimes it's an array or graph
      if (Array.isArray(data['@graph'])) {
        const product = (data['@graph'] as Record<string, unknown>[]).find((n) => n['@type'] === 'Product');
        if (product) return product;
      }
    } catch {
      // skip malformed
    }
  }
  return null;
}

/** Safely get offer price and currency from JSON-LD Product data */
export function extractJsonLdOffer(data: Record<string, unknown>): {
  price?: number;
  was_price?: number;
  currency?: string;
  availability?: boolean;
} {
  const offers = data['offers'];
  if (!offers) return {};

  const offer = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown>;
  const priceStr = String(offer['price'] ?? '');
  const price = parseFloat(priceStr);
  const currency = typeof offer['priceCurrency'] === 'string' ? offer['priceCurrency'] : undefined;
  const availStr = typeof offer['availability'] === 'string' ? offer['availability'].toLowerCase() : '';
  const availability = availStr.includes('instock')
    ? true
    : availStr.includes('outofstock') || availStr.includes('discontinued')
      ? false
      : undefined;

  return {
    price: isNaN(price) ? undefined : price,
    currency,
    availability,
  };
}

/** Extract price_per_unit and unit from text like "€0.50/100g" or "50c per 100ml" */
export function extractPricePerUnit(html: string): { price_per_unit?: number; unit?: string } {
  // Match patterns like €0.50/100g, €1.20/kg, €2.50 per litre
  const m = html.match(/[€£]?\s*(\d+[.,]?\d*)\s*(?:\/|per\s+)(\d*\s*(?:kg|g|l|ml|litre|liter|each|unit|100g|100ml))/i);
  if (!m) return {};
  const price_per_unit = parseFloat(m[1].replace(',', '.'));
  const unit = m[2].trim().toLowerCase();
  return { price_per_unit: isNaN(price_per_unit) ? undefined : price_per_unit, unit };
}
