import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateTescoCollectedIdentity, type TescoCollectedProduct } from './tesco-direct-collection-core';

// Discovery never writes mappings/prices or fetches a retailer. A score retrieves
// candidates; it cannot override a failed identity check or an operational hold.
export const DISCOVERY_VERSION = 'tesco-discovery-v2';
const text = z.string();
const nullable = text.nullable();
const product = z.object({ sku: text, url: text, name: text, brand: nullable,
  gtin: nullable, price: z.number().nullable(), currency: z.literal('EUR'), available: z.boolean(),
  quantity: z.object({ grams: z.number().optional(), millilitres: z.number().optional(), pieces: z.number().optional() }).nullable() });
const mapping = z.object({ id: nullable, product_id: text, canonical_name: text,
  canonical_brand: nullable, store_product_name: nullable, store_brand: nullable,
  store_sku: nullable, store_url: nullable, url_status: nullable, gtin: nullable,
  is_own_brand: z.boolean().nullable(), observed_at: nullable, proven: z.boolean() });
const peer = z.object({ id: text, product_id: text, store: z.enum(['supervalu', 'dunnes']),
  store_product_name: text, brand: nullable, gtin: nullable, store_sku: nullable, observed_at: nullable });
const evidence = z.object({ product, page_id: text, created_at: text, body_sha256: text, requested_url: text.optional(), final_url: nullable.optional(), mode: z.enum(['products', 'listings', 'probe']).optional() });
const hold = z.object({ id: text, at: text, reasons: z.array(text) });
const historicalHint = z.object({ id: text, store_product_id: text, candidate_sku: nullable, candidate_name: nullable, candidate_url: nullable, classification: text, created_at: text });
export const discoveryInput = z.object({ asOf: text.datetime(), mappings: z.array(mapping), peers: z.array(peer),
  evidence: z.array(evidence), attempts: z.array(z.object({ requested_url: text, unresolved: z.boolean() })),
  rejections: z.array(hold), historicalHints: z.array(historicalHint).default([]), demand: z.array(z.object({ name: text, demand: z.number().nonnegative() })) });
export type DiscoveryInput = z.input<typeof discoveryInput>;
type Mapping = DiscoveryInput['mappings'][number];
type Evidence = DiscoveryInput['evidence'][number];
export type Classification = 'ready' | 'repair_required' | 'ambiguous' | 'mismatch' | 'needs_evidence' | 'held';
export type Candidate = { canonicalProductId: string; sku: string; url: string; urlVerification: 'stored_evidence_only'; liveVerifiedThisRun: false; sourceUrl: string | null; sourceMode: string | null;
  name: string; brand: string | null; quantity: TescoCollectedProduct['quantity']; availableInStoredEvidence: boolean; gtin: string | null; pageId: string; bodySha256: string;
  observedAt: string; score: number; signals: string[]; reasons: string[] };
export type Decision = { productId: string; mappingId: string | null; name: string; fingerprint: string;
  existingMapping: { sku: string | null; url: string | null; name: string | null; status: string | null }; historicalHints: z.infer<typeof historicalHint>[];
  classification: Classification; reasons: string[]; candidates: Candidate[]; comparison: boolean;
  demand: number; exactSku: string | null; exactUrl: string | null;
  collectorTarget: { canonicalProductId: string; storeProductId: string | null; sku: string; url: string; requiresRepair: boolean } | null;
  score: number; reused: boolean };
export type DiscoveryState = { version: string; decisions: Decision[] };
export function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function plain(s: string | null) { return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/&(?:amp;)?/g, ' and ').replace(/[^a-z0-9.]+/g, ' ').trim().replace(/\s+/g, ' '); }
// No fuzzy spelling, synonyms, brand inference or formulation aliases here.
function tokens(s: string) { return [...new Set(plain(s).replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|cl|l)\b/g, ' ')
  .split(' ').filter(x => (x.length > 1 || /^\d/.test(x)) && !['and', 'the', 'with', 'pack', 'bottle', 'box', 'packet'].includes(x)))].sort(); }
