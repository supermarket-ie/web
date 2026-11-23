// Legacy Tesco mismatch detach policy `tesco-detach-v1` (owner decision, 23 Nov 2026). Pure.
// Detach a Tesco offer onto its own record only when its retained-page review (src/lib/tesco-retained-review.ts) is a
// GENUINE mismatch with at least one MATERIAL contradiction reason, the offer is manufacturer-branded and its retained
// page states a GTIN. Description gaps, missing evidence, AI uncertainty and own-label are never detached here.
import { onboardingCategory } from './barcode-tesco-onboarding';

export const DETACH_POLICY_VERSION = 'tesco-detach-v1';
const MATERIAL = /^(measureConflict|packCountConflict|brandConflict|variantConflict|formulationConflict|productTypeConflict|raw_ingredient_prepared_meal_conflict)$/;

export function planDetach(i: { klass: string; reasons: string[]; raw: { name?: string | null; brand_name?: string | null; gtin?: string | null;
  department?: string | null; aisle?: string | null } | null }): { detach: boolean; category: string | null; reasons: string[] } {
  const out: string[] = [];
  if (i.klass !== 'genuine_mismatch') out.push(`not_a_mismatch:${i.klass}`);
  if (!i.reasons.some(r => MATERIAL.test(r))) out.push('no_material_contradiction');
  const raw = i.raw;
  if (!raw) out.push('no_retained_identity');
  const name = raw?.name?.trim() ?? '', brand = raw?.brand_name?.trim() ?? '';
  if (name.length < 6 || brand.length < 2) out.push('identity_incomplete');
  if (/^(tesco|dunnes|supervalu)\b/i.test(brand) || /^(tesco|dunnes|supervalu)\b/i.test(name)) out.push('own_label');
  if (!/^\d{8,14}$/.test((raw?.gtin ?? '').replace(/^0+/, ''))) out.push('no_gtin');
  const category = onboardingCategory(raw?.department, raw?.aisle);
  if (!category) out.push('no_category');
  return { detach: out.length === 0, category, reasons: out };
}
