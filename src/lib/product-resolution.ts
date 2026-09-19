export type ResolutionStore = 'supervalu' | 'dunnes';

export type ResolutionQueueRow = {
  failure_id: string;
  store: ResolutionStore;
  canonical_name: string;
  store_product_name: string;
  store_sku: string | null;
  store_url: string | null;
  failure_reason: string;
  raw_error: string | null;
  demand_units: number;
  demand_rank: number | null;
  created_at: string;
};

export type ResolutionCandidate = {
  sku: string;
  name: string;
  price: number;
  url: string;
};

export type ResolutionClassification =
  | 'exact_candidate_available'
  | 'poor_or_malformed_canonical_data'
  | 'retailer_search_query_failure'
  | 'variant_size_or_pack_mismatch'
  | 'genuine_retailer_absence'
  | 'insufficient_evidence';

type Measure = { amount: number; unit: 'g' | 'ml' };

const FILLER = new Set([
  'and', 'the', 'with', 'fresh', 'irish', 'store', 'stores', 'supervalu', 'dunnes',
  'original', 'standard', 'selected', 'selection', 'premium', 'family', 'value',
  'pack', 'packet', 'bottle', 'box', 'piece', 'pieces',
]);

const VARIANT_GROUPS = [
  ['salted', 'unsalted'], ['smooth', 'crunchy'], ['regular', 'zero', 'diet'],
  ['white', 'wholemeal', 'wholegrain'], ['fresh', 'frozen'], ['organic', 'standard'],
  ['gluten', 'glutenfree'], ['red', 'white'], ['smoked', 'unsmoked'],
];

function plain(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function singular(word: string) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ches|shes|xes|zes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function resolutionTerms(value: string) {
  return plain(value)
    .replace(/\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack|rolls?|pieces?|boxes?)?\b/g, ' ')
    .split(/\s+/).map(singular)
    .filter((word) => word.length > 2 && !FILLER.has(word));
}

function measure(value: string): Measure | null {
  const match = plain(value).match(/\b(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/);
  if (!match) return null;
  let amount = Number(match[1]);
  let unit = match[2] as 'g' | 'kg' | 'ml' | 'l' | 'cl';
  if (unit === 'kg') { amount *= 1000; unit = 'g'; }
  if (unit === 'l') { amount *= 1000; unit = 'ml'; }
  if (unit === 'cl') { amount *= 10; unit = 'ml'; }
  return { amount, unit };
}

function packCount(value: string) {
  const text = plain(value);
  const explicit = text.match(/\b(\d+)\s*(?:x|pack|pk|rolls?|pieces?|boxes?|cans?|bottles?)\b/);
  if (explicit) return Number(explicit[1]);
  const leading = text.match(/\b(\d+)\s+(?:(?:[a-z0-9'-]+)\s+){0,4}(?:pizzas?|pittas?|dish\s+cloths?|rashers?|bars?|breads?)\b/);
  return leading ? Number(leading[1]) : null;
}

function variantConflict(expected: string, candidate: string) {
  const a = new Set(plain(expected).split(' '));
  const b = new Set(plain(candidate).split(' '));
  return VARIANT_GROUPS.some((group) => {
    const left = group.filter((term) => a.has(term));
    const right = group.filter((term) => b.has(term));
    return (left.length > 0 || right.length > 0)
      && (left.length !== right.length || left.some((term) => !right.includes(term)));
  });
}

function measuresAgree(expected: string, candidate: string) {
  const a = measure(expected);
  const b = measure(candidate);
  if (a && (!b || a.unit !== b.unit || a.amount !== b.amount)) return false;
  const expectedPack = packCount(expected);
  const candidatePack = packCount(candidate);
  return expectedPack === candidatePack;
}

export function isStrictExactResolution(row: ResolutionQueueRow, candidate: ResolutionCandidate) {
  if (!row.store_sku || candidate.sku !== row.store_sku) return false;
  if (!measuresAgree(row.canonical_name, candidate.name) || variantConflict(row.canonical_name, candidate.name)) return false;
  const expected = resolutionTerms(row.canonical_name);
  const actualTerms = resolutionTerms(candidate.name);
  const actual = new Set(actualTerms);
  const overlap = expected.filter((term) => actual.has(term));
  const storedIdentityExact = plain(row.store_product_name) === plain(candidate.name);
  if (
    expected.length < 2
    || overlap.length !== expected.length
    || (!storedIdentityExact && overlap.length / actualTerms.length < 0.6)
  ) return false;

  // The stored retailer title is corroborating evidence, never a substitute for
  // canonical identity. Require at least one meaningful stored-title signal.
  const stored = resolutionTerms(row.store_product_name);
  return stored.length > 0 && stored.some((term) => actual.has(term));
}

function candidateUrl(store: ResolutionStore, sku: string, name: string) {
  const slug = plain(name).replace(/\s+/g, '-');
  return store === 'dunnes'
    ? `https://www.dunnesstoresgrocery.com/sm/delivery/rsid/258/product/details/${slug}/${sku}`
    : `https://shop.supervalu.ie/sm/delivery/rsid/5550/product/${slug}-id-${sku}`;
}

export function parseResolutionCandidates(row: ResolutionQueueRow): ResolutionCandidate[] {
  const candidates: ResolutionCandidate[] = [];
  const seen = new Set<string>();
  const pattern = /(?:^|[=|]\s*)([a-zA-Z0-9_-]+):([^|]+?):€(\d+(?:\.\d+)?)/g;
  for (const match of (row.raw_error ?? '').matchAll(pattern)) {
    const sku = match[1];
    const name = match[2].trim();
    const price = Number(match[3]);
    if (sku === 'no-sku' || !name || !Number.isFinite(price) || price <= 0 || seen.has(sku)) continue;
    seen.add(sku);
    candidates.push({ sku, name, price, url: candidateUrl(row.store, sku, name) });
  }
  return candidates;
}

export function classifyResolution(row: ResolutionQueueRow, candidates = parseResolutionCandidates(row)):
  { classification: ResolutionClassification; exactCandidates: ResolutionCandidate[] } {
  const exactCandidates = candidates.filter((candidate) => isStrictExactResolution(row, candidate));
  if (exactCandidates.length === 1) return { classification: 'exact_candidate_available', exactCandidates };

  const canonicalTerms = resolutionTerms(row.canonical_name);
  if (candidates.length === 0) return {
    classification: 'retailer_search_query_failure',
    exactCandidates: [],
  };

  const hasRelatedCandidate = candidates.some((candidate) => {
    const terms = new Set(resolutionTerms(candidate.name));
    return canonicalTerms.filter((term) => terms.has(term)).length >= Math.min(2, canonicalTerms.length);
  });
  if (hasRelatedCandidate && candidates.every((candidate) =>
    !measuresAgree(row.canonical_name, candidate.name) || variantConflict(row.canonical_name, candidate.name))) {
    return { classification: 'variant_size_or_pack_mismatch', exactCandidates: [] };
  }
  if (canonicalTerms.length < 2) return { classification: 'poor_or_malformed_canonical_data', exactCandidates: [] };

  // A latest-run failure is never enough evidence to assert retailer absence.
  return { classification: 'insufficient_evidence', exactCandidates: [] };
}
