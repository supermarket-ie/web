export const MAX_SHOP_LINES = 200;
export const MAX_LINE_QUANTITY = 20;

export class ShoppingActionRejected extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
    this.name = 'ShoppingActionRejected';
  }
}

export function requireCanonicalProductId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ShoppingActionRejected('canonical_product_required', 'An exact canonical product must be resolved before this action.');
  }
  return value.trim();
}

export function requireSensibleQuantity(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_LINE_QUANTITY) {
    throw new ShoppingActionRejected('invalid_quantity', `Quantity must be a whole number between 1 and ${MAX_LINE_QUANTITY}.`);
  }
  return Number(value);
}

export function requireLineCapacity(currentLines: number, additionalLines: number) {
  if (currentLines + additionalLines > MAX_SHOP_LINES) {
    throw new ShoppingActionRejected('shop_line_limit', `A shop cannot contain more than ${MAX_SHOP_LINES} lines.`);
  }
}

export function requireMatchingTrustedOffer(input: {
  requestedCanonicalProductId: string;
  offerCanonicalProductId: unknown;
  relationshipType: unknown;
  freshnessState: unknown;
  price: unknown;
}) {
  const requested = requireCanonicalProductId(input.requestedCanonicalProductId);
  if (String(input.offerCanonicalProductId) !== requested || input.relationshipType !== 'exact' || input.freshnessState !== 'fresh') {
    throw new ShoppingActionRejected('untrusted_offer', 'The current retailer offer does not match the resolved canonical product.');
  }
  const price = Number(input.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new ShoppingActionRejected('untrusted_price', 'The current retailer offer has no trusted positive price.');
  }
  return price;
}
