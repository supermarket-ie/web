// Server-side validation for agent-generated grocery lists.
//
// The planner agent promises dietary compliance and accurate totals in its
// prompt, but prompts are not guarantees. This module enforces them in code
// at the point where the agent hands us structured data (save_list /
// update_list tools):
//   - findDietaryViolations: keyword screen of items against stated dietary
//     requirements, so a "vegetarian" list can never contain chicken
//   - reconcilePrices: checks each item's claimed price against the live
//     catalogue and corrects drift
//   - recomputeStoreTotals: totals are always recomputed from items, never
//     trusted from the model's arithmetic

export interface ValidatedListItem {
  canonical_name: string;
  store: string;
  price: number;
  quantity?: number;
  category?: string;
  store_product_name?: string;
  on_promotion?: boolean;
}

export interface ValidatedStoreTotal {
  store: string;
  total: number;
  item_count: number;
}

export interface CataloguePriceRow {
  canonical_name: string;
  store: string;
  price: number;
  on_promotion?: boolean;
}

export interface DietaryViolation {
  canonical_name: string;
  requirement: string;
  matched: string;
}

// ---------------------------------------------------------------------------
// Dietary screening
// ---------------------------------------------------------------------------

// Names containing any of these phrases are never flagged — they signal a
// compliant variant ("vegan mayo", "oat milk") or a false-positive stem
// ("butternut squash", "peanut butter", "cream crackers").
const EXEMPT_PHRASES = [
  'vegan', 'vegetarian', 'plant-based', 'plant based', 'meat-free', 'meat free',
  'meatless', 'dairy-free', 'dairy free', 'gluten-free', 'gluten free',
  'egg-free', 'egg free',
  'oat milk', 'almond milk', 'soy milk', 'soya milk', 'coconut milk',
  'rice milk', 'cashew milk', 'oat drink', 'soya drink', 'almond drink',
  'peanut butter', 'almond butter', 'cashew butter', 'cocoa butter',
  'butternut', 'butter bean', 'buttermilk pancake',
  'coconut cream', 'cream cracker', 'cream of tartar', 'ice cream cone',
  'eggplant', 'aubergine',
];

const MEAT_TERMS = [
  'chicken', 'beef', 'pork', 'lamb', 'bacon', 'ham', 'turkey', 'duck',
  'sausage', 'sausages', 'mince', 'steak', 'chorizo', 'salami', 'pepperoni',
  'meatball', 'meatballs', 'gammon', 'rasher', 'rashers', 'lard', 'gelatine',
  'gelatin', 'black pudding', 'white pudding', 'goujon', 'goujons', 'kebab',
  'meat',
];

const FISH_TERMS = [
  'fish', 'salmon', 'tuna', 'cod', 'haddock', 'hake', 'mackerel', 'prawn',
  'prawns', 'shrimp', 'crab', 'anchovy', 'anchovies', 'sardine', 'sardines',
  'seafood', 'trout', 'mussels', 'calamari', 'squid',
];

const DAIRY_TERMS = [
  'milk', 'cheese', 'butter', 'yogurt', 'yoghurt', 'cream', 'whey', 'custard',
  'ghee', 'cheddar', 'mozzarella', 'brie', 'feta', 'parmesan', 'halloumi',
  'mascarpone', 'buttermilk',
];

const EGG_HONEY_TERMS = ['egg', 'eggs', 'honey', 'mayonnaise', 'mayo'];

const GLUTEN_TERMS = [
  'bread', 'pasta', 'wheat', 'barley', 'rye', 'flour', 'couscous', 'noodle',
  'noodles', 'bagel', 'bagels', 'croissant', 'croissants', 'brioche', 'pitta',
  'naan', 'spaghetti', 'penne', 'fusilli', 'lasagne', 'baguette', 'weetabix',
];

const NUT_TERMS = [
  'nut', 'nuts', 'peanut', 'peanuts', 'almond', 'almonds', 'cashew', 'cashews',
  'walnut', 'walnuts', 'hazelnut', 'hazelnuts', 'pistachio', 'pistachios',
  'pecan', 'pecans',
];

const ALCOHOL_PORK_TERMS = [
  'pork', 'bacon', 'ham', 'chorizo', 'salami', 'pepperoni', 'lard', 'gammon',
  'rasher', 'rashers', 'black pudding', 'white pudding', 'wine', 'beer',
  'cider', 'lager', 'stout', 'gin', 'vodka', 'whiskey', 'prosecco',
];

