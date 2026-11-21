// Machine pair-approval policy `barcode-exact-v1` (owner decision, 22 Nov 2026). Pure and deterministic.
//
// Approves an EXACT relationship between two retailer offers only when every mandatory requirement holds:
//   barcode    the non-Tesco retailer's own storefront search returned exactly this SKU for the GTIN, the
//              association is active (strong tier, recently verified) and originates from the Tesco offer of the
//              same catalogue record; a Tesco side's own page states that same GTIN; a stated retailer GTIN agrees
//   binding    both offers on the same catalogue record, each SKU used by exactly one offer of its store, each
//              source captured for that offer's own SKU
//   sources    a direct capture on each side (Tesco product page; SuperValu product page; Dunnes product page or
//              SKU-bound product API), no older than MACHINE_FRESHNESS_DAYS
//   identity   same manufacturer brand, same stated retail pack, no stated variant / formulation / number /
//              container contradiction, neither side own-label (assessBarcodeHit strong in BOTH directions, and
//              the customer-facing deterministicDifference veto is null)
//   model      optional; a model can only ever HOLD (never approve, never override a contradiction)
// Outcome: `rejected` on any material contradiction, `held` on missing or insufficient evidence or a review-tier
// difference, otherwise `approved`. The database re-checks the barcode, binding, freshness and the stamped
// brand / pack / GTIN in record_machine_pair_approval (migration 20261122090000).
import { assessBarcodeHit } from './barcode-matching';
import { deterministicDifference, isOwnLabel } from './comparison-policy';

export const MACHINE_POLICY_VERSION = 'barcode-exact-v1';
export const MACHINE_FRESHNESS_DAYS = 12;

export type MachineSide = {
  store: 'tesco' | 'supervalu' | 'dunnes';
  offerId: string;
  productId: string | null;
  sku: string;
  skuShared: boolean;
  /** The direct capture used as evidence, or null when none qualifies. */
  source: {
    id: string;
    kind: 'tesco_page' | 'captured_product' | 'captured_product_api' | 'captured_listing';
    capturedAt: string;
    /** SKU of the product node the capture describes. */
    sku: string;
    title: string;
    brand: string | null;
    gtin: string | null;
  } | null;
  /** Barcode association for a non-Tesco side (current_barcode_associations), null when none. */
  association?: { gtin: string; status: string; resolvedSku: string; originOfferId: string; originProductId: string | null } | null;
};
export type ModelVerdict = { verdict: 'exact' | 'different' | 'uncertain'; model: string; rationale?: string } | null;
export type MachineDecision = { decision: 'approved' | 'rejected' | 'held'; reasons: string[]; checks: Record<string, string> };

const DAY = 86400000;
export const normGtin = (g: string | null | undefined) => (g ?? '').replace(/\D/g, '').replace(/^0+/, '') || null;

/** Evaluate one candidate pair against `barcode-exact-v1`. Never throws. */
export function evaluateMachinePair(a: MachineSide, b: MachineSide, gtin: string, now = Date.now(), model: ModelVerdict = null): MachineDecision {
  const reject: string[] = [], hold: string[] = [], checks: Record<string, string> = {};
  const g = normGtin(gtin);
  const sides = [a, b];
  if (!g) hold.push('gtin_missing');
  if (a.store === b.store) reject.push('same_retailer');
  // Binding.
  if (!a.productId || a.productId !== b.productId) hold.push('not_same_catalogue_record');
  for (const s of sides) if (s.skuShared) hold.push(`${s.store}:sku_shared`);
  checks.binding = hold.length ? 'fail' : 'same_record_unshared_skus';
  // Barcode association (every non-Tesco side) and the Tesco page's own GTIN.
  const tesco = sides.find(s => s.store === 'tesco');
  for (const s of sides.filter(x => x.store !== 'tesco')) {
    const as = s.association;
    if (!as) { hold.push(`${s.store}:no_barcode_association`); continue; }
    if (normGtin(as.gtin) !== g) reject.push(`${s.store}:association_gtin_differs`);
    if (as.status !== 'active') hold.push(`${s.store}:association_${as.status}`);
    if (as.resolvedSku !== s.sku) reject.push(`${s.store}:barcode_resolves_other_sku`);
    if (tesco && as.originOfferId !== tesco.offerId) hold.push(`${s.store}:association_from_other_tesco_offer`);
    if (as.originProductId && a.productId && as.originProductId !== a.productId) hold.push(`${s.store}:association_from_other_record`);
  }
  checks.barcode = 'search_resolved_exact_sku';
  // Sources: present, direct, SKU-bound, fresh.
  for (const s of sides) {
    const src = s.source;
    if (!src) { hold.push(`${s.store}:no_direct_capture`); continue; }
    const allowed = s.store === 'tesco' ? ['tesco_page'] : s.store === 'dunnes' ? ['captured_product', 'captured_product_api'] : ['captured_product'];
    if (!allowed.includes(src.kind)) hold.push(`${s.store}:source_not_direct:${src.kind}`);
    if (src.sku !== s.sku) reject.push(`${s.store}:capture_describes_other_sku`);
    const at = Date.parse(src.capturedAt);
    if (!Number.isFinite(at) || at > now + 5 * 60000) hold.push(`${s.store}:capture_time_invalid`);
    else if (now - at > MACHINE_FRESHNESS_DAYS * DAY) hold.push(`${s.store}:capture_stale`);
    if (!src.brand?.trim()) hold.push(`${s.store}:brand_not_stated`);
    const sg = normGtin(src.gtin);
    if (s.store === 'tesco' && !sg) hold.push('tesco:page_states_no_gtin');
    if (sg && g && sg !== g) reject.push(`${s.store}:stated_gtin_differs`);
  }
  checks.sources = 'direct_fresh_sku_bound';
  // Identity, in BOTH directions, on the captured (retailer-stated) titles and brands.
  // (An unstated brand is already a hold; without it the assessment would misread the brand as contradicted.)
  if (a.source?.brand?.trim() && b.source?.brand?.trim()) {
    for (const [x, y] of [[a.source, b.source], [b.source, a.source]] as const) {
      const r = assessBarcodeHit({ name: x.title, brand: x.brand }, { sku: y.sku, name: y.title, brand: y.brand });
      for (const c of r.conflicts) reject.push(`identity:${c}`);
      for (const c of r.review) hold.push(`identity_review:${c}`);
    }
    const veto = deterministicDifference(a.source.title, b.source.title);
    // The customer-facing veto disagreeing with a strong assessment is a rule disagreement: never approve (the
    // app would veto it), but not proof of a different product either.
    if (veto) (veto === 'own_label' ? reject : hold).push(`customer_veto:${veto}`);
    for (const s of sides) if (s.source && (isOwnLabel(s.source.title) || isOwnLabel(s.source.brand ?? ''))) reject.push(`${s.store}:own_label`);
    checks.identity = 'brand_pack_variant_numbers_containers';
  }
  // Model: may hold, never approve or override.
  if (model && model.verdict !== 'exact') hold.push(`model_${model.verdict}`);
  checks.model = model ? `${model.model}:${model.verdict}` : 'not_used';
  const uniq = (xs: string[]) => [...new Set(xs)];
  if (reject.length) return { decision: 'rejected', reasons: uniq(reject), checks };
  if (hold.length) return { decision: 'held', reasons: uniq(hold), checks };
  return { decision: 'approved', reasons: [], checks };
}
