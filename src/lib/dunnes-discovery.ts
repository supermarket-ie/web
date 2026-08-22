const STORE_ID = 258;
const API_BASE = 'https://storefrontgateway.dunnesstoresgrocery.com/api';
const SITE_URL = 'https://www.dunnesstoresgrocery.com';

export type DunnesDiscoveryCandidate = {
  sku: string | null;
  name: string;
  price: number | null;
  url: string | null;
  queries: string[];
  score: number;
  brandMatch: boolean;
  packMatch: boolean;
  productSignalMatch: boolean;
  canonicalPack: PackSignature;
  candidatePack: PackSignature;
};

export type DunnesDiscoveryResult = {
  queryVariants: string[];
  candidates: DunnesDiscoveryCandidate[];
  best: DunnesDiscoveryCandidate | null;
  accepted: boolean;
};

type RawCandidate = {
  sku: string | null;
  name: string;
  price: number | null;
  url: string | null;
};

export type PackSignature = {
  amount: number | null;
  unit: 'g' | 'ml' | null;
  count: number | null;
};

function plain(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function normaliseDunnesName(value: string) {
  return plain(value).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function toBaseAmount(qty: number, unit: string): { amount: number; unit: 'g' | 'ml' } {
  const u = unit.toLowerCase();
  if (u === 'kg') return { amount: qty * 1000, unit: 'g' };
  if (u === 'g') return { amount: qty, unit: 'g' };
  if (u === 'l') return { amount: qty * 1000, unit: 'ml' };
  if (u === 'cl') return { amount: qty * 10, unit: 'ml' };
  return { amount: qty, unit: 'ml' };
}

export function dunnesPackSignature(value: string): PackSignature {
  const raw = plain(value).replace(/,/g, '.').replace(/×/g, 'x');

  const multi = raw.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/i);
  if (multi) {
    const base = toBaseAmount(Number(multi[2]), multi[3]);
    return { amount: base.amount, unit: base.unit, count: Number(multi[1]) };
  }

  const countMatch = raw.match(/\b(\d+)\s*(?:pack|pk|rolls?|pieces?|tabs?|tablets?|capsules?|wipes?|bags?|sachets?|boxes?|cans?|bottles?)\b/i);
  const amountMatch = raw.match(/\b(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/i);
  const base = amountMatch ? toBaseAmount(Number(amountMatch[1]), amountMatch[2]) : null;

  return {
    amount: base?.amount ?? null,
    unit: base?.unit ?? null,
    count: countMatch ? Number(countMatch[1]) : null,
  };
}

function sizeText(value: string) {
  const raw = plain(value).replace(/,/g, '.').replace(/×/g, 'x');
  const multi = raw.match(/\b\d+\s*x\s*\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl)\b/i);
  if (multi) return multi[0];
  const count = raw.match(/\b\d+\s*(?:pack|pk|rolls?|pieces?|tabs?|tablets?|capsules?|wipes?|bags?|sachets?|boxes?|cans?|bottles?)\b/i);
  const amount = raw.match(/\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl)\b/i);
  return [count?.[0], amount?.[0]].filter(Boolean).join(' ').trim();
}

export function isDunnesPackCompatible(canonical: string, candidate: string) {
  const expected = dunnesPackSignature(canonical);
  const actual = dunnesPackSignature(candidate);

  if (expected.amount !== null) {
    if (actual.amount === null || expected.unit !== actual.unit) return false;
    if (Math.max(expected.amount, actual.amount) / Math.min(expected.amount, actual.amount) > 1.1) return false;
  }
  if (expected.count !== null) {
    if (actual.count === null || expected.count !== actual.count) return false;
  }
  return true;
}

const GENERIC = new Set([
  'the','and','with','original','fresh','irish','pack','bottle','aerosol','spray','product',
  'free','good','selected','selection','large','small','medium','standard','premium',
]);

function words(value: string) {
  return normaliseDunnesName(value)
    .replace(/\b\d+(?:\s+\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack)?\b/g,' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !GENERIC.has(w));
}

function nameScore(expected: string, candidate: string) {
  const expectedWords = words(expected);
  const candidateWords = words(candidate);
  const candidateNorm = normaliseDunnesName(candidate);
  const expectedNorm = normaliseDunnesName(expected);
  if (!expectedWords.length || !candidateWords.length) return 0;
  if (expectedNorm === candidateNorm) return 1;
  const expectedCoverage = expectedWords.filter(w => candidateNorm.includes(w)).length / expectedWords.length;
  const candidateCoverage = candidateWords.filter(w => expectedNorm.includes(w)).length / candidateWords.length;
  return expectedCoverage * 0.75 + candidateCoverage * 0.25;
}

function brandMatches(brand: string, candidate: string) {
  const brandNorm = normaliseDunnesName(brand);
  const candidateNorm = normaliseDunnesName(candidate);
  if (brandNorm && candidateNorm.includes(brandNorm)) return true;

  const tokens = brandNorm
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => w.length >= 4 || (w.length >= 3 && /\d/.test(w)));
  return tokens.some(w => candidateNorm.includes(w));
}

