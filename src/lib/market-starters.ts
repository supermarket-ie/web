import type { ProductPrice } from '@/lib/price-data';
import { storeDisplayName } from '@/lib/store-utils';
import { dunnesPackSignature } from '@/lib/dunnes-discovery';
import { fallbackStarters, type MarketStarter } from '@/lib/market-starter-options';

const MEAL_CATEGORIES = new Set([
  'bakery', 'chilled', 'dairy', 'fish', 'frozen', 'meat', 'pasta & rice',
  'vegetables', 'fruit', 'tinned',
]);
const HOUSEHOLD_CATEGORIES = new Set([
  'baby', 'household', 'household essentials', 'laundry', 'cleaning',
  'personal care', 'pet care', 'toiletries',
]);
const euro = (value: number) => `€${value.toFixed(2)}`;
const productName = (row: ProductPrice) => row.store_product_name.replace(/\s+/g, ' ').trim();
const checkedDate = (date: string) => new Intl.DateTimeFormat('en-IE', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Dublin',
}).format(new Date(date));

function usablePrice(row: ProductPrice) {
  return Number.isFinite(row.price) && row.price > 0
    && Boolean(row.store_product_name?.trim())
    && Number.isFinite(Date.parse(row.observed_at));
}

function isMealIngredient(row: ProductPrice) {
  if (!MEAL_CATEGORIES.has(row.category.toLowerCase())) return false;
  const name = productName(row).toLowerCase();
  // Category mappings can be broad or wrong (e.g. a lemon drink under Fruit).
  // Require an ingredient signal in the actual retailer name as well.
  if (/\b(?:desserts?|cakes?|bakewells?|chocolate|sweets?|crisps?|ice cream|juice|lemonade|cola|soft drink|baby formula)\b/.test(name)) return false;
  if (/\d\s*(?:ml|cl|l)\b/.test(name) && !/\b(?:milk|cream|yoghur?t|kefir|stock|broth|soup|passata|oil|vinegar|sauce)\b/.test(name)) return false;
  return /\b(?:chicken|beef|pork|lamb|turkey|sausages?|bacon|ham|fish|haddock|cod|salmon|tuna|prawns?|mussels?|eggs?|cheese|cheddar|butter|milk|cream|yoghur?t|kefir|rice|pasta|fusilli|penne|spaghetti|noodles?|lentils?|beans?|chickpeas?|flour|bread|wraps?|tortillas?|potatoes?|chips|fries|wedges|onions?|peppers?|tomato(?:es)?|carrots?|broccoli|spinach|peas|petits pois|mushrooms?|courgettes?|cabbage|lettuce|avocados?|apples?|bananas?|berries|strawberries|raspberries|lemons?|oranges?|vegetables?|soup|passata|sauce)\b/.test(name);
}

// A shared canonical mapping is not enough evidence for a homepage comparison.
// Preserve every brand/variant word and require explicit matching pack evidence.
// Deliberately prefer a capability prompt when the retailer names are uncertain.
function comparisonKey(row: ProductPrice): string | null {
  if (!usablePrice(row) || row.relationship_type !== 'exact') return null;
  const name = productName(row).toLowerCase().replace(/×/g, 'x');
  if (/\b(?:loose|per\s*(?:kg|kilo)|variable\s*weight)\b|\/\s*kg\b/.test(name)) return null;
  const pack = dunnesPackSignature(name);
  if (!(pack.amount && pack.amount > 0) && !(pack.count && pack.count > 0)) return null;
  const identity = name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/g, (_, amount, unit) => {
      const factor = unit === 'kg' || unit === 'l' ? 1000 : unit === 'cl' ? 10 : 1;
      return `${Number(amount) * factor}${unit === 'kg' || unit === 'g' ? 'g' : 'ml'}`;
    })
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return `${row.canonical_product_id}:${identity}:${JSON.stringify(pack)}`;
}

function comparisonCandidates(prices: ProductPrice[]) {
  const grouped = new Map<string, ProductPrice[]>();
  for (const row of prices) {
    const key = comparisonKey(row);
    if (!key) continue;
    const rows = grouped.get(key) ?? [];
    rows.push(row);
    grouped.set(key, rows);
  }
  return [...grouped.values()]
    .filter(rows => new Set(rows.map(row => row.store)).size >= 2)
    .map(rows => {
      const ordered = [...rows].sort((a, b) => a.price - b.price || a.store.localeCompare(b.store));
      return { rows: ordered, spread: ordered.at(-1)!.price - ordered[0].price };
    })
    .filter(candidate => candidate.spread >= 0.2)
    .sort((a, b) => b.spread - a.spread || productName(a.rows[0]).localeCompare(productName(b.rows[0])));
}