export function validGtin(value: string | null): string | null {
  if (!value || !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value) || /^0+$/.test(value)) return null;
  const digits = [...value].map(Number), check = digits.pop();
  const sum = digits.reverse().reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === check ? value.padStart(14, '0') : null;
}
function fresh(at: string | null, now: number, days: number) {
  const time = at ? Date.parse(at) : NaN;
  return Number.isFinite(time) && time <= now && time > now - days * 86400000;
}
function measure(s: string) {
  const t = plain(s).replace(/kilograms?/g, 'kg').replace(/grams?/g, 'g').replace(/millilitres?/g, 'ml').replace(/litres?/g, 'l');
  const measures = [...t.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/g)];
  const m = measures[0];
  const pack = t.match(/\b(\d+)\s*(?:x|pack|pk|pieces?|rolls?)\b/)?.[1] ?? null;
  const multipliers: Record<string, number> = { kg: 1000, l: 1000, cl: 10 };
  return { amount: m ? Number(m[1]) * (multipliers[m[2]] ?? 1) : null,
    unit: m ? ['kg', 'g'].includes(m[2]) ? 'g' : 'ml' : null, pack, measureCount: measures.length };
}
function sameIdentityWords(a: string, b: string) { return JSON.stringify(tokens(a)) === JSON.stringify(tokens(b)); }
function brandInTitle(brand: string, title: string) { return (` ${plain(title)} `).includes(` ${plain(brand)} `); }
function mappingFor(m: Mapping, e: Evidence, group: Mapping[]) {
  return { storeProductId: m.id ?? m.product_id, canonicalName: m.canonical_name, canonicalBrand: m.canonical_brand,
    storeProductName: e.product.name, storeBrand: e.product.brand, isOwnBrand: /^tesco\b/i.test(e.product.name),
    storeSku: e.product.sku, storeUrl: e.product.url, duplicateSkuCount: group.length + (group.some(x => x.id === m.id) ? 0 : 1),
    duplicateCanonicalNames: [...group.filter(x => x.id !== m.id).map(x => x.canonical_name), m.canonical_name], isFresh: false };
}

