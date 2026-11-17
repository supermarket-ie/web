/* eslint-disable @typescript-eslint/no-explicit-any -- offline analysis over untyped raw PostgREST JSON */
// READ-ONLY, OFFLINE Dunnes x SuperValu exact-pair assessment.
// Input: the private raw files written by scripts/pair-assessment-fetch.ts.
// Reuses src/lib/branded-intersection.ts (evaluate) and branded-product-identity.ts
// (compare). It adds NO matching rules: it only builds a two-retailer snapshot
// (tesco = []) and classifies the existing evaluator's output. The three-retailer
// verification metric is not consulted.
//
// Evidence tiers reported separately and never merged:
//   deterministic_recorded  - evaluator exact_match on retained/recorded evidence
//   ledger_qualifying       - needs captured_product source + approved row in
//                             retailer_offer_pair_reviews (none exist today)
//
// Usage: tsx scripts/pair-assessment.ts <rawDir> <outDir>
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { evaluate } from '../src/lib/branded-intersection';
import { compare, parsePack, type Evidence } from '../src/lib/branded-product-identity';

const [rawDir, outRoot] = process.argv.slice(2);
if (!rawDir || !outRoot) throw new Error('usage: <rawDir> <outDir>');
const L = <T = Record<string, any>>(n: string): T[] => JSON.parse(readFileSync(`${rawDir}/raw-${n}.json`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${rawDir}/fetch-manifest.json`, 'utf8'));
const asOf = new Date(manifest.finishedAt).toISOString();
const DAY = 86400000;
const fresh = (at: string | null) => !!at && Date.parse(at) <= Date.parse(asOf) && Date.parse(at) > Date.parse(asOf) - 7 * DAY;

// ---- build the two-retailer snapshot --------------------------------------------------
const sp = L('store_products'), prices = new Map(L('latest_prices').map(r => [r.store_product_id, r]));
const methods = new Map(L('scrape_runs').map(r => [r.id, r.retrieval_method]));
const latestReceipt = new Map<string, Record<string, any>>();
for (const r of L('scrape_product_receipts')) {
  const p = latestReceipt.get(r.store_product_id);
  if (!p || r.created_at > p.created_at || (r.created_at === p.created_at && r.run_id < p.run_id)) latestReceipt.set(r.store_product_id, r);
}
const mappings = sp.map(s => { const l = prices.get(s.id), r = latestReceipt.get(s.id);
  return { id: s.id, product_id: s.product_id, store: s.store, store_product_name: s.store_product_name ?? null, brand: s.brand ?? null,
    is_own_brand: Boolean(s.is_own_brand), store_sku: s.store_sku ?? null, store_url: s.store_url ?? null, url_status: s.url_status ?? null,
    url_last_checked_at: s.url_last_checked_at ?? null, gtin: s.gtin ?? null, price: l ? Number(l.price) : null, observed_at: l?.observed_at ?? null,
    price_source: l?.source ?? null, receipt_at: r?.created_at ?? null, receipt_outcome: r?.outcome ?? null, receipt_run_id: r?.run_id ?? null,
    receipt_method: r ? methods.get(r.run_id) ?? null : null }; });
const products: Record<string, any>[] = L('products').map(p => ({ ...p, description: p.description ? String(p.description).slice(0, 3000) : null,
  ingredients: p.ingredients ? String(p.ingredients).slice(0, 3000) : null }));
const demandMap = new Map<string, number>();
for (const i of L('list_items')) { const k = String(i.canonical_name).trim().toLowerCase(); demandMap.set(k, (demandMap.get(k) ?? 0) + Math.max(Number(i.quantity) || 0, 1)); }
const snapshot = { asOf, products, mappings, tesco: [], retailerEvidence: [],
  brandClaims: L('manufacturer_brand_claims').map(r => r.claim), retailerResponses: L('retailer_identity_responses_latest'),
  failures: L('scrape_failures').map(f => ({ id: f.id, store_product_id: f.store_product_id, failure_reason: f.failure_reason, created_at: f.created_at, raw_error: f.raw_error ?? null })),
  demand: [...demandMap].map(([name, units]) => ({ name, units })), attempts: [], gates: [], renewal: { due: 0, firstDue: null, firstExpiry: null } };
const report = evaluate(snapshot);

// ---- classify ---------------------------------------------------------------------------
const rec = new Map(report.records.map(r => [r.id, r as Evidence]));
const pairKey = (a: string, b: string) => [a, b].sort().join('|');
const pairs = new Map(report.pairs.map(p => [pairKey(p.left, p.right), p.result]));
const byProduct = new Map<string, typeof mappings>();
for (const m of mappings) byProduct.set(m.product_id, [...(byProduct.get(m.product_id) ?? []), m]);
const rid = (m: { store: string; store_sku: string | null; id: string }) => `${m.store}:${m.store_sku || `missing-${m.id}`}`;
const mfresh = (m: (typeof mappings)[number] | undefined) => Boolean(m && m.url_status === 'resolved' && m.price && m.price > 0 && fresh(m.observed_at));
const pname = new Map(products.map(p => [p.id, p.canonical_name]));

// 1. Reconcile the owner's "743 Dunnes SKUs sharing catalogue records with fresh SuperValu prices".
let sharedWithFreshSv = 0, sharedAny = 0;
for (const [, ms] of byProduct) {
  const d = ms.filter(m => m.store === 'dunnes' && m.store_sku), s = ms.filter(m => m.store === 'supervalu' && m.store_sku);
  if (s.length) sharedAny += d.length;
  if (s.some(mfresh)) sharedWithFreshSv += d.length;
}

type Row = Record<string, unknown>;
const assoc: Row[] = [];
for (const [pid, ms] of byProduct) {
  const ds = ms.filter(m => m.store === 'dunnes' && m.store_sku), ss = ms.filter(m => m.store === 'supervalu' && m.store_sku);
  for (const d of ds) for (const s of ss) {
    const a = rec.get(rid(d)), b = rec.get(rid(s)); if (!a || !b) continue;
    const key = pairKey(a.id, b.id);
    const res = pairs.get(key) ?? compare(a, b, report.brandRules, asOf);
    const hard = res.contradictions.filter(c => c !== 'retailer_private_label' && c !== 'brand_conflict');
    const brandFight = res.contradictions.includes('brand_conflict') && !res.contradictions.includes('retailer_private_label');
    const pa = parsePack(a.title, a.quantity), pb = parsePack(b.title, b.quantity);
    // A pack-count "conflict" whose total amount and unit agree is an evaluator wording gap
    // (bare counts such as "6 Be Good Bagels 270g" vs "6 Pack 270g"), not a proven contradiction.
    const countOnly = hard.length > 0 && hard.every(c => c === 'pack_count_conflict') && pa.amount !== null && pa.amount === pb.amount && pa.unit === pb.unit;
    const cat = res.decision === 'exact_match' ? 'exact_deterministic'
      : countOnly && !brandFight ? 'needs_evidence_pack_count_wording'
      : hard.length || brandFight ? 'incorrect_or_misleading'
      : res.contradictions.includes('retailer_private_label') ? 'not_exact_private_label'
      : res.missing.includes('brand_ownership_unverified') ? 'needs_evidence_brand_unverified' : 'needs_evidence_other';
    assoc.push({ canonicalId: pid, canonical: pname.get(pid), dunnesSku: d.store_sku, dunnesTitle: d.store_product_name, supervaluSku: s.store_sku,
      supervaluTitle: s.store_product_name, category: cat, method: res.method, contradictions: res.contradictions, missing: res.missing,
      dunnesFresh: mfresh(d), supervaluFresh: mfresh(s), bothFresh: mfresh(d) && mfresh(s), dunnesPrice: d.price, supervaluPrice: s.price,
      evidenceKinds: [a.source.kind, b.source.kind] });
  }
}
const count = (rows: Row[], f: (r: Row) => string) => rows.reduce<Record<string, number>>((o, r) => { const k = f(r); o[k] = (o[k] ?? 0) + 1; return o; }, {});

// 2. Exact groups (evaluator, two-retailer) split by canonical relationship.
const exact: Row[] = [];
for (const g of report.exactGroups as any[]) {
  const d = g.retailers.dunnes, s = g.retailers.supervalu; if (!d || !s) continue;
  const rd = rec.get(d.evidenceId)!, rs = rec.get(s.evidenceId)!;
  const shared = rd.canonicalIds.filter(c => rs.canonicalIds.includes(c));
  const relation = shared.length ? 'same_canonical' : (!rd.canonicalIds.length || !rs.canonicalIds.length) ? 'unmapped_side' : 'different_canonical';
  const dm = rd.mappingIds.map(id => mappings.find(m => m.id === id)).find(Boolean), sm = rs.mappingIds.map(id => mappings.find(m => m.id === id)).find(Boolean);
  exact.push({ dunnesSku: rd.sku, supervaluSku: rs.sku, dunnesTitle: rd.title, supervaluTitle: rs.title, relation,
    dunnesCanonical: rd.canonicalIds.map(c => pname.get(c)), supervaluCanonical: rs.canonicalIds.map(c => pname.get(c)),
    dunnesFresh: mfresh(dm), supervaluFresh: mfresh(sm), bothFresh: mfresh(dm) && mfresh(sm), dunnesPrice: dm?.price ?? null, supervaluPrice: sm?.price ?? null,
    evidenceKinds: [rd.source.kind, rs.source.kind], ledgerQualifying: rd.source.kind === 'captured_product' && rs.source.kind === 'captured_product' });
}

// 3. Plausible same-pack candidates the evaluator could not settle (inference / corroboration lane).
const mapById = new Map(mappings.map(m => [m.id, m]));
const realSku = (r: Evidence) => /^\d{5,14}$/.test(r.sku);
const placeholderPairs = report.candidates.filter(p => !realSku(rec.get(p.left)!) || !realSku(rec.get(p.right)!)).length;
const cand: Row[] = report.candidates.filter(p => realSku(rec.get(p.left)!) && realSku(rec.get(p.right)!)).map(p => {
  const x = rec.get(p.left)!, y = rec.get(p.right)!, d = x.store === 'dunnes' ? x : y, s = x.store === 'dunnes' ? y : x;
  const shared = d.canonicalIds.filter(c => s.canonicalIds.includes(c));
  const relation = shared.length ? 'same_canonical' : (!d.canonicalIds.length || !s.canonicalIds.length) ? 'unmapped_side' : 'different_canonical';
  const dm = mapById.get(d.mappingIds[0]), sm = mapById.get(s.mappingIds[0]);
  const blockers = p.result.missing.filter(m => m !== 'wording_requires_inference_or_corroboration');
  return { pairId: p.id, dunnesSku: d.sku, supervaluSku: s.sku, dunnesTitle: d.title, supervaluTitle: s.title, relation, bothFresh: mfresh(dm) && mfresh(sm),
    otherBlockers: blockers, wordingOnly: blockers.length === 0, bothHaveGtin: Boolean(d.gtin && s.gtin),
    canonicalDunnes: d.canonicalIds.map(c => pname.get(c)), canonicalSupervalu: s.canonicalIds.map(c => pname.get(c)) };
});
const recs = [...rec.values()];
const gtinCoverage = Object.fromEntries(['dunnes', 'supervalu'].map(st => [st, { records: recs.filter(r => r.store === st).length,
  withGtin: recs.filter(r => r.store === st && r.gtin).length }]));

// 3b. Inference priority (ORDER only; selectInferenceCandidates still decides eligibility):
// wording-only pairs with both prices fresh, one-to-one, same canonical, then smallest wording difference.
const wordsOf = (t: string) => t.toLowerCase().replace(/\(|\)/g, ' ').split(/[^a-z0-9']+/).filter(w => w && !/^\d/.test(w) && !['g', 'kg', 'ml', 'l'].includes(w));
const wo = cand.filter(r => r.wordingOnly);
const dN = count(wo, r => String(r.dunnesSku)), sN = count(wo, r => String(r.supervaluSku));
const diff = (r: Row) => { const a = wordsOf(String(r.dunnesTitle)), b = wordsOf(String(r.supervaluTitle)); return a.filter(w => !b.includes(w)).length + b.filter(w => !a.includes(w)).length; };
const priority = wo.map(r => ({ r, oneToOne: dN[String(r.dunnesSku)] === 1 && sN[String(r.supervaluSku)] === 1, d: diff(r) }))
  .sort((x, y) => Number(y.r.bothFresh) - Number(x.r.bothFresh) || Number(y.oneToOne) - Number(x.oneToOne)
    || Number(y.r.relation === 'same_canonical') - Number(x.r.relation === 'same_canonical') || x.d - y.d || String(x.r.pairId).localeCompare(String(y.r.pairId)));

// 3c. Capture pilot: 10 deterministic exact candidates that are the strongest to verify first.
// Both prices fresh, plausible price agreement, a single owner per SKU, canonical URL form, distinct brands.
const skuOwnerCount = new Map<string, number>();
for (const m of mappings) if (/^\d{5,14}$/.test(m.store_sku ?? '')) skuOwnerCount.set(`${m.store}:${m.store_sku}`, (skuOwnerCount.get(`${m.store}:${m.store_sku}`) ?? 0) + 1);
const pilotPool = exact.filter(e => e.bothFresh && e.relation === 'same_canonical').map(e => {
  const dm = mappings.find(m => m.store === 'dunnes' && m.store_sku === e.dunnesSku)!, sm = mappings.find(m => m.store === 'supervalu' && m.store_sku === e.supervaluSku)!;
  const ratio = Math.min(Number(e.dunnesPrice), Number(e.supervaluPrice)) / Math.max(Number(e.dunnesPrice), Number(e.supervaluPrice));
  const urlOk = (m: typeof dm) => Boolean(m.store_url && new RegExp(`(?:/|-id-)${m.store_sku}$`).test(new URL(m.store_url).pathname));
  const single = skuOwnerCount.get(`dunnes:${e.dunnesSku}`) === 1 && skuOwnerCount.get(`supervalu:${e.supervaluSku}`) === 1;
  return { ...e, dunnesStoreProductId: dm.id, supervaluStoreProductId: sm.id, dunnesUrl: dm.store_url, supervaluUrl: sm.store_url,
    priceRatio: Number(ratio.toFixed(3)), eligible: ratio >= 0.75 && urlOk(dm) && urlOk(sm) && single,
    brand: String(e.dunnesTitle).trim().split(/\s+/)[0].toLowerCase() };
}).filter(e => e.eligible).sort((a, b) => b.priceRatio - a.priceRatio || String(a.dunnesSku).localeCompare(String(b.dunnesSku)));
const pilot: typeof pilotPool = [];
for (const e of pilotPool) if (pilot.length < 10 && !pilot.some(p => p.brand === e.brand)) pilot.push(e);

// 4. Missing retailer mappings and mapping defects.
const hasSku = (m: (typeof mappings)[number]) => /^\d{5,14}$/.test(m.store_sku ?? '');
const pool = { dunnesOnly: 0, supervaluOnly: 0, both: 0, neither: 0, supervaluOnlyFresh: 0, dunnesOnlyFresh: 0 };
for (const ms of byProduct.values()) {
  const d = ms.filter(m => m.store === 'dunnes' && hasSku(m)), s = ms.filter(m => m.store === 'supervalu' && hasSku(m));
  if (d.length && s.length) pool.both++; else if (d.length) { pool.dunnesOnly++; if (d.some(mfresh)) pool.dunnesOnlyFresh++; }
  else if (s.length) { pool.supervaluOnly++; if (s.some(mfresh)) pool.supervaluOnlyFresh++; } else pool.neither++;
}
const urlSkuMismatch = mappings.filter(m => hasSku(m) && m.store_url && !new RegExp(`(?:/|-id-)${m.store_sku}$`).test(decodeURIComponent(new URL(m.store_url).pathname)))
  .map(m => ({ store: m.store, sku: m.store_sku, title: m.store_product_name, url: m.store_url, canonical: pname.get(m.product_id), fresh: mfresh(m) }));
const skuOwners = new Map<string, number>();
for (const m of mappings) if (hasSku(m)) skuOwners.set(`${m.store}:${m.store_sku}`, (skuOwners.get(`${m.store}:${m.store_sku}`) ?? 0) + 1);
const duplicateOwnedSkus = [...skuOwners].filter(([, n]) => n > 1).map(([k, n]) => ({ sku: k, owners: n }));

const summary = {
  missingMappingsAndDefects: { skulessPlaceholderMappings: { dunnes: mappings.filter(m => m.store === 'dunnes' && !hasSku(m)).length,
      supervalu: mappings.filter(m => m.store === 'supervalu' && !hasSku(m)).length },
    canonicalsByRetailerSkuCoverage: pool, candidatePairsExcludedForPlaceholderSide: placeholderPairs,
    urlSkuMismatch: { count: urlSkuMismatch.length, byStore: count(urlSkuMismatch, r => String(r.store)), freshPriced: urlSkuMismatch.filter(r => r.fresh).length },
    duplicateOwnedSkus: duplicateOwnedSkus.length },
  asOf, readWindow: { startedAt: manifest.startedAt, finishedAt: manifest.finishedAt, atomic: false },
  inputCounts: { dunnesMappings: mappings.filter(m => m.store === 'dunnes').length, supervaluMappings: mappings.filter(m => m.store === 'supervalu').length,
    withSku: { dunnes: mappings.filter(m => m.store === 'dunnes' && m.store_sku).length, supervalu: mappings.filter(m => m.store === 'supervalu' && m.store_sku).length },
    freshTrusted: { dunnes: mappings.filter(m => m.store === 'dunnes' && mfresh(m)).length, supervalu: mappings.filter(m => m.store === 'supervalu' && mfresh(m)).length },
    canonicalProducts: products.length, retainedResponsesLatest: snapshot.retailerResponses.length },
  reconciliationOf743: { dunnesSkusSharingCanonicalWithFreshSupervaluPrice: sharedWithFreshSv, dunnesSkusSharingCanonicalWithAnySupervaluSku: sharedAny },
  existingAssociationPairs: { total: assoc.length, byCategory: count(assoc, r => String(r.category)),
    byCategoryBothFresh: count(assoc.filter(r => r.bothFresh), r => String(r.category)) },
  exactCounterparts: { total: exact.length, byRelation: count(exact, r => String(r.relation)),
    bothFreshByRelation: count(exact.filter(r => r.bothFresh), r => String(r.relation)),
    notBothFreshByRelation: count(exact.filter(r => !r.bothFresh), r => String(r.relation)) },
  candidatePairs: { total: cand.length, byRelation: count(cand, r => String(r.relation)),
    wordingOnlyByRelation: count(cand.filter(r => r.wordingOnly), r => String(r.relation)),
    wordingOnlyBothFreshByRelation: count(cand.filter(r => r.wordingOnly && r.bothFresh), r => String(r.relation)),
    withBothGtins: cand.filter(r => r.bothHaveGtin).length,
    topOtherBlockers: Object.entries(count(cand.flatMap(r => (r.otherBlockers as string[]).map(b => ({ b })) as Row[]), r => String(r.b))).sort((a, b) => b[1] - a[1]).slice(0, 8) },
  gtinCoverage,
  inferencePriority: { eligibleWordingOnly: wo.length, bothFresh: wo.filter(r => r.bothFresh).length, bothFreshOneToOne: priority.filter(x => x.r.bothFresh && x.oneToOne).length },
  capturePilot: { eligiblePool: pilotPool.length, selected: pilot.length },
  evidenceTiers: { deterministicRecordedExactPairs: exact.length,
    ledgerQualifyingPairs: exact.filter(r => r.ledgerQualifying).length,
    captured_product_responses: snapshot.retailerResponses.filter((r: any) => r.source_kind === 'captured_product').length,
    captured_listing_responses: snapshot.retailerResponses.filter((r: any) => r.source_kind === 'captured_listing').length,
    approvedLedgerRows: L('retailer_offer_pair_reviews').length,
    note: 'evaluator "independently captured" tier counts hashed captured_listing rows; the protected ledger does not accept them' },
  evaluator: { perStore: (report.summary as any).perStore, evaluatedPairs: report.summary.evaluatedPairs, exactPairMethods: {
      barcode: report.summary.exactBarcodePairs, deterministic: report.summary.exactDeterministicPairs },
    inferenceCandidatePairs: report.summary.inferenceCandidatePairs, ambiguousMultipleSkuRecords: report.summary.ambiguousMultipleSkuRecords,
    brandReviewQueueLength: report.brandReviewQueue.length, reasonCounts: report.summary.reasonCounts },
};
const digest = createHash('sha256').update(JSON.stringify({ summary: summary.inputCounts, e: exact.map(e => [e.dunnesSku, e.supervaluSku]) })).digest('hex').slice(0, 16);
const out = `${outRoot}/pair-${digest}`;
mkdirSync(out, { recursive: true, mode: 0o700 });
const w = (n: string, v: unknown) => writeFileSync(`${out}/${n}`, JSON.stringify(v, null, 1), { mode: 0o600 });
w('summary.json', summary); w('existing-associations.json', assoc); w('exact-counterparts.json', exact);
w('inference-candidates.json', cand);
w('inference-priority.json', priority.map(x => x.r.pairId));
w('inference-priority-detail.json', priority.slice(0, 40).map(x => ({ ...x.r, oneToOne: x.oneToOne, wordDifference: x.d })));
w('capture-pilot.json', { pool: pilotPool.length, pilot });
w('report.json', report); // full evaluator output: input for scripts/branded-intersection-infer.ts in an authorised runtime
w('brand-review-queue.json', report.brandReviewQueue); w('url-sku-mismatch.json', urlSkuMismatch);
console.log(JSON.stringify({ out, ...summary }, null, 1));
