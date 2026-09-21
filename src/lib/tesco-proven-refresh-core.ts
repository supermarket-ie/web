export type PepestoSessionEvidence = {
  run_uuid: string;
  products: unknown;
  result_summary: { items?: unknown } | null;
};

type SessionProduct = {
  storeProductId?: unknown;
};

export function independentlyReturnedProductIds(sessions: PepestoSessionEvidence[]) {
  const ids = new Set<string>();
  for (const session of sessions) {
    if (!Array.isArray(session.products)) continue;
    const returnedItems = Number(session.result_summary?.items ?? 0);
    if (returnedItems !== session.products.length) continue;
    for (const product of session.products as SessionProduct[]) {
      if (product?.storeProductId) ids.add(String(product.storeProductId));
    }
  }
  return ids;
}

export function oneProductSearchAttemptIds(sessions: PepestoSessionEvidence[]) {
  const ids = new Set<string>();
  for (const session of sessions) {
    if (!Array.isArray(session.products) || session.products.length !== 1) continue;
    const product = session.products[0] as SessionProduct | undefined;
    if (product?.storeProductId) ids.add(String(product.storeProductId));
  }
  return ids;
}