export function discover(raw: unknown, previous?: DiscoveryState) {
  const input = discoveryInput.parse(raw), now = Date.parse(input.asOf);
  const bySku = new Map<string, Evidence[]>(), byToken = new Map<string, Set<Evidence>>(), byGtin = new Map<string, Set<Evidence>>();
  const add = (index: Map<string, Set<Evidence>>, key: string, e: Evidence) => { if (!index.has(key)) index.set(key, new Set()); index.get(key)!.add(e); };
  // Multiple snapshots of one SKU are retained in the fingerprint; newest wins
  // deterministically for validation. Equal-time conflicting evidence is held.
  for (const e of input.evidence) {
    const arr = bySku.get(e.product.sku) ?? []; arr.push(e); bySku.set(e.product.sku, arr);
  }
  const latest = new Map<string, Evidence>();
  for (const [sku, rows] of bySku) {
    rows.sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || a.page_id.localeCompare(b.page_id));
    const e = rows[0]; latest.set(sku, e);
    for (const word of tokens(e.product.name)) add(byToken, word, e);
    const gtin = validGtin(e.product.gtin); if (gtin) add(byGtin, gtin, e);
  }
  const mappingsBySku = new Map<string, Mapping[]>();
  for (const m of input.mappings) if (m.store_sku) { const arr = mappingsBySku.get(m.store_sku) ?? []; arr.push(m); mappingsBySku.set(m.store_sku, arr); }
  const old = new Map(previous?.version === DISCOVERY_VERSION ? previous.decisions.map(x => [x.productId, x]) : []);
  const demand = new Map(input.demand.map(x => [plain(x.name), x.demand]));
  const decisions: Decision[] = [];
  let evaluated = 0, reused = 0;
  for (const m of [...input.mappings].sort((a, b) => a.product_id.localeCompare(b.product_id))) {
    if (fresh(m.observed_at, now, 7)) continue;
    const peers = input.peers.filter(x => x.product_id === m.product_id).sort((a, b) => a.id.localeCompare(b.id));
    const freshPeers = peers.filter(x => fresh(x.observed_at, now, 7));
    const independentGtins = new Set(peers.map(x => validGtin(x.gtin)).filter((x): x is string => x !== null));
    const words = tokens(m.canonical_name), pool = new Set<Evidence>();
    if (m.store_sku && latest.has(m.store_sku)) pool.add(latest.get(m.store_sku)!);
    for (const gtin of independentGtins) for (const e of byGtin.get(gtin) ?? []) pool.add(e);
    const overlaps = new Map<Evidence, number>();
    for (const word of words) for (const e of byToken.get(word) ?? []) overlaps.set(e, (overlaps.get(e) ?? 0) + 1);
    for (const [e, n] of overlaps) if (n >= Math.min(2, words.length)) pool.add(e);
    const score = (e: Evidence) => (independentGtins.has(validGtin(e.product.gtin) ?? '') ? 100 : 0)
      + (m.store_sku === e.product.sku ? 40 : 0) + (overlaps.get(e) ?? 0) * 3;
    const ranked = [...pool].sort((a, b) => score(b) - score(a) || a.product.sku.localeCompare(b.product.sku));
    const truncated = ranked.length > 200, shortlist = ranked.slice(0, 200);
    const groupSnapshots = shortlist.map(e => mappingsBySku.get(e.product.sku) ?? []);
    const attempts = input.attempts.filter(a => a.requested_url === m.store_url || shortlist.some(e => e.product.url === a.requested_url));
    const historicalHints = input.historicalHints.filter(x => x.store_product_id === m.id || x.candidate_sku === m.store_sku);
    const rejections = input.rejections.filter(x => x.id === m.id).sort((a, b) => a.at.localeCompare(b.at));
    const fingerprint = digest({ version: DISCOVERY_VERSION, m, peers, peerFresh: freshPeers.map(p => p.id),
      evidence: shortlist.map(e => ({ e, recent: fresh(e.created_at, now, 14), siblings: bySku.get(e.product.sku) })),
      groupSnapshots, attempts, rejections, historicalHints, truncated, demand: demand.get(plain(m.canonical_name)) ?? 0 });
    const cached = old.get(m.product_id);
    if (cached?.fingerprint === fingerprint) { decisions.push({ ...cached, reused: true }); reused++; continue; }
    evaluated++;
    const candidates: Candidate[] = shortlist.map(e => {
      const p = e.product, group = mappingsBySku.get(p.sku) ?? [], reasons: string[] = [], signals: string[] = [];
      const gtin = validGtin(p.gtin);
      if (gtin && independentGtins.has(gtin)) signals.push('independent_peer_gtin');
      if (gtin && validGtin(m.gtin) === gtin) signals.push('tesco_gtin_only_not_independent');
      if (m.store_sku === p.sku) signals.push('historical_sku');
      if (!/^\d+$/.test(p.sku) || p.url !== `https://www.tesco.ie/shop/en-IE/products/${p.sku}`) reasons.push('exact_irish_product_url_required');
      if (!fresh(e.created_at, now, 14)) reasons.push('stored_evidence_older_than_14_days_or_invalid');
      if (!e.page_id || !/^[a-f0-9]{64}$/i.test(e.body_sha256)) reasons.push('missing_evidence_provenance');
      if (bySku.get(p.sku)!.some(other => Date.parse(other.created_at) === Date.parse(e.created_at) && digest(other.product) !== digest(p))) reasons.push('conflicting_same_time_evidence');
      if (!m.canonical_brand || !brandInTitle(m.canonical_brand, p.name)) reasons.push('explicit_brand_not_established');
      if (m.canonical_brand && p.brand && plain(p.brand) !== plain(m.canonical_brand)) reasons.push('structured_brand_conflict');
      const canonicalMeasure = measure(m.canonical_name), candidateMeasure = measure(p.name);
      if (canonicalMeasure.measureCount > 1 || candidateMeasure.measureCount > 1) reasons.push('compound_measure_requires_review');
      if (canonicalMeasure.amount === null && canonicalMeasure.pack === null) reasons.push('canonical_pack_or_measure_missing');
      if (candidateMeasure.amount === null && candidateMeasure.pack === null) reasons.push('candidate_pack_or_measure_missing');
      if (JSON.stringify(canonicalMeasure) !== JSON.stringify(candidateMeasure)) reasons.push('explicit_pack_or_measure_differs');
      // Bidirectional words close the added-variant/blend gap: a substring pass
      // against a generic canonical name must never establish exact identity.
      if (!sameIdentityWords(m.canonical_name, p.name)) reasons.push('unexplained_identity_terms');
      if (group.some(x => x.product_id !== m.product_id)) reasons.push('duplicate_sku_requires_review');
      if (gtin && independentGtins.size && !independentGtins.has(gtin)) reasons.push('independent_gtin_conflict');
      for (const peer of peers) {
        if (measure(peer.store_product_name).measureCount > 1) reasons.push('peer_compound_measure_requires_review');
        if (peer.brand && m.canonical_brand && plain(peer.brand) !== plain(m.canonical_brand)) reasons.push('peer_brand_conflict');
        if (!sameIdentityWords(m.canonical_name, peer.store_product_name)
          || JSON.stringify(measure(m.canonical_name)) !== JSON.stringify(measure(peer.store_product_name))) reasons.push('peer_identity_requires_review');
      }
      reasons.push(...validateTescoCollectedIdentity(mappingFor(m, e, group), p as TescoCollectedProduct));
      if (!reasons.length) signals.push('unchanged_validator_and_discovery_checks_pass');
      return { canonicalProductId: m.product_id, sku: p.sku, url: p.url,
        urlVerification: 'stored_evidence_only' as const, liveVerifiedThisRun: false as const, sourceUrl: e.requested_url ?? null, sourceMode: e.mode ?? null,
        name: p.name, brand: p.brand, quantity: p.quantity, availableInStoredEvidence: p.available, gtin, pageId: e.page_id, bodySha256: e.body_sha256,
        observedAt: e.created_at, score: score(e), signals, reasons: [...new Set(reasons)].sort() };
    });
    const exact = candidates.filter(x => !x.reasons.length);
    const reasons: string[] = [];
    let classification: Classification = 'needs_evidence';
    if (exact.length > 1) { classification = 'ambiguous'; reasons.push('multiple_exact_candidate_skus'); }
    else if (exact.length === 1 && !truncated) {
      const e = exact[0], attempt = attempts.find(x => x.requested_url === latest.get(e.sku)!.product.url);
      if (attempt) { classification = 'held'; reasons.push(attempt.unresolved ? 'unresolved_request' : 'previously_attempted'); }
      else if (rejections.some(x => Date.parse(x.at) >= Date.parse(e.observedAt))) { classification = 'held'; reasons.push('no_new_evidence_after_rejection'); }
      else if (e.sku !== m.store_sku || m.store_url !== latest.get(e.sku)!.product.url || m.url_status !== 'resolved' || !m.id) {
        classification = 'repair_required'; reasons.push('exact_identity_requires_approved_mapping_change');
      } else if (!m.proven) { classification = 'held'; reasons.push('existing_supervised_runner_requires_prior_success'); }
      else { classification = 'ready'; reasons.push('live_price_verification_required'); }
    } else if (truncated) reasons.push('candidate_pool_truncated_no_acceptance');
    else if (candidates.length) {
      const same = candidates.find(x => x.sku === m.store_sku);
      const material = same?.reasons.filter(x => /Conflict|structured_brand_conflict|raw_ingredient_prepared_meal_conflict/.test(x)
        || (x === 'explicit_pack_or_measure_differs' && !same.reasons.includes('canonical_pack_or_measure_missing') && !same.reasons.includes('candidate_pack_or_measure_missing'))) ?? [];
      if (material.length) { classification = 'mismatch'; reasons.push('stored_mapping_conflict_not_proof_no_exact_product_exists', ...material); }
      else if (candidates.some(x => x.reasons.includes('duplicate_sku_requires_review') && x.reasons.every(r => r === 'duplicate_sku_requires_review' || r === 'duplicate SKU group requires identity review'))) { classification = 'ambiguous'; reasons.push('duplicate_sku_or_canonical_identity_requires_review'); }
      else reasons.push('no_candidate_passes_all_identity_checks');
    } else reasons.push('no_structured_candidate_evidence');
    decisions.push({ productId: m.product_id, mappingId: m.id, name: m.canonical_name, fingerprint, classification,
      existingMapping: { sku: m.store_sku, url: m.store_url, name: m.store_product_name, status: m.url_status }, historicalHints,
      reasons, candidates, comparison: new Set(freshPeers.map(x => x.store)).size === 2,
      demand: demand.get(plain(m.canonical_name)) ?? 0, exactSku: exact.length === 1 ? exact[0].sku : null,
      exactUrl: exact.length === 1 ? exact[0].url : null,
      collectorTarget: ['ready', 'repair_required'].includes(classification) && exact.length === 1
        ? { canonicalProductId: m.product_id, storeProductId: m.id, sku: exact[0].sku, url: exact[0].url, requiresRepair: classification === 'repair_required' } : null,
      score: exact[0]?.score ?? candidates[0]?.score ?? 0, reused: false });
  }
  const priority: Record<Classification, number> = { ready: 0, repair_required: 1, held: 2, ambiguous: 3, needs_evidence: 4, mismatch: 5 };
  decisions.sort((a, b) => priority[a.classification] - priority[b.classification] || Number(b.comparison) - Number(a.comparison)
    || b.demand - a.demand || b.score - a.score || a.productId.localeCompare(b.productId));
  const counts = Object.fromEntries(Object.keys(priority).map(k => [k, decisions.filter(x => x.classification === k).length]));
  return { version: DISCOVERY_VERSION, asOf: input.asOf, inputDigest: digest(input), evaluated, reused, counts,
    newlyReady: decisions.filter(x => x.classification === 'ready' && old.get(x.productId)?.classification !== 'ready').map(x => x.productId),
    decisions };
}
