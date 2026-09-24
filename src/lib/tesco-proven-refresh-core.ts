export type PepestoSessionEvidence = {
  run_uuid: string;
  products: unknown;
  result_summary: { items?: unknown } | null;
};

type SessionProduct = {
  storeProductId?: unknown;
  productId?: unknown;
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

export function oneProductSearchAttemptCanonicalIds(
  sessions: PepestoSessionEvidence[],
  canonicalByStoreProductId: Map<string, string>,
) {
  const ids = new Set<string>();
  for (const session of sessions) {
    if (!Array.isArray(session.products) || session.products.length !== 1) continue;
    const product = session.products[0] as SessionProduct | undefined;
    const storeId = product?.storeProductId ? String(product.storeProductId) : null;
    const canonical = product?.productId ? String(product.productId) : (storeId ? canonicalByStoreProductId.get(storeId) : null);
    if (canonical) ids.add(canonical);
  }
  return ids;
}

export type CanonicalSelectionCandidate<T> = {
  productId: string; storeProductId: string; demandUnits: number;
  proven: boolean; resolved: boolean; audited: boolean; observedAt?: string | null; value: T;
};

export function selectUniqueCanonicalCandidates<T>(
  candidates: CanonicalSelectionCandidate<T>[], limit: number, excludedCanonicalIds = new Set<string>(),
) {
  const best = new Map<string, CanonicalSelectionCandidate<T>>();
  const score = (x: CanonicalSelectionCandidate<T>) => [Number(x.proven), Number(x.resolved), Number(x.audited), x.observedAt ?? '', x.storeProductId] as const;
  for (const candidate of candidates) {
    if (excludedCanonicalIds.has(candidate.productId)) continue;
    const current = best.get(candidate.productId);
    if (!current || score(candidate).join('|') > score(current).join('|')) best.set(candidate.productId, candidate);
  }
  return [...best.values()].sort((a, b) =>
    Number(b.demandUnits > 0) - Number(a.demandUnits > 0)
    || b.demandUnits - a.demandUnits
    || Number(b.proven) - Number(a.proven)
    || Number(b.resolved) - Number(a.resolved)
    || a.productId.localeCompare(b.productId)
    || a.storeProductId.localeCompare(b.storeProductId)
  ).slice(0, Math.max(0, Math.floor(limit)));
}