function currentDeals(prices: ProductPrice[]) {
  const seen = new Set<string>();
  const retailerProducts = new Set<string>();
  const ranked = prices
    .filter(row => usablePrice(row) && row.on_promotion && row.was_price != null && row.was_price > row.price)
    .sort((a, b) => (1 - b.price / b.was_price!) - (1 - a.price / a.was_price!)
      || (b.was_price! - b.price) - (a.was_price! - a.price)
      || productName(a).localeCompare(productName(b)));
  return ranked.filter(row => {
    const retailerProduct = `${row.store}:${productName(row).toLowerCase()}`;
    if (seen.has(row.canonical_product_id) || retailerProducts.has(retailerProduct)) return false;
    seen.add(row.canonical_product_id);
    retailerProducts.add(retailerProduct);
    return true;
  });
}

// Interleave categories so one heavily discounted category cannot fill the pool.
function diverseDeals(rows: ProductPrice[]) {
  const categories = new Map<string, ProductPrice[]>();
  for (const row of rows) {
    const key = row.category.toLowerCase();
    const bucket = categories.get(key) ?? [];
    bucket.push(row);
    categories.set(key, bucket);
  }
  const result: ProductPrice[] = [];
  for (let index = 0; result.length < rows.length; index++) {
    for (const bucket of categories.values()) if (bucket[index]) result.push(bucket[index]);
  }
  return result;
}

function rotatingPick<T>(items: T[], window: number, offset = 0): T | undefined {
  const pool = items.slice(0, 12);
  return pool.length ? pool[((Math.max(0, Math.floor(window)) || 0) + offset) % pool.length] : undefined;
}

function offerDetail(row: ProductPrice) {
  return `${euro(row.price)} at ${storeDisplayName(row.store)} · checked ${checkedDate(row.observed_at)}`;
}

export function buildMarketStarters(prices: ProductPrice[], rotationWindow = 0): MarketStarter[] {
  const starters = fallbackStarters();
  const deals = currentDeals(prices);
  const meal = rotatingPick(diverseDeals(deals.filter(isMealIngredient)), rotationWindow);
  const household = rotatingPick(diverseDeals(deals.filter(row => HOUSEHOLD_CATEGORIES.has(row.category.toLowerCase()))), rotationWindow, 3);
  const comparison = rotatingPick(comparisonCandidates(prices), rotationWindow, 7);

  if (meal) starters[1] = {
    id: `meal:${meal.canonical_product_id}:${meal.store}`,
    label: `What could I make with ${productName(meal)}?`,
    detail: offerDetail(meal),
    prompt: `Suggest a few practical meal or snack ideas using ${productName(meal)}. Its price was checked at ${euro(meal.price)} at ${storeDisplayName(meal.store)} on ${checkedDate(meal.observed_at)}. Help me reuse the ingredients, then ask which ideas I'd like to try and offer to help with the ingredients I need. Recheck any prices before costing the ingredients.`,
    icon: 'meal',
  };
  if (household) starters[2] = {
    id: `offer:${household.canonical_product_id}:${household.store}`,
    label: `Is ${productName(household)} good value?`,
    detail: offerDetail(household),
    prompt: `Help me decide whether ${productName(household)} is a useful purchase for my household. Its price was checked at ${euro(household.price)} at ${storeDisplayName(household.store)} on ${checkedDate(household.observed_at)}. Check pack size, unit price and suitable alternatives; don't recommend stocking up just because it is discounted.`,
    icon: 'offer',
  };
  if (comparison) {
    const cheapest = comparison.rows[0];
    const oldestCheck = comparison.rows.reduce((oldest, row) => Date.parse(row.observed_at) < Date.parse(oldest) ? row.observed_at : oldest, cheapest.observed_at);
    starters[3] = {
      id: `compare:${cheapest.canonical_product_id}`,
      label: `Compare ${productName(cheapest)} prices`,
      detail: `From ${euro(cheapest.price)} · checked ${checkedDate(oldestCheck)}`,
      prompt: `Compare checked prices for ${productName(cheapest)}. Only compare the same brand, variant and pack size, show the check dates, and explain whether the difference is useful for my shop.`,
      icon: 'compare',
    };
  }
  return starters;
}
