import { discover, discoveryInput, discoveryIdentityProfile, digest, validGtin } from './tesco-discovery';
import { acquisitionDecision, type AcquisitionSnapshot } from './tesco-acquisition-handoff';

export type RequestHistory = { requested_url: string; outcome: string; mode: string };
export type CoveragePlanOptions = { requests: RequestHistory[]; acquisitions?: AcquisitionSnapshot[]; queryBudget?: number };
function norm(s: string) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function listingQuery(url: string) {
  try { const u = new URL(url); return u.origin === 'https://www.tesco.ie' && u.pathname === '/shop/en-IE/search' ? norm(u.searchParams.get('query') ?? '') : null; }
  catch { return null; }
}
type Root = 'metadata_incomplete' | 'peer_identity_review' | 'exact_operational_hold' | 'exact_handoff' | 'ambiguous_sku' | 'mapping_conflict' | 'fresh_evidence_needed' | 'mapping_repair' | 'ready';
export function planTescoCoverage(raw: unknown, options: CoveragePlanOptions) {
  const input = discoveryInput.parse(raw), budget = options.queryBudget ?? 10;
  if (!Number.isInteger(budget) || budget < 1 || budget > 100) throw new Error('Query budget must be 1–100 (planning only)');
  const discovery = discover(input), mappings = new Map(input.mappings.map(m => [m.product_id, m]));
  const eligibleAcquisitions = new Map((options.acquisitions ?? []).flatMap(s => {
    const d = acquisitionDecision(s); return d ? [[d.productId, { pageId: s.page.id, sku: d.exactSku, url: d.exactUrl }] as const] : [];
  }));
  const priorQueries = new Set(options.requests.map(r => listingQuery(r.requested_url)).filter((q): q is string => q !== null));
  const pendingQueries = options.requests.filter(r => r.outcome === 'pending').map(r => listingQuery(r.requested_url)).filter((q): q is string => q !== null);
  const rows = discovery.decisions.map(d => {
    const m = mappings.get(d.productId)!;
    const profile = discoveryIdentityProfile(m.canonical_name), peers = input.peers.filter(p => p.product_id === m.product_id);
    const complete = !!m.canonical_brand && (profile.amount !== null || profile.pack !== null) && profile.measureCount <= 1;
    const peerExact = new Set(peers.map(p => p.store)).size === 2 && peers.every(p =>
      !!p.brand && norm(p.brand) === norm(m.canonical_brand ?? '') && JSON.stringify(discoveryIdentityProfile(p.store_product_name)) === JSON.stringify(profile));
    const ownCandidate = d.candidates.find(c => c.sku === m.store_sku);
    const proposedHandoff = eligibleAcquisitions.get(d.productId);
    const source = options.acquisitions?.find(s => s.page.id === proposedHandoff?.pageId);
    const handoff = proposedHandoff && d.exactSku === proposedHandoff.sku && d.exactUrl === proposedHandoff.url
      && source?.mappings[0].id === m.id && source.mappings[0].canonical_name === m.canonical_name
      && source.mappings[0].canonical_brand === m.canonical_brand
      && JSON.stringify(source.peers.map(p => [p.id,p.store_product_name,p.brand,p.gtin,p.observed_at]).sort())
        === JSON.stringify(peers.map(p => [p.id,p.store_product_name,p.brand,p.gtin,p.observed_at]).sort())
      ? proposedHandoff : undefined;
    const urlHeld = options.requests.some(r => r.outcome === 'pending' && (r.requested_url === m.store_url || d.candidates.some(c => c.url === r.requested_url)));
    // A held brand/family query is never evaded by inventing a different query.
    const brand = norm(m.canonical_brand ?? '');
    const listingHeld = !!brand && pendingQueries.some(q => q === brand || q.startsWith(brand + ' ') || brand.startsWith(q + ' '));
    const root: Root = !complete ? 'metadata_incomplete' : !peerExact ? 'peer_identity_review'
      : handoff ? 'exact_handoff' : d.classification === 'ready' ? 'ready'
      : d.classification === 'repair_required' ? 'mapping_repair' : d.exactSku ? 'exact_operational_hold'
      : d.classification === 'ambiguous' ? 'ambiguous_sku' : d.classification === 'mismatch' ? 'mapping_conflict' : 'fresh_evidence_needed';
    return { canonicalProductId: d.productId, mappingId: m.id, name: d.name, brand: m.canonical_brand,
      root, comparison: d.comparison, demand: d.demand, canonicalComplete: complete, peerExact,
      acquisitionEligible: complete && peerExact && !urlHeld && !listingHeld && !d.exactSku && d.classification !== 'ambiguous',
      operationalHolds: [...(urlHeld ? ['unresolved_product_request'] : []), ...(listingHeld ? ['unresolved_listing_scope'] : [])],
      existingSku: m.store_sku, existingUrl: m.store_url, exactSku: d.exactSku, exactUrl: d.exactUrl,
      handoff: handoff ?? null, collectionReady: d.classification === 'ready' || !!handoff,
      urlVerification: 'stored_evidence_only' as const, liveVerifiedThisRun: false,
      reasons: d.reasons, currentSkuReasons: ownCandidate?.reasons ?? ['no_current_sku_evidence'],
      evidence: d.candidates.map(c => ({ sku: c.sku, url: c.url, pageId: c.pageId, bodySha256: c.bodySha256,
        observedAt: c.observedAt, reasons: c.reasons, gtin: c.gtin })),
      peers, fingerprint: d.fingerprint };
  }).sort((a, b) => Number(b.comparison) - Number(a.comparison) || b.demand - a.demand || a.canonicalProductId.localeCompare(b.canonicalProductId));
  const pools = new Map<string, Set<string>>();
  for (const r of rows.filter(r => r.acquisitionEligible)) {
    const brand = norm(r.brand!), words = discoveryIdentityProfile(r.name).words.map(norm).filter(w => w && !brand.split(' ').includes(w));
    // These are retrieval queries, not identity aliases or acceptance decisions.
    for (const q of new Set([brand, ...words.filter(w => !/^\d/.test(w)).map(w => `${brand} ${w}`)])) {
      if (priorQueries.has(q)) continue;
      const set = pools.get(q) ?? new Set<string>(); set.add(r.canonicalProductId); pools.set(q, set);
    }
  }
  const byId = new Map(rows.map(r => [r.canonicalProductId, r])), covered = new Set<string>();
  const queries: { query: string; url: string; productIds: string[]; comparisonTargets: number; expectedMatches: null; requiresAuthorisedSupervision: true }[] = [];
  for (let i = 0; i < budget; i++) {
    const choices = [...pools].map(([query, ids]) => ({ query, ids: [...ids].filter(id => !covered.has(id)) }))
      .filter(x => x.ids.length).map(x => ({ ...x, score: x.ids.reduce((n, id) => n + (byId.get(id)!.comparison ? 1000 : 1) + Math.min(byId.get(id)!.demand, 20), 0) }))
      .sort((a, b) => b.score - a.score || b.ids.length - a.ids.length || a.query.localeCompare(b.query));
    const best = choices[0]; if (!best) break;
    best.ids.forEach(id => covered.add(id)); pools.delete(best.query);
    queries.push({ query: best.query, url: `https://www.tesco.ie/shop/en-IE/search?query=${encodeURIComponent(best.query)}&page=1&count=24&sortBy=relevance`,
      productIds: best.ids, comparisonTargets: best.ids.filter(id => byId.get(id)!.comparison).length, expectedMatches: null, requiresAuthorisedSupervision: true });
  }
  const counts = Object.fromEntries([...new Set(rows.map(r => r.root))].sort().map(root => [root, rows.filter(r => r.root === root).length]));
  return { version: 'tesco-coverage-plan-v1', asOf: input.asOf, inputDigest: digest(input), requestHistoryDigest: digest(options.requests),
    readOnly: true, requestsExecuted: 0, observationsInserted: 0, counts,
    metrics: { evaluated: rows.length, comparisonGaps: rows.filter(r => r.comparison).length,
      peerExactComplete: rows.filter(r => r.canonicalComplete && r.peerExact).length,
      peerExactCompleteComparisons: rows.filter(r => r.canonicalComplete && r.peerExact && r.comparison).length,
      acquisitionTargets: rows.filter(r => r.acquisitionEligible).length, queries: queries.length, queryTargetCoverage: covered.size,
      queryComparisonTargets: [...covered].filter(id => byId.get(id)!.comparison).length,
      collectionReady: rows.filter(r => r.collectionReady).length,
      independentPeerGtins: input.peers.filter(p => validGtin(p.gtin)).length,
      evidenceBackedMappingRepairs: discovery.decisions.filter(d => d.classification === 'repair_required').length },
    rows, queries, discoveryCounts: discovery.counts };
}
