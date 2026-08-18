import { agentSupabase } from './supabase';

export type AgentListItem = {
  canonical_name: string;
  category?: string;
  store?: string;
  price?: number;
  quantity?: number;
  on_promotion?: boolean;
  store_product_name?: string;
};

export type CurrentPrice = {
  canonical_name: string;
  category: string | null;
  store: string;
  price: number;
  on_promotion: boolean | null;
  store_product_name: string | null;
};

export function computeStoreTotals(items: AgentListItem[]) {
  const grouped = new Map<string, { store: string; total: number; item_count: number }>();
  for (const item of items) {
    if (!item.store || typeof item.price !== 'number') continue;
    const quantity = item.quantity ?? 1;
    const row = grouped.get(item.store) ?? { store: item.store, total: 0, item_count: 0 };
    row.total += item.price * quantity;
    row.item_count += quantity;
    grouped.set(item.store, row);
  }
  return [...grouped.values()].map(row => ({
    ...row,
    total: Number(row.total.toFixed(2)),
  }));
}

export async function loadCurrentShop(subscriberId: string) {
  const { data, error } = await agentSupabase
    .from('saved_lists')
    .select('id, name, family_size, items, store_totals, recommended_store, generated_at, created_at')
    .eq('subscriber_id', subscriberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Unable to load the current shop: ${error.message}`);
  if (!data) return null;

  return {
    ...data,
    items: ((data.items ?? []) as AgentListItem[]).map(item => ({ ...item })),
  };
}

export async function getBestCurrentPrice(canonicalName: string): Promise<CurrentPrice | null> {
  const { data, error } = await agentSupabase
    .from('latest_prices')
    .select('canonical_name, category, store, price, on_promotion, store_product_name')
    .eq('canonical_name', canonicalName)
    .order('price', { ascending: true })
    .limit(1);

  if (error) throw new Error(`Unable to fetch current product price: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  return {
    canonical_name: row.canonical_name,
    category: row.category ?? null,
    store: row.store,
    price: Number(row.price),
    on_promotion: row.on_promotion ?? null,
    store_product_name: row.store_product_name ?? null,
  };
}

export async function persistCurrentShop(
  subscriberId: string,
  listId: string,
  items: AgentListItem[],
) {
  const storeTotals = computeStoreTotals(items);
  const { error } = await agentSupabase
    .from('saved_lists')
    .update({
      items,
      store_totals: storeTotals,
      generated_at: new Date().toISOString(),
    })
    .eq('id', listId)
    .eq('subscriber_id', subscriberId);

  if (error) throw new Error(`Unable to update the current shop: ${error.message}`);

  return storeTotals;
}
