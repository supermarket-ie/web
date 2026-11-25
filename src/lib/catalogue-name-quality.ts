// Lightweight canonical-name quality checks (25 Nov 2026). Pure; used by scripts/catalogue-name-quality.ts (read-only report).
// Canonical names are OUR display names; retailer source names (store_products.store_product_name) are never changed.
// A product's URL is derived from its canonical name, so an applied correction must also be listed in
// CANONICAL_NAME_CORRECTIONS, which keeps the old URL working (permanent redirect to the corrected one).
import { productSlug } from './product-catalogue';

export type NameIssue =
  | { kind: 'brand_prefix_typo'; found: string; expected: string; suggestion: string }
  | { kind: 'possible_duplicate'; otherId: string; otherName: string }
  | { kind: 'whitespace' | 'unit_case' | 'all_caps' | 'brand_missing'; detail: string };

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '');
const words = (s: string) => norm(s).split(/[^a-z0-9&]+/).filter(Boolean);
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Issues for one canonical record. `brand` is the record's brand; `confirmingBrands` are the structured brands its retailer
 * offers state. A brand-prefix typo is reported only when the record's brand is confirmed by at least two offers, the
 * name's first word(s) are 1-2 edits from that brand (never equal), and the brand is at least 5 letters (short brands are
 * too ambiguous to correct automatically).
 */
export function nameQualityIssues(r: { name: string; brand: string | null; confirmingBrands: (string | null)[] }): NameIssue[] {
  const out: NameIssue[] = [];
  const name = r.name;
  if (/\s{2,}|^\s|\s$/.test(name)) out.push({ kind: 'whitespace', detail: 'double, leading or trailing space' });
  if (/\b\d+(\.\d+)?(G|KG|ML|L|CL)\b/.test(name)) out.push({ kind: 'unit_case', detail: 'upper-case unit (e.g. 400G)' });
  if (name.length > 8 && name === name.toUpperCase() && /[A-Z]{4}/.test(name)) out.push({ kind: 'all_caps', detail: 'name is all capitals' });
  const brand = (r.brand ?? '').trim();
  if (!brand) return out;
  const bw = words(brand), nw = words(name);
  if (!bw.length) return out;
  const prefix = nw.slice(0, bw.length).join(' '), want = bw.join(' ');
  if (prefix === want || nw.join(' ').includes(want)) return out;
  const confirmed = r.confirmingBrands.filter(b => b && words(b).join(' ') === want).length;
  const dist = editDistance(prefix, want);
  if (confirmed >= 2 && want.replace(/\s/g, '').length >= 5 && dist >= 1 && dist <= 2) {
    const original = name.split(/\s+/).slice(0, bw.length).join(' ');
    const rest = name.split(/\s+/).slice(bw.length).join(' ');
    out.push({ kind: 'brand_prefix_typo', found: original, expected: brand, suggestion: `${brand} ${rest}`.trim() });
  } else out.push({ kind: 'brand_missing', detail: `name does not state the brand "${brand}"` });
  return out;
}

/** Records whose names normalise to the same identity (case, units, "&"/"and", brand-prefix typo aside). */
export function nameKey(name: string, brand: string | null): string {
  let n = norm(name).replace(/\band\b/g, '&').replace(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/g, '$1$2');
  const b = words(brand ?? '').join(' ');
  if (b) { const nw = n.split(/\s+/); const bw = b.split(' '); if (editDistance(nw.slice(0, bw.length).join(' '), b) <= 2) n = [b, ...nw.slice(bw.length)].join(' '); }
  return n.replace(/[^a-z0-9&]+/g, ' ').trim();
}

/**
 * Applied canonical-name corrections (versioned: this list IS the history). Each keeps the old URL working: the product
 * page redirects `fromSlug` permanently to the corrected product. Add an entry only for a correction actually applied.
 */
export const CANONICAL_NAME_CORRECTIONS: ReadonlyArray<{ productId: string; from: string; to: string; reason: string; appliedAt: string }> = [
  { productId: '469c050e-577a-49c7-a4af-aa2829cb819e', from: 'Batchelore Hot & Spicy Beans 420g', to: 'Batchelors Hot & Spicy Beans 420g',
    reason: 'brand_prefix_typo: brand Batchelors (structured brand on all 3 offers; Tesco title "Batchelors Hot And Spicy Beans 420G")', appliedAt: '2026-11-25' },
  { productId: '1d5fcf70-1c30-415e-be9b-6b90db63622d', from: 'Clonakility Gluten Free Mini Puddings 260g', to: 'Clonakilty Gluten Free Mini Puddings 260g',
    reason: 'brand_prefix_typo: brand Clonakilty confirmed by at least 2 offers (nameQualityIssues)', appliedAt: '2026-11-25' },
  { productId: '5add053a-51b4-4aae-bc37-ff85666de154', from: 'Odlum Crepe Style Pancake Flour 500g', to: 'Odlums Crepe Style Pancake Flour 500g',
    reason: 'brand_prefix_typo: brand Odlums confirmed by at least 2 offers (nameQualityIssues)', appliedAt: '2026-11-25' },
  { productId: 'cbf5da38-d93c-4b99-9678-c42fce5a59f1', from: 'Dr. Oekter White Chocolate Chunks 100g', to: 'Dr. Oetker White Chocolate Chunks 100g',
    reason: 'brand_prefix_typo: brand Dr. Oetker confirmed by at least 2 offers (nameQualityIssues)', appliedAt: '2026-11-25' },
];

/** The corrected product's current name for a retired slug, or null. */
export function correctedNameForSlug(slug: string): string | null {
  const hit = CANONICAL_NAME_CORRECTIONS.find(c => productSlug(c.from) === slug && productSlug(c.to) !== slug);
  return hit ? hit.to : null;
}
