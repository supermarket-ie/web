// Guard for Dunnes/SuperValu canonical re-points (adapts the Tesco repair safeguards).
// PURE and read-only: it decides whether a proposed re-point may be PREPARED. It never
// writes. Production changes still require the supervised postgres bridge, an assert-first
// SQL transaction (scripts/pair-repair-prepare.ts), a dry run, and owner approval.
//
// Reuses branded-product-identity compare()/parsePack() - no new matching rules.
import { compare, parsePack, type BrandRule, type Evidence } from './branded-product-identity';

export type RepairOffer = {
  id: string; productId: string; store: 'dunnes' | 'supervalu' | 'tesco' | 'aldi'; sku: string | null; title: string;
  brand: string | null; url: string | null;
  /** Rows that hang off this offer. A re-point MOVES the offer, so history stays attached. */
  dependents: { priceObservations: number; receipts: number; failures: number; latestPrices: number };
  lastAttemptAt?: string | null;
};
export type RepairProduct = { id: string; canonicalName: string; brand: string | null; ean: string | null };
export type OfferEvidence = { offerId: string; kind: 'captured_product' | 'captured_listing' | 'refresh_attested' | 'stored_mapping'; at: string | null };
export type RepairOp = {
  kind: 'repoint'; offerId: string; fromProductId: string; toProductId: string;
  /** An EMPTY sku-less placeholder on the target that the re-point replaces. */
  retirePlaceholderId?: string;
  /** Reference to an independent identity review (e.g. an approved retailer_offer_pair_reviews id). */
  identityVerifiedBy?: string;
};
export type RepairContext = { asOf: string; offers: RepairOffer[]; products: RepairProduct[]; evidence: OfferEvidence[]; rules: BrandRule[];
  attemptWindowHours?: number; evidenceHorizonDays?: number };

const asEvidence = (o: RepairOffer, e: OfferEvidence | undefined): Evidence => ({ id: `${o.store}:${o.sku ?? o.id}`, store: o.store as Evidence['store'],
  sku: o.sku ?? '', url: o.url ?? '', title: o.title, brand: o.brand, gtin: null,
  source: { kind: e?.kind ?? 'stored_mapping', ref: o.id, at: e?.at ?? null, url: o.url }, mappingIds: [o.id], canonicalIds: [o.productId], conflicts: [], lastLiveVerifiedAt: null });

const hasDependents = (o: RepairOffer) => Object.values(o.dependents).some(n => n > 0);

