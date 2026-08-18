import type { HouseholdContext, ShoppingBasket } from './contracts';
import { chooseRetailerOffer } from './basket';

export type ShoppingHistoryItem = {
  canonical_name: string;
  category: string | null;
  store: string;
  price_paid: number;
  quantity: number;
  observed_at: string;
};

export type CurrentCataloguePrice = {
  canonical_name: string;
  category: string | null;
  store: string;
  price: number;
  on_promotion: boolean | null;
  store_product_name?: string | null;
};

export type ExistingShopItem = {
  canonical_name: string;
  category?: string | null;
  store?: string | null;
  price?: number | null;
  quantity?: number | null;
};

export type ShopDecision = {
  canonical_name: string;
  action: 'included' | 'suggested' | 'not_added';
  confidence: 'include' | 'suggest' | 'suppress';
  reason: string;
  signals: string[];
  sources: Array<'history' | 'replenishment' | 'meal_plan' | 'ingredient_intelligence' | 'preference' | 'catalogue'>;
  days_since_last_bought?: number | null;
  typical_interval_days?: number | null;
  meal_count?: number;
  price?: number | null;
  store?: string | null;
  on_promotion?: boolean;
};

export type ShopPreparationSnapshot = {
  household: HouseholdContext;
  history: ShoppingHistoryItem[];
  current_items: ExistingShopItem[];
  catalogue_prices: CurrentCataloguePrice[];
  now?: Date;
};

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function daysBetween(a: Date, b: Date) {
  return Math.max(0, (a.getTime() - b.getTime()) / 86400000);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isDisliked(name: string, raw?: string | null) {
  if (!raw) return false;
  const product = normalise(name);
  return raw
    .split(/[,;\n]/)
    .map(normalise)
    .filter(Boolean)
    .some(value => product.includes(value) || value.includes(product));
}

function stoppedBuying(name: string, context: HouseholdContext) {
  const memory = context.memory ?? {};
  const values = [
    memory.stoppedItems,
    memory.stopped_items,
    memory.droppedItems,
    memory.dropped_items,
  ].flatMap(value => (Array.isArray(value) ? value : []));
  return values.some(value => normalise(String(value)) === normalise(name));
}

export function prepareHouseholdShop(
  snapshot: ShopPreparationSnapshot,
  options?: { violatesDietary?: (canonicalName: string, dietary: string[]) => boolean },
) {
  const now = snapshot.now ?? new Date();
  const grouped = new Map<string, ShoppingHistoryItem[]>();
  for (const row of snapshot.history) {
    const rows = grouped.get(row.canonical_name) ?? [];
    rows.push(row);
    grouped.set(row.canonical_name, rows);
  }

  const candidateNames = [...new Set([
    ...grouped.keys(),
    ...snapshot.current_items.map(item => item.canonical_name),
  ])];
  const decisions: ShopDecision[] = [];
  const basket: ShoppingBasket = {
    household_id: snapshot.household.subscriber_id,
    items: [],
    generated_at: now.toISOString(),
  };

  for (const name of candidateNames) {
    const rows = grouped.get(name) ?? [];
    const blocked =
      stoppedBuying(name, snapshot.household) ||
      isDisliked(name, snapshot.household.dislikes) ||
      Boolean(options?.violatesDietary?.(name, snapshot.household.dietary));

    if (blocked) {
      decisions.push({
        canonical_name: name,
        action: 'not_added',
        confidence: 'suppress',
        reason: 'Not added because an explicit household preference outranks inferred shopping history.',
        signals: ['explicit household preference'],
        sources: ['preference'],
      });
      continue;
    }

    const dates = rows
      .map(row => new Date(row.observed_at))
      .sort((a, b) => b.getTime() - a.getTime());
    const intervals = dates
      .slice(0, -1)
      .map((date, index) => daysBetween(date, dates[index + 1]))
      .filter(value => value >= 1 && value <= 90);
    const interval = median(intervals);
    const daysSince = dates[0] ? daysBetween(now, dates[0]) : null;
    const latestListItem = snapshot.current_items.find(item => item.canonical_name === name);
    const frequent = rows.length >= 2;
    const due = interval != null && daysSince != null && daysSince >= Math.max(1, interval * 0.8);
    const veryRecent = interval != null && daysSince != null && daysSince < interval * 0.45;
    const include = due || (frequent && interval == null && Boolean(latestListItem));

    const priceRows = snapshot.catalogue_prices.filter(row => row.canonical_name === name);
    const offer = chooseRetailerOffer(
      priceRows.map(row => ({
        retailer: row.store,
        retailer_product_name: row.store_product_name ?? row.canonical_name,
        price: Number(row.price),
        was_price: null,
        on_promotion: Boolean(row.on_promotion),
      })),
      snapshot.household.preferred_stores,
    );

    if (include && offer) {
      const quantity = rows[0]?.quantity ?? latestListItem?.quantity ?? 1;
      basket.items.push({
        canonical_name: name,
        category: priceRows[0]?.category ?? rows[0]?.category ?? latestListItem?.category ?? null,
        quantity: Number(quantity) || 1,
        selected_offer: offer,
        alternatives: priceRows
          .filter(row => row.store !== offer.retailer || Number(row.price) !== offer.price)
          .map(row => ({
            retailer: row.store,
            retailer_product_name: row.store_product_name ?? row.canonical_name,
            price: Number(row.price),
            was_price: null,
            on_promotion: Boolean(row.on_promotion),
          })),
        source: due ? 'replenishment' : 'history',
      });
      decisions.push({
        canonical_name: name,
        action: 'included',
        confidence: 'include',
        reason: interval && daysSince != null
          ? `Usually bought about every ${Math.round(interval)} days; last bought ${Math.round(daysSince)} days ago.`
          : 'Frequently bought household item and present in the recent shop pattern.',
        signals: ['usual product', due ? 'replenishment due' : 'frequent purchase', offer.on_promotion ? 'current promotion' : 'current price'],
        sources: ['history', 'replenishment', 'catalogue'],
        days_since_last_bought: daysSince == null ? null : Math.round(daysSince),
        typical_interval_days: interval == null ? null : Math.round(interval),
        price: offer.price,
        store: offer.retailer,
        on_promotion: offer.on_promotion,
      });
    } else if (veryRecent) {
      decisions.push({
        canonical_name: name,
        action: 'not_added',
        confidence: 'suppress',
        reason: `Bought recently${daysSince != null ? ` (${Math.round(daysSince)} days ago)` : ''}; unlikely to be due yet.`,
        signals: ['recent purchase', 'not replenishment due'],
        sources: ['history', 'replenishment'],
        days_since_last_bought: daysSince == null ? null : Math.round(daysSince),
        typical_interval_days: interval == null ? null : Math.round(interval),
      });
    }
  }

  return {
    ok: basket.items.length > 0 || snapshot.history.length > 0 || snapshot.current_items.length > 0,
    basket,
    decisions,
    suggestions: decisions.filter(decision => decision.action === 'suggested'),
    suppressed: decisions.filter(decision => decision.action === 'not_added'),
  };
}

export function appendShopSuggestions(
  result: ReturnType<typeof prepareHouseholdShop>,
  suggestions: ShopDecision[],
) {
  const decisions = [...result.decisions, ...suggestions];
  return {
    ...result,
    decisions,
    suggestions: decisions.filter(decision => decision.action === 'suggested'),
    suppressed: decisions.filter(decision => decision.action === 'not_added'),
  };
}
