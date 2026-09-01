import type { ProductPrice } from '@/lib/price-data';
import { storeDisplayName } from '@/lib/store-utils';

export type MarketStarterIcon = 'offer' | 'compare' | 'meal' | 'shop';

export type MarketStarter = {
  label: string;
  detail: string;
  prompt: string;
  icon: MarketStarterIcon;
  signal: 'live_offer' | 'store_comparison' | 'meal_opportunity' | 'market_overview';
};

const MEAL_CATEGORIES = new Set([
  'bakery', 'chilled', 'dairy', 'fish', 'frozen', 'meat', 'pasta & rice',
  'vegetables', 'fruit', 'tinned',
]);

const HOUSEHOLD_CATEGORIES = new Set([
  'baby', 'household', 'household essentials', 'laundry', 'cleaning',
  'personal care', 'pet care', 'toiletries',
]);

function euro(value: number) {
  return `€${value.toFixed(2)}`;
}

function cleanProductName(value: string) {
  const cleaned = value
    .replace(/^(?:Dunnes Stores|SuperValu|Tesco|Aldi)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= 46) return cleaned;
  const shortened = cleaned.slice(0, 43).replace(/\s+\S*$/, '');
  return `${shortened || cleaned.slice(0, 43)}…`;
}

function dealSaving(row: ProductPrice) {
  return row.was_price != null && row.was_price > row.price
    ? row.was_price - row.price
    : 0;
}

function dealPercentage(row: ProductPrice) {
  return row.was_price != null && row.was_price > row.price
    ? Math.round((dealSaving(row) / row.was_price) * 100)
    : 0;
}

function currentDeals(prices: ProductPrice[]) {
  const seen = new Set<string>();
  return prices
    .filter(row => row.on_promotion && row.was_price != null && row.was_price > row.price)
    .sort((a, b) => dealPercentage(b) - dealPercentage(a) || dealSaving(b) - dealSaving(a))
    .filter(row => {
      const key = row.canonical_name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function comparisonCandidate(prices: ProductPrice[]) {
  const grouped = new Map<string, ProductPrice[]>();
  for (const row of prices) {
    const rows = grouped.get(row.canonical_name) ?? [];
    rows.push(row);
    grouped.set(row.canonical_name, rows);
  }

  return [...grouped.values()]
    .filter(rows => new Set(rows.map(row => row.store)).size >= 2)
    .map(rows => {
      const ordered = [...rows].sort((a, b) => a.price - b.price);
      return {
        rows: ordered,
        spread: ordered.at(-1)!.price - ordered[0].price,
      };
    })
    .filter(candidate => candidate.spread >= 0.2)
    .sort((a, b) => b.spread - a.spread)[0] ?? null;
}

function fallbackStarters(): MarketStarter[] {
  return [
    { label: 'What offers are genuinely useful today?', detail: 'Check verified current promotions across Irish supermarkets', prompt: 'Show me the most useful current supermarket offers for a household shop', icon: 'offer', signal: 'market_overview' },
    { label: 'Where are everyday essentials best value?', detail: 'Compare current matched products across stores', prompt: 'Compare current prices for useful everyday household essentials', icon: 'compare', signal: 'store_comparison' },
    { label: 'Plan dinners around current value', detail: 'Use available products and practical reusable ingredients', prompt: 'Plan four practical dinners around products that are good value now', icon: 'meal', signal: 'meal_opportunity' },
    { label: 'Build a complete value-led shop', detail: 'Balance food, cleaning and toiletries in one shop', prompt: 'Build a sensible complete household shop using current supermarket value', icon: 'shop', signal: 'market_overview' },
  ];
}

export function buildMarketStarters(prices: ProductPrice[]): MarketStarter[] {
  if (prices.length === 0) return fallbackStarters();

  const deals = currentDeals(prices);
  const mealDeal = deals.find(row => MEAL_CATEGORIES.has(row.category.toLowerCase())) ?? deals[0];
  const householdDeal = deals.find(row => HOUSEHOLD_CATEGORIES.has(row.category.toLowerCase()) && row.canonical_name !== mealDeal?.canonical_name)
    ?? deals.find(row => row.canonical_name !== mealDeal?.canonical_name);
  const comparison = comparisonCandidate(prices);
  const starters: MarketStarter[] = [];

  if (mealDeal) {
    const name = cleanProductName(mealDeal.canonical_name);
    starters.push({
      label: `Build a meal around ${name}`,
      detail: `${dealPercentage(mealDeal)}% off at ${storeDisplayName(mealDeal.store)} today`,
      prompt: `Build a practical family meal around ${mealDeal.canonical_name}, which is currently on offer at ${storeDisplayName(mealDeal.store)}`,
      icon: 'meal',
      signal: 'meal_opportunity',
    });
  }

  if (householdDeal) {
    const name = cleanProductName(householdDeal.canonical_name);
    starters.push({
      label: `Is ${name} worth stocking up on?`,
      detail: `Now ${euro(householdDeal.price)} at ${storeDisplayName(householdDeal.store)} · save ${euro(dealSaving(householdDeal))}`,
      prompt: `Is ${householdDeal.canonical_name} worth stocking up on at its current ${storeDisplayName(householdDeal.store)} offer price?`,
      icon: 'offer',
      signal: 'live_offer',
    });
  }

  if (comparison) {
    const cheapest = comparison.rows[0];
    const name = cleanProductName(cheapest.canonical_name);
    const storeCount = new Set(comparison.rows.map(row => row.store)).size;
    starters.push({
      label: `Where is ${name} best value?`,
      detail: `${storeCount} stores compared · from ${euro(cheapest.price)}`,
      prompt: `Compare current prices for ${cheapest.canonical_name} and explain which option is best value`,
      icon: 'compare',
      signal: 'store_comparison',
    });
  }

  const stores = new Set(deals.map(row => storeDisplayName(row.store))).size;
  if (deals.length > 0) {
    starters.push({
      label: `Plan a shop around ${deals.length} current offers`,
      detail: `Verified promotions across ${stores} retailer${stores === 1 ? '' : 's'}`,
      prompt: 'Plan a sensible complete household shop around the most useful verified supermarket offers available now',
      icon: 'shop',
      signal: 'market_overview',
    });
  }

  const combined = [...starters, ...fallbackStarters()];
  const seen = new Set<string>();
  return combined.filter(starter => {
    const key = starter.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}
