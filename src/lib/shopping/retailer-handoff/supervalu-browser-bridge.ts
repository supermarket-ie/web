const SUPERVALU_HOST = 'shop.supervalu.ie';
const BRIDGE_FRAGMENT = 'supermarket-ie-cart=';

export type SupervaluBrowserBridgeItem = {
  sku: string;
  quantity: number;
  productUrl: string;
  name?: string;
};

export type SupervaluBrowserBridgePayload = {
  version: 1;
  retailer: 'supervalu';
  items: SupervaluBrowserBridgeItem[];
  createdAt: string;
};

function assertSafeProductUrl(productUrl: string) {
  const url = new URL(productUrl);
  if (url.protocol !== 'https:' || url.hostname !== SUPERVALU_HOST) {
    throw new Error('SuperValu browser bridge only accepts https://shop.supervalu.ie product URLs');
  }
  if (!/\/rsid\/\d+\/product\//.test(url.pathname)) {
    throw new Error('SuperValu browser bridge requires a store-scoped product URL');
  }
  return url;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function buildSupervaluBrowserBridgeUrl(items: SupervaluBrowserBridgeItem[]) {
  if (!items.length) throw new Error('At least one SuperValu item is required');
  if (items.length > 50) throw new Error('Browser bridge proof of concept is limited to 50 items');

  const normalizedItems = items.map((item) => {
    const productUrl = assertSafeProductUrl(item.productUrl);
    if (!item.sku.trim()) throw new Error('Each SuperValu item requires a SKU');
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error('Each SuperValu item requires a positive integer quantity');
    }

    return {
      sku: item.sku.trim(),
      quantity: item.quantity,
      productUrl: productUrl.toString(),
      ...(item.name?.trim() ? { name: item.name.trim() } : {}),
    };
  });

  const payload: SupervaluBrowserBridgePayload = {
    version: 1,
    retailer: 'supervalu',
    items: normalizedItems,
    createdAt: new Date().toISOString(),
  };

  const firstUrl = new URL(normalizedItems[0].productUrl);
  firstUrl.hash = `${BRIDGE_FRAGMENT}${encodeBase64Url(JSON.stringify(payload))}`;
  return firstUrl.toString();
}