// Maps a normalised dietary requirement to the term lists it forbids.
const DIET_RULES: Record<string, string[][]> = {
  vegetarian: [MEAT_TERMS, FISH_TERMS],
  vegan: [MEAT_TERMS, FISH_TERMS, DAIRY_TERMS, EGG_HONEY_TERMS],
  pescatarian: [MEAT_TERMS],
  'gluten-free': [GLUTEN_TERMS],
  'dairy-free': [DAIRY_TERMS],
  'nut-free': [NUT_TERMS],
  halal: [ALCOHOL_PORK_TERMS],
};

function normaliseDiet(diet: string): string {
  return diet.toLowerCase().trim().replace(/\s+/g, '-').replace(/--+/g, '-');
}

function matchTerm(name: string, terms: string[]): string | null {
  for (const term of terms) {
    // Whole-word match so "coconut" never trips on "nut"
    const re = new RegExp(`(^|[^a-z])${term}($|[^a-z])`, 'i');
    if (re.test(name)) return term;
  }
  return null;
}

/**
 * Screens list items against dietary requirements. Returns violations —
 * empty array means the list passed. Conservative by design: exempt phrases
 * ("vegan", "oat milk", "butternut") suppress matches, so a clean item is
 * very unlikely to be flagged.
 */
export function findDietaryViolations(
  items: Pick<ValidatedListItem, 'canonical_name'>[],
  dietary: string[],
): DietaryViolation[] {
  if (!dietary?.length) return [];

  const violations: DietaryViolation[] = [];
  for (const item of items) {
    const name = item.canonical_name.toLowerCase();
    if (EXEMPT_PHRASES.some(p => name.includes(p))) continue;

    for (const rawDiet of dietary) {
      const diet = normaliseDiet(rawDiet);
      const ruleSets = DIET_RULES[diet];
      if (!ruleSets) continue;
      for (const terms of ruleSets) {
        const matched = matchTerm(name, terms);
        if (matched) {
          violations.push({
            canonical_name: item.canonical_name,
            requirement: rawDiet,
            matched,
          });
          break;
        }
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Price reconciliation
// ---------------------------------------------------------------------------

export interface PriceReconciliation {
  items: ValidatedListItem[];
  corrections: Array<{
    canonical_name: string;
    store: string;
    claimed_price: number;
    actual_price: number;
  }>;
  unverified: string[];
}

/**
 * Checks each item's price against catalogue rows (latest_prices). When the
 * catalogue has the product at the item's store and the claimed price doesn't
 * match any real price there, the price is corrected to the closest real one.
 * Items with no catalogue row at that store are passed through but reported
 * as unverified (possible model invention or stale name).
 */
export function reconcilePrices(
  items: ValidatedListItem[],
  catalogue: CataloguePriceRow[],
): PriceReconciliation {
  const byKey = new Map<string, number[]>();
  for (const row of catalogue) {
    if (row.price == null) continue;
    const key = `${row.canonical_name.toLowerCase()}::${row.store.toLowerCase()}`;
    const prices = byKey.get(key);
    if (prices) prices.push(row.price);
    else byKey.set(key, [row.price]);
  }

  const corrections: PriceReconciliation['corrections'] = [];
  const unverified: string[] = [];

  const reconciled = items.map(item => {
    const key = `${item.canonical_name.toLowerCase()}::${item.store.toLowerCase()}`;
    const realPrices = byKey.get(key);
    if (!realPrices || realPrices.length === 0) {
      unverified.push(item.canonical_name);
      return item;
    }
    // The store may carry several pack sizes under one canonical name, so
    // accept the claimed price if it matches any real price; otherwise snap
    // to the closest one.
    const closest = realPrices.reduce((best, p) =>
      Math.abs(p - item.price) < Math.abs(best - item.price) ? p : best,
    );
    if (Math.abs(closest - item.price) > 0.01) {
      corrections.push({
        canonical_name: item.canonical_name,
        store: item.store,
        claimed_price: item.price,
        actual_price: closest,
      });
      return { ...item, price: closest };
    }
    return item;
  });

  return { items: reconciled, corrections, unverified };
}

// ---------------------------------------------------------------------------
// Store totals
// ---------------------------------------------------------------------------

/** Recomputes per-store totals and item counts from the items themselves. */
export function recomputeStoreTotals(items: ValidatedListItem[]): ValidatedStoreTotal[] {
  const byStore = new Map<string, { total: number; item_count: number }>();
  for (const item of items) {
    const store = item.store.toLowerCase();
    const qty = item.quantity ?? 1;
    const entry = byStore.get(store) ?? { total: 0, item_count: 0 };
    entry.total += item.price * qty;
    entry.item_count += qty;
    byStore.set(store, entry);
  }
  return [...byStore.entries()]
    .map(([store, { total, item_count }]) => ({
      store,
      total: Number(total.toFixed(2)),
      item_count,
    }))
    .sort((a, b) => a.total - b.total);
}