function productSignalMatches(canonicalName: string, candidate: string) {
  const productWords = words(canonicalName);
  if (!productWords.length) return false;
  const candidateNorm = normaliseDunnesName(candidate);
  const matched = productWords.filter(w => candidateNorm.includes(w)).length;
  return matched / productWords.length >= 0.6;
}

function coreTerms(canonicalName: string, brand: string) {
  const brandWords = new Set(words(brand));
  return words(canonicalName).filter(w => !brandWords.has(w)).slice(0, 5).join(' ');
}

function queryVariants(canonicalName: string, brand: string) {
  const canonicalNorm = normaliseDunnesName(canonicalName);
  const brandNorm = normaliseDunnesName(brand);
  const enriched = canonicalNorm.includes(brandNorm) ? canonicalName : `${brand} ${canonicalName}`;
  const core = coreTerms(canonicalName, brand);
  const pack = sizeText(canonicalName);
  return [...new Set([
    enriched,
    core ? `${brand} ${core}` : brand,
    core && pack ? `${brand} ${core} ${pack}` : '',
    canonicalName,
  ].map(v => v.trim()).filter(Boolean))];
}

function makeProductUrl(candidate: { sku: string | null; name: string }) {
  if (!candidate.sku || !candidate.name) return null;
  const slug = candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${SITE_URL}/sm/delivery/rsid/${STORE_ID}/product/details/${encodeURIComponent(slug)}/${candidate.sku}`;
}

async function searchDunnes(query: string): Promise<RawCandidate[]> {
  const trimmed = query.split(' ').slice(0, 8).join(' ').slice(0, 90);
  const url = `${API_BASE}/stores/${STORE_ID}/search?q=${encodeURIComponent(trimmed)}&take=12&page=1&skip=0`;
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
      'x-site-host': SITE_URL,
      'x-site-location': 'HeadersBuilderInterceptor',
      'x-correlation-id': crypto.randomUUID(),
      'x-shopping-mode': '22222222-2222-2222-2222-222222222222',
    },
  });
  if (!response.ok) return [];

  const body = await response.json() as {
    items?: Array<{ sku?: string | number | null; name?: string | null; priceNumeric?: number | null }>;
  };

  return (body.items ?? []).map(item => {
    const candidate = {
      sku: item.sku == null ? null : String(item.sku),
      name: item.name ?? '',
      price: typeof item.priceNumeric === 'number' ? item.priceNumeric : null,
      url: null as string | null,
    };
    candidate.url = makeProductUrl(candidate);
    return candidate;
  });
}

export async function discoverDunnesProduct(canonicalName: string, brand: string): Promise<DunnesDiscoveryResult> {
  const variants = queryVariants(canonicalName, brand);
  const byKey = new Map<string, RawCandidate & { queries: string[] }>();

  for (const query of variants) {
    const candidates = await searchDunnes(query);
    for (const candidate of candidates) {
      const key = candidate.sku || `${normaliseDunnesName(candidate.name)}:${candidate.price ?? ''}`;
      const existing = byKey.get(key);
      if (existing) existing.queries.push(query);
      else byKey.set(key, { ...candidate, queries: [query] });
    }
  }

  const expected = normaliseDunnesName(canonicalName).includes(normaliseDunnesName(brand))
    ? canonicalName
    : `${brand} ${canonicalName}`;

  const ranked: DunnesDiscoveryCandidate[] = [...byKey.values()].map(candidate => ({
    ...candidate,
    score: nameScore(expected, candidate.name),
    brandMatch: brandMatches(brand, candidate.name),
    packMatch: isDunnesPackCompatible(canonicalName, candidate.name),
    productSignalMatch: productSignalMatches(canonicalName, candidate.name),
    canonicalPack: dunnesPackSignature(canonicalName),
    candidatePack: dunnesPackSignature(candidate.name),
  })).sort((a, b) => b.score - a.score);

  const best = ranked[0] ?? null;
  const accepted = Boolean(
    best && best.sku && best.price && best.price > 0 && best.brandMatch && best.packMatch && best.productSignalMatch && best.score >= 0.72
  );

  return { queryVariants: variants, candidates: ranked, best, accepted };
}
