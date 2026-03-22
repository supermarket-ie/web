/** Single source of truth for store brand styling.
 *  Import from here — never redefine storeStyle() locally.
 */

export interface StoreStyle {
  bg: string;
  text: string;
  light: string;
  border: string;
}

export function storeStyle(store: string): StoreStyle {
  const s = store.toLowerCase();
  if (s.includes('tesco'))     return { bg: 'var(--store-tesco)',     text: '#fff', light: '#EEF3FB', border: 'var(--store-tesco)' };
  if (s.includes('dunnes'))    return { bg: 'var(--store-dunnes)',    text: '#fff', light: '#FAEAEC', border: 'var(--store-dunnes)' };
  if (s.includes('supervalu')) return { bg: 'var(--store-supervalu)', text: '#fff', light: '#FEF0E8', border: 'var(--store-supervalu)' };
  return { bg: 'var(--on-surface)', text: '#fff', light: 'var(--surface-container-low)', border: 'var(--on-surface)' };
}

export function storeDisplayName(store: string): string {
  const s = store.toLowerCase();
  if (s.includes('tesco'))     return 'Tesco';
  if (s.includes('dunnes'))    return 'Dunnes';
  if (s.includes('supervalu')) return 'SuperValu';
  return store;
}
