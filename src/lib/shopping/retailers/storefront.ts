export type StorefrontRetailer = 'supervalu' | 'dunnes';

export type StorefrontExecutionConfig = {
  retailer: StorefrontRetailer;
  platform: 'instacart_storefront';
  productHosts: readonly string[];
  gatewayHost: string;
  cartResourceConfirmed: boolean;
  authRequired: boolean;
  singleAddContractConfirmed: boolean;
  bulkAddContractConfirmed: boolean;
  mutationEnabled: boolean;
  knownShoppingModeId?: string | null;
};

export type StorefrontProductReference = {
  retailer: StorefrontRetailer;
  retailerUrl: string;
  retailerProductId?: string | null;
  quantity?: number | null;
};

export type StorefrontBasketContext = {
  retailer: StorefrontRetailer;
  retailerStoreId: string;
  items: Array<{
    retailerUrl: string;
    retailerProductId: string | null;
    quantity: number;
  }>;
};

const DELIVERY_SHOPPING_MODE_ID = '22222222-2222-2222-2222-222222222222';

export const STOREFRONT_EXECUTION_CONFIG: Record<StorefrontRetailer, StorefrontExecutionConfig> = {
  supervalu: {
    retailer: 'supervalu',
    platform: 'instacart_storefront',
    productHosts: ['shop.supervalu.ie'],
    gatewayHost: 'storefrontgateway.supervalu.ie',
    cartResourceConfirmed: true,
    authRequired: true,
    singleAddContractConfirmed: true,
    bulkAddContractConfirmed: true,
    // The cart mutation contract is understood, but Supermarket.ie still has no
    // approved no-extension shopper-auth execution context. Keep actual mutation off.
    mutationEnabled: false,
    knownShoppingModeId: null,
  },
  dunnes: {
    retailer: 'dunnes',
    platform: 'instacart_storefront',
    productHosts: ['www.dunnesstoresgrocery.com'],
    gatewayHost: 'storefrontgateway.dunnesstoresgrocery.com',
    cartResourceConfirmed: true,
    authRequired: true,
    singleAddContractConfirmed: false,
    bulkAddContractConfirmed: false,
    // Read-only probing confirms GET/POST cart resource + auth boundary, but the
    // exact Dunnes mutation media type/body has not yet been independently proven.
    mutationEnabled: false,
    knownShoppingModeId: DELIVERY_SHOPPING_MODE_ID,
  },
};

export function getStorefrontExecutionConfig(retailer: string): StorefrontExecutionConfig | null {
  const key = retailer.toLowerCase() as StorefrontRetailer;
  return STOREFRONT_EXECUTION_CONFIG[key] ?? null;
}

export function extractRetailerStoreId(retailerUrl: string): string | null {
  try {
    const url = new URL(retailerUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    const rsidIndex = segments.findIndex(segment => segment.toLowerCase() === 'rsid');
    if (rsidIndex < 0) return null;
    const value = segments[rsidIndex + 1];
    return value && /^\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function isAllowedStorefrontProductUrl(retailer: StorefrontRetailer, retailerUrl: string): boolean {
  const config = STOREFRONT_EXECUTION_CONFIG[retailer];
  try {
    const url = new URL(retailerUrl);
    return url.protocol === 'https:' && config.productHosts.includes(url.hostname);
  } catch {
    return false;
  }
}

export function prepareStorefrontBasketContext(
  retailer: StorefrontRetailer,
  products: StorefrontProductReference[],
): StorefrontBasketContext {
  if (!products.length) throw new Error('Storefront basket requires at least one product.');

  const storeIds = new Set<string>();
  const items = products.map(product => {
    if (product.retailer !== retailer) {
      throw new Error(`Cannot mix ${product.retailer} product data into a ${retailer} Storefront basket.`);
    }
    if (!isAllowedStorefrontProductUrl(retailer, product.retailerUrl)) {
      throw new Error(`Invalid ${retailer} Storefront product URL.`);
    }

    const retailerStoreId = extractRetailerStoreId(product.retailerUrl);
    if (!retailerStoreId) throw new Error(`Missing retailer store context (rsid) for ${retailer}.`);
    storeIds.add(retailerStoreId);

    return {
      retailerUrl: product.retailerUrl,
      retailerProductId: product.retailerProductId ?? null,
      quantity: Math.max(1, Math.floor(product.quantity ?? 1)),
    };
  });

  if (storeIds.size !== 1) {
    throw new Error(`Storefront basket spans multiple ${retailer} store contexts.`);
  }

  return {
    retailer,
    retailerStoreId: [...storeIds][0],
    items,
  };
}

export function assertStorefrontMutationAllowed(retailer: StorefrontRetailer): void {
  const config = STOREFRONT_EXECUTION_CONFIG[retailer];
  if (!config.mutationEnabled) {
    const reason = retailer === 'dunnes'
      ? 'Dunnes cart mutation is disabled until its exact authenticated Storefront POST contract is independently confirmed.'
      : 'SuperValu cart mutation is disabled until an approved shopper-authorised no-extension execution context exists.';
    throw new Error(reason);
  }
}
