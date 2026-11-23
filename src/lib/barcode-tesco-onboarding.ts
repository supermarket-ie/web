// Barcode-led catalogue expansion policy `barcode-onboard-v1` (owner decision, 23 Nov 2026). Pure.
// A Tesco catalogue SKU not in our catalogue is onboarded only when at least one other retailer's own search
// resolved its GTIN to exactly one SKU with a STRONG identity tier, and:
//   * every resolved SKU that is already in the catalogue belongs to ONE record (the target) and is unshared;
//   * the target has no Tesco offer, its name does not contradict the Tesco product, no other offer on it
//     contradicts the Tesco product, and no offer at a resolving retailer is a DIFFERENT SKU (a mixed record);
//   * otherwise (no resolved SKU in the catalogue) a new record named from Tesco's own title is created.
// Anything else is held. The database re-checks ownership, strength, recency and binding (migration 20261124090000).
import { assessBarcodeHit } from './barcode-matching';
import { isOwnLabel } from './comparison-policy';

export const ONBOARD_POLICY_VERSION = 'barcode-onboard-v1';
export type StrongHit = { store: 'dunnes' | 'supervalu'; sku: string; title: string };
export type Owner = { productId: string; offerCount: number };
export type TargetRecord = { canonicalName: string; offers: Array<{ store: string; sku: string | null; name: string; brand: string | null }> };
export type OnboardPlan = { action: 'attach' | 'create' | 'held'; target: string | null; reasons: string[] };

export function planOnboarding(i: {
  tesco: { sku: string; name: string; brand: string };
  hits: StrongHit[];
  /** Owners of each resolved SKU (per store), from store_products. */
  owners: Partial<Record<'dunnes' | 'supervalu', Owner[]>>;
  /** The target record's offers and name, when the resolved SKUs have an owner. */
  record?: TargetRecord | null;
}): OnboardPlan {
  const reasons: string[] = [];
  if (!i.hits.length) return { action: 'held', target: null, reasons: ['no_strong_resolution'] };
  if (isOwnLabel(i.tesco.name) || isOwnLabel(i.tesco.brand)) return { action: 'held', target: null, reasons: ['own_label'] };
  const owned: string[] = [];
  for (const h of i.hits) {
    const o = i.owners[h.store] ?? [];
    if (o.length > 1 || o.some(x => x.offerCount > 1)) reasons.push(`${h.store}:sku_shared`);
    else if (o.length === 1) owned.push(o[0].productId);
  }
  if (reasons.length) return { action: 'held', target: null, reasons };
  const targets = [...new Set(owned)];
  if (targets.length > 1) return { action: 'held', target: null, reasons: ['resolved_skus_on_different_records'] };
  if (!targets.length) return { action: 'create', target: null, reasons: [] };
  const rec = i.record;
  if (!rec) return { action: 'held', target: targets[0], reasons: ['target_record_unreadable'] };
  const tesco = { name: i.tesco.name, brand: i.tesco.brand };
  if (rec.offers.some(o => o.store === 'tesco')) reasons.push('target_has_tesco_offer');
  if (assessBarcodeHit(tesco, { sku: 'canonical', name: rec.canonicalName, brand: null }).conflicts.some(c => c !== 'brand')) reasons.push('target_name_contradicts');
  for (const o of rec.offers) {
    if (o.store === 'tesco') continue;
    const hit = i.hits.find(h => h.store === o.store);
    if (hit && o.sku && o.sku !== hit.sku) { reasons.push(`target_mixed:${o.store}`); continue; }   // another SKU at a resolving retailer
    if (hit && o.sku === hit.sku) continue;
    const a = assessBarcodeHit(tesco, { sku: o.sku ?? '', name: o.name, brand: o.brand });
    if (a.conflicts.length || (isOwnLabel(o.name) && !isOwnLabel(i.tesco.name))) reasons.push(`target_offer_contradicts:${o.store}`);
  }
  return reasons.length ? { action: 'held', target: targets[0], reasons: [...new Set(reasons)] } : { action: 'attach', target: targets[0], reasons: [] };
}

// Catalogue category of a NEW record from Tesco's own department / aisle (first matching rule wins).
// Unmapped departments return null and the product is held: a category is required and never guessed.
const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/pet|dog|cat food|cat treat/i, 'Pet Care'],
  [/ice cream|ice lollies|lollies|frozen/i, 'Frozen'],
  [/crisps|nuts|popcorn|chocolate|sweets|biscuits|cereal bars|crackers|rice cakes|breadsticks|snacks/i, 'Snacks'],
  [/baby|toddler/i, 'Baby'],
  [/stock cubes|stock pots|^stock/i, 'Stock'],
  [/oils? & cooking fats|cooking oil/i, 'Oils'],
  [/seasoning|herbs|spices|salt & pepper/i, 'Seasoning'],
  [/home baking|flour|cake decorating|baking/i, 'Baking'],
  [/jams|spreads|peanut|nut butter|honey/i, 'Spreads'],
  [/breakfast cereals|porridge|muesli|granola/i, 'Breakfast'],
  [/pasta|rice|noodles|cous cous/i, 'Pasta & Rice'],
  [/tins, cans|tinned|baked beans|pulses/i, 'Tinned'],
  [/condiments|table sauces|mayonnaise|pickles|cooking sauces|world foods|packet sauces|gravy|easy meals/i, 'Condiments'],
  [/tea|coffee|soft drinks|juice|water|squash|drinks/i, 'Beverages'],
  [/dairy alternative|plant based milk/i, 'Dairy Alternatives'],
  [/milk|cheese|yogurt|yoghurt|butter|cream|dairy/i, 'Dairy'],
  [/bakery|bread|rolls|wraps/i, 'Bakery'],
  [/household|cleaning|laundry|toilet|kitchen roll/i, 'Household'],
  [/toiletries|health & beauty|shampoo|toothpaste|shower/i, 'Personal Care'],
  // Added 24 Nov 2026 for departments that were held as unmapped. Appended LAST, so every text that matched before
  // keeps its category. Desserts, mixed "Gluten Free" aisles and Home & Living (non-grocery) stay unmapped (held).
  [/fresh meat & poultry|cooked meats/i, 'Meat'],
  [/fresh vegetables/i, 'Vegetables'],
  [/fresh fruit/i, 'Fruit'],
  [/chilled fish/i, 'Fish'],
  [/ready meals|chilled soup|sandwiches|salad pots|houmous|coleslaw|pies, pasties|quiches/i, 'Chilled'],
  [/selection boxes|advent calendars|protein bars/i, 'Snacks'],
  [/^cereal \|/i, 'Breakfast'],
  [/^sauces & stuffing \|/i, 'Condiments'],
];
export function onboardingCategory(department: string | null | undefined, aisle: string | null | undefined): string | null {
  const text = `${aisle ?? ''} | ${department ?? ''}`;
  for (const [re, cat] of CATEGORY_RULES) if (re.test(text)) return cat;
  return null;
}
