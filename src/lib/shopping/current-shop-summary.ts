export interface CurrentShopLine {
  label: string;
  category: string;
  quantity: number;
  price: number | null;
  unresolved: boolean;
}

export interface CurrentShopSummary {
  id: string;
  name: string;
  generatedAt: string;
  itemCount: number;
  estimatedTotal: number;
  unresolvedCount: number;
  lines: CurrentShopLine[];
}

type StoredShopItem = {
  canonical_name?: unknown;
  display_label?: unknown;
  category?: unknown;
  quantity?: unknown;
  price?: unknown;
  unresolved_need?: unknown;
  coverage_status?: unknown;
};

export function currentShopSummary(row: {
  id: string;
  name: string | null;
  generated_at: string | null;
  created_at: string;
  items: unknown;
} | null): CurrentShopSummary | null {
  if (!row || !Array.isArray(row.items)) return null;

  const lines = (row.items as StoredShopItem[]).flatMap(item => {
    const labelValue = item.display_label ?? item.canonical_name ?? item.unresolved_need;
    if (typeof labelValue !== 'string' || !labelValue.trim()) return [];
    const quantity = Number(item.quantity);
    const price = Number(item.price);
    const hasCoverageStatus = typeof item.coverage_status === 'string';
    const unresolved = typeof item.unresolved_need === 'string'
      || (hasCoverageStatus && item.coverage_status !== 'resolved')
      || (!hasCoverageStatus && (!Number.isFinite(price) || price <= 0));
    return [{
      label: labelValue.trim(),
      category: typeof item.category === 'string' && item.category.trim() ? item.category.trim() : 'Other',
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      price: !unresolved && Number.isFinite(price) && price > 0 ? price : null,
      unresolved,
    }];
  });

  if (!lines.length) return null;
  const estimatedTotal = lines.reduce((sum, item) => sum + ((item.price ?? 0) * item.quantity), 0);
  return {
    id: row.id,
    name: row.name?.trim() || 'Current household shop',
    generatedAt: row.generated_at ?? row.created_at,
    itemCount: lines.length,
    estimatedTotal: Math.round(estimatedTotal * 100) / 100,
    unresolvedCount: lines.filter(item => item.unresolved).length,
    lines,
  };
}
