import type { WeeklyItem } from './weekly-shop';

export const SHOP_BUILDER_PATH = '/compare/supermarket-prices-ireland';
export const SHOP_BUILDER_LIMIT = 50;
export const SHOP_DRAFT_KEY = 'smi_comparison_shop_v1';
export type ShopProduct = WeeklyItem & { category: string };
export type ShopDraft = {
  items: Pick<WeeklyItem, 'id' | 'name' | 'quantity'>[];
  adults: string;
  children: string;
  budget: string;
  needs: string;
  completeWeek: boolean;
  entryPath?: string;
};

export function addProductToDraft(draft: ShopDraft | null, item: ShopDraft['items'][number], entryPath: string): ShopDraft {
  const current = draft ?? { items: [], adults: '2', children: '0', budget: '', needs: '', completeWeek: false };
  const existing = current.items.find(line => line.id === item.id);
  if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity + (existing?.quantity ?? 0) > 20) {
    throw new RangeError('A product can have up to 20 units. Adjust its quantity in your shop.');
  }
  if (!existing && current.items.length >= SHOP_BUILDER_LIMIT) throw new RangeError('Your shop already has 50 products. Remove one in your shop before adding another.');
  return {
    ...current,
    items: existing ? current.items.map(line => line.id === item.id ? { ...line, quantity: line.quantity + item.quantity } : line) : [...current.items, { id: item.id, name: item.name, quantity: item.quantity }],
    entryPath: current.entryPath ?? entryPath,
  };
}

export function shopBuilderPrompt(draft: ShopDraft): string {
  return [
    `Prepare a household shop for ${draft.adults} adult${draft.adults === '1' ? '' : 's'} and ${draft.children} ${draft.children === '1' ? 'child' : 'children'}.`,
    draft.budget ? `My budget for this shop is €${draft.budget}.` : 'I have not set a budget.',
    draft.items.length ? 'I selected these products. Quantities are the number of packs or individual items as named:' : '',
    ...draft.items.map(item => `${item.quantity} × ${item.name}`),
    draft.needs.trim() ? `My shopping needs and preferences: ${draft.needs.trim()}` : '',
    draft.completeWeek
      ? 'Use my selected products as the starting list and fill out the rest of a weekly household shop around my needs.'
      : 'Keep to my selected products and the needs I described; do not add an unsolicited full weekly shop.',
    'Prepare a first draft now, preserving quantities and pack sizes. Use current matched prices, flag missing prices and state any necessary assumptions. I want to review it before saving.',
  ].filter(Boolean).join('\n');
}

// Persist intentions only. Prices are always reloaded from the trusted boundary.
export function readShopDraft(raw: string | null, now = Date.now()): ShopDraft | null {
  try {
    if (!raw || raw.length > 24000) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.createdAt !== 'number' || value.createdAt > now || now - value.createdAt > 30 * 60 * 1000 ||
        !Array.isArray(value.items) || value.items.length > SHOP_BUILDER_LIMIT ||
        typeof value.adults !== 'string' || !/^(?:[1-9]|1\d|20)$/.test(value.adults) ||
        typeof value.children !== 'string' || !/^(?:\d|1\d|20)$/.test(value.children) ||
        typeof value.budget !== 'string' || (value.budget !== '' && (!Number.isFinite(Number(value.budget)) || Number(value.budget) < 1 || Number(value.budget) > 10000)) ||
        typeof value.needs !== 'string' || value.needs.length > 2000 || typeof value.completeWeek !== 'boolean') return null;
    const ids = new Set<string>();
    const items: ShopDraft['items'] = [];
    for (const item of value.items) {
      if (!item || typeof item.id !== 'string' || !/^[a-f\d-]{36}$/i.test(item.id) || ids.has(item.id) ||
          typeof item.name !== 'string' || !item.name.trim() || item.name.length > 160 ||
          !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) return null;
      ids.add(item.id);
      items.push({ id: item.id, name: item.name, quantity: item.quantity });
    }
    const entryPath = typeof value.entryPath === 'string' && /^\/browse\/[a-z0-9-]{1,240}$/.test(value.entryPath) ? value.entryPath : undefined;
    return { items, adults: value.adults, children: value.children, budget: value.budget, needs: value.needs, completeWeek: value.completeWeek, ...(entryPath ? { entryPath } : {}) };
  } catch { return null; }
}
