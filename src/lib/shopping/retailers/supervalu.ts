import type {
  BasketItem,
  RetailerHandoffItem,
  RetailerHandoffResult,
  RetailerOffer,
  ShoppingBasket,
} from '../contracts';
import type { RetailerAdapter } from './adapter';

const RETAILER = 'supervalu';
const SUPERVALU_HOST = 'shop.supervalu.ie';
const SUPERVALU_CART_URL = 'https://shop.supervalu.ie/cart';

function isSuperValu(offer?: RetailerOffer | null) {
  return offer?.retailer.toLowerCase() === RETAILER;
}

function validSuperValuUrl(url?: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === SUPERVALU_HOST
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function findOffer(item: BasketItem): RetailerOffer | null {
  if (isSuperValu(item.selected_offer)) return item.selected_offer ?? null;
  return item.alternatives?.find(isSuperValu) ?? null;
}

function toHandoffItem(item: BasketItem): RetailerHandoffItem {
  const offer = findOffer(item);
  const retailerUrl = validSuperValuUrl(offer?.retailer_url);
  const matched = Boolean(offer && (offer.retailer_product_id || retailerUrl));

  return {
    canonical_name: item.canonical_name,
    quantity: item.quantity ?? 1,
    retailer_product_id: offer?.retailer_product_id ?? null,
    retailer_product_name: offer?.retailer_product_name ?? null,
    retailer_url: retailerUrl,
    status: matched ? 'matched' : 'missing',
  };
}

export const superValuAdapter: RetailerAdapter = {
  retailer: RETAILER,
  prepareHandoff(basket: ShoppingBasket): RetailerHandoffResult {
    const items = basket.items.map(toHandoffItem);
    const unmatched = items
      .filter(item => item.status === 'missing')
      .map(item => item.canonical_name);
    const matchedItems = items.length - unmatched.length;

    if (!items.length) {
      return {
        retailer: RETAILER,
        status: 'failed',
        method: 'product_links',
        matched_items: 0,
        unmatched_items: [],
        items,
        cart_url: SUPERVALU_CART_URL,
        checkout_url: SUPERVALU_CART_URL,
        requires_retailer_login: true,
        message: 'The basket is empty, so there is nothing to hand off to SuperValu.',
      };
    }

    return {
      retailer: RETAILER,
      status: unmatched.length ? 'partial' : 'ready',
      method: 'product_links',
      matched_items: matchedItems,
      unmatched_items: unmatched,
      items,
      cart_url: SUPERVALU_CART_URL,
      checkout_url: SUPERVALU_CART_URL,
      requires_retailer_login: true,
      message: unmatched.length
        ? `${matchedItems} of ${items.length} basket items are mapped to SuperValu. Cart prefill is not yet enabled; mapped product links are ready for the handoff flow.`
        : `All ${items.length} basket items are mapped to SuperValu. Cart prefill is not yet enabled; mapped product links are ready for the handoff flow.`,
    };
  },
};