/** Returns every reason the re-point must NOT be prepared. Empty array = may be prepared. */
export function checkRepair(op: RepairOp, ctx: RepairContext): string[] {
  const refusals: string[] = [];
  const offer = ctx.offers.find(o => o.id === op.offerId);
  const target = ctx.products.find(p => p.id === op.toProductId);
  if (!offer) return ['offer_not_found'];
  if (!target) return ['target_canonical_not_found'];
  if (offer.productId !== op.fromProductId) refusals.push('offer_not_on_expected_canonical');
  if (offer.store !== 'dunnes' && offer.store !== 'supervalu') refusals.push('store_not_in_scope');
  if (!/^\d{5,14}$/.test(offer.sku ?? '')) refusals.push('offer_has_no_verified_sku');

  // Duplicate / shared SKU ownership: the SKU must have exactly one owner (this offer).
  if (offer.sku && ctx.offers.some(o => o.id !== offer.id && o.store === offer.store && o.sku === offer.sku)) refusals.push('duplicate_sku_ownership');

  // One offer per retailer per canonical. A sku-less, empty placeholder may be replaced only if named.
  const slot = ctx.offers.filter(o => o.id !== offer.id && o.productId === op.toProductId && o.store === offer.store);
  for (const o of slot) {
    if (o.id === op.retirePlaceholderId) {
      if (o.sku) refusals.push('placeholder_has_sku');
      if (hasDependents(o)) refusals.push('placeholder_has_dependents');
    } else refusals.push('target_store_slot_occupied');
  }
  if (op.retirePlaceholderId && !slot.some(o => o.id === op.retirePlaceholderId)) refusals.push('placeholder_not_on_target');

  // Identity: the offer must not contradict the canonical or any retailer offer already attached to it.
  const horizonDays = ctx.evidenceHorizonDays ?? 14;
  const ev = (id: string) => ctx.evidence.find(e => e.offerId === id);
  const fresh = (e: OfferEvidence | undefined) => Boolean(e && e.kind !== 'stored_mapping' && e.at && Date.parse(e.at) <= Date.parse(ctx.asOf)
    && Date.parse(e.at) > Date.parse(ctx.asOf) - horizonDays * 86400000);
  const op0 = asEvidence(offer, ev(offer.id));
  const canonicalPack = parsePack(target.canonicalName);
  const offerPack = parsePack(offer.title);
  if (canonicalPack.amount !== null && offerPack.amount !== null && (canonicalPack.amount !== offerPack.amount || canonicalPack.unit !== offerPack.unit))
    refusals.push('pack_mismatch_with_target_canonical');
  if (target.brand && offer.brand && target.brand.toLowerCase() !== offer.brand.toLowerCase()) refusals.push('brand_mismatch_with_target_canonical');
  const peers = ctx.offers.filter(o => o.id !== offer.id && o.productId === op.toProductId && (o.store === 'dunnes' || o.store === 'supervalu') && o.sku && o.id !== op.retirePlaceholderId);
  let exactPeer = false;
  for (const peer of peers) {
    const r = compare(op0, asEvidence(peer, ev(peer.id)), ctx.rules, ctx.asOf);
    if (r.decision === 'exact_match') exactPeer = true;
    for (const c of r.contradictions) refusals.push(`contradiction_with_peer:${c}`);
    // Independent, recent, non-stored evidence is required on both sides before any re-point is prepared.
    if (!fresh(ev(peer.id))) refusals.push(`stale_or_missing_evidence:${peer.store}:${peer.sku}`);
  }
  if (!fresh(ev(offer.id))) refusals.push(`stale_or_missing_evidence:${offer.store}:${offer.sku}`);
  // "No contradiction" is not identity. Need a deterministic exact peer or an explicit reviewed basis.
  if (!exactPeer && !op.identityVerifiedBy) refusals.push('identity_not_established');

  // Recent-attempt window (adapted from the Tesco 24h attempt rule).
  const hours = ctx.attemptWindowHours ?? 24;
  if (offer.lastAttemptAt && Date.parse(ctx.asOf) - Date.parse(offer.lastAttemptAt) < hours * 3600000) refusals.push('attempt_within_window');
  return [...new Set(refusals)];
}

/** A prepared batch must never leave one SKU owned twice or one canonical with two same-store SKUs. */
export function postStateViolations(ops: RepairOp[], ctx: RepairContext): string[] {
  const moved = new Map(ops.map(o => [o.offerId, o.toProductId]));
  const retired = new Set(ops.flatMap(o => o.retirePlaceholderId ? [o.retirePlaceholderId] : []));
  const after = ctx.offers.filter(o => !retired.has(o.id)).map(o => ({ ...o, productId: moved.get(o.id) ?? o.productId }));
  const out: string[] = [];
  const skuOwners = new Map<string, number>(), slots = new Map<string, number>();
  for (const o of after) {
    if (o.sku) skuOwners.set(`${o.store}:${o.sku}`, (skuOwners.get(`${o.store}:${o.sku}`) ?? 0) + 1);
    if (o.sku && (o.store === 'dunnes' || o.store === 'supervalu')) slots.set(`${o.productId}:${o.store}`, (slots.get(`${o.productId}:${o.store}`) ?? 0) + 1);
  }
  for (const [k, n] of skuOwners) if (n > 1) out.push(`duplicate_sku_ownership_after:${k}`);
  for (const [k, n] of slots) if (n > 1 && ops.some(o => k.startsWith(o.toProductId))) out.push(`multiple_same_store_skus_after:${k}`);
  return out;
}
