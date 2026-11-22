// Barcode catalogue repair policy `barcode-repair-v1` (owner decision, 22 Nov 2026). Pure and deterministic.
//   regroup  A record mixes products: the Tesco offer's GTIN resolved, at another retailer, to a SKU OTHER than the
//            offer on the record, and every remaining Dunnes/SuperValu offer deterministically contradicts the Tesco
//            product. The Tesco offer and the offers the barcode resolved on the record move to a new record.
//   attach   SuperValu's own search resolved a SKU for the GTIN, the record has no SuperValu offer, the SKU is
//            unowned, the direct page capture agrees strongly with the Tesco product and nothing on the record
//            contradicts it.
// Anything weaker is held (no repair). The database re-checks every binding (migration 20261123090000).
import { assessBarcodeHit } from './barcode-matching';
import { isOwnLabel } from './comparison-policy';

export const REPAIR_POLICY_VERSION = 'barcode-repair-v1';
export type RecordOffer = { id: string; store: string; sku: string | null; name: string; brand: string | null };
export type RegroupInput = {
  gtin: string;
  tesco: { id: string; title: string; brand: string | null };
  /** The record's current canonical name. */
  canonicalName?: string;
  /** Every offer on the Tesco offer's record (ALL retailers), including the Tesco offer itself. */
  record: RecordOffer[];
  /** SKU each retailer's own search resolved for the GTIN (active associations from this Tesco offer). */
  resolved: Partial<Record<'dunnes' | 'supervalu', string>>;
  /** Offers whose SKU is shared with another offer of the same store. */
  shared: Set<string>;
};
export type Plan = { action: 'regroup' | 'none' | 'held'; members: string[]; reasons: string[]; checks: Record<string, string> };

const contradicts = (tesco: RegroupInput['tesco'], o: RecordOffer) => {
  const a = assessBarcodeHit({ name: tesco.title, brand: tesco.brand }, { sku: o.sku ?? '', name: o.name, brand: o.brand });
  return a.conflicts.length > 0 || (isOwnLabel(o.name) && !isOwnLabel(tesco.title));
};
const agrees = (tesco: RegroupInput['tesco'], name: string, brand: string | null) => {
  const a = assessBarcodeHit({ name: tesco.title, brand: tesco.brand }, { sku: 'x', name, brand });
  return a.conflicts.length === 0 && a.review.length === 0 && !isOwnLabel(name);
};

export function planRegroup(i: RegroupInput): Plan {
  const reasons: string[] = [];
  const others = i.record.filter(o => o.id !== i.tesco.id);
  if (others.some(o => o.store === 'tesco')) return { action: 'held', members: [], reasons: ['second_tesco_offer_on_record'], checks: {} };
  const members = others.filter(o => o.store !== 'tesco' && o.sku && i.resolved[o.store as 'dunnes' | 'supervalu'] === o.sku);
  const remainder = others.filter(o => !members.includes(o));
  if (!remainder.length) return { action: 'none', members: [], reasons: ['record_not_mixed'], checks: {} };
  // Independent evidence of a mix: the retailer's own search resolved ANOTHER SKU than a remaining offer.
  const evidenced = remainder.filter(o => o.store !== 'tesco' && !!o.sku && i.resolved[o.store as 'dunnes' | 'supervalu'] && i.resolved[o.store as 'dunnes' | 'supervalu'] !== o.sku);
  if (!evidenced.length) return { action: 'none', members: [], reasons: ['no_barcode_evidence_of_mix'], checks: {} };
  // Every remaining offer, of ANY retailer (Aldi included), must contradict the Tesco product: none is stranded.
  for (const o of remainder) if (!contradicts(i.tesco, o)) reasons.push(`remainder_not_contradicted:${o.store}`);
  // The Tesco side moves to a new record. If the record's own name describes the Tesco product, the remaining
  // offers would keep a name that is not theirs: hold instead.
  if (i.canonicalName && agrees(i.tesco, i.canonicalName, null)) reasons.push('canonical_describes_tesco_side');
  for (const m of members) if (!agrees(i.tesco, m.name, m.brand)) reasons.push(`member_not_strong:${m.store}`);
  for (const o of [i.tesco.id, ...members.map(m => m.id)]) if (i.shared.has(o)) reasons.push('member_sku_shared');
  if (!i.tesco.title.trim() || i.tesco.title.trim().length < 6) reasons.push('tesco_title_missing');
  if (reasons.length) return { action: 'held', members: [], reasons: [...new Set(reasons)], checks: {} };
  return { action: 'regroup', members: members.map(m => m.id), reasons: [],
    checks: { mix: evidenced.map(o => `${o.store}:resolved_${i.resolved[o.store as 'dunnes' | 'supervalu']}_not_${o.sku}`).join(','),
      remainder: 'every remaining offer contradicts the Tesco product', members: 'barcode-resolved and strong' } };
}

export type AttachInput = {
  gtin: string; tesco: RegroupInput['tesco']; record: RecordOffer[]; sku: string; skuOwned: boolean;
  /** The direct SuperValu page capture (title and brand as stated on SuperValu's own page), or null. */
  capture: { title: string; brand: string | null; sku: string } | null;
};
export function planSupervaluAttach(i: AttachInput): { attach: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (i.record.some(o => o.store === 'supervalu')) reasons.push('record_has_supervalu_offer');
  if (i.skuOwned) reasons.push('sku_owned');
  if (!i.capture) reasons.push('no_direct_capture');
  else {
    if (i.capture.sku !== i.sku) reasons.push('capture_other_sku');
    const a = assessBarcodeHit({ name: i.tesco.title, brand: i.tesco.brand }, { sku: i.sku, name: i.capture.title, brand: i.capture.brand });
    if (a.conflicts.length) reasons.push(...a.conflicts.map(c => `identity:${c}`));
    if (a.review.length) reasons.push(...a.review.map(c => `identity_review:${c}`));
    if (isOwnLabel(i.capture.title)) reasons.push('own_label');
  }
  // Nothing else on the record may contradict the product being attached.
  for (const o of i.record) if (o.store === 'dunnes' && contradicts(i.tesco, o)) reasons.push('record_dunnes_contradicts');
  return { attach: reasons.length === 0, reasons };
}

/** SuperValu product URL as the storefront builds it: slug of the product name + "-id-" + SKU. */
export function supervaluProductUrl(name: string, sku: string): string {
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/${slug}-id-${sku}`;
}
