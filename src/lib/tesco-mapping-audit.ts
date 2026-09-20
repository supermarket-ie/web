export type TescoAuditClassification =
  | 'exact_unique'
  | 'exact_synonym_duplicate'
  | 'material_mismatch'
  | 'obsolete_mapping'
  | 'exact_replacement_candidate'
  | 'ambiguous'
  | 'insufficient_evidence';

export type TescoMappingEvidence = {
  storeProductId: string;
  canonicalName: string;
  canonicalBrand?: string | null;
  storeProductName?: string | null;
  storeBrand?: string | null;
  isOwnBrand?: boolean | null;
  storeSku?: string | null;
  storeUrl?: string | null;
  duplicateSkuCount: number;
  duplicateCanonicalNames?: string[];
  isFresh: boolean;
  latestObservedAt?: string | null;
};

export type TescoCandidateEvidence = {
  sku: string;
  url: string;
  name: string;
  observedAt?: string | null;
  evidenceSource: string;
};

export type TescoIdentitySignals = {
  urlSkuConflict: boolean;
  brandConflict: boolean;
  productTypeConflict: boolean;
  variantConflict: boolean;
  measureConflict: boolean;
  packCountConflict: boolean;
  ownLabelConflict: boolean;
  freshFrozenConflict: boolean;
  formulationConflict: boolean;
  genericCanonical: boolean;
  canonicalTermsCovered: boolean;
};

export type TescoMappingAudit = {
  classification: TescoAuditClassification;
  signals: TescoIdentitySignals;
  reasons: string[];
};

const FILLER = new Set([
  'and', 'the', 'with', 'tesco', 'irish', 'fresh', 'selected', 'selection',
  'pack', 'packet', 'bottle', 'box', 'piece', 'pieces', 'grams', 'gram',
  'kilograms', 'kilogram', 'litres', 'litre', 'millilitres', 'millilitre',
]);

const PRODUCT_TYPES = [
  'bread', 'pitta', 'pepper', 'chilli', 'flour', 'sauce', 'beans', 'peas',
  'butter', 'milk', 'cheese', 'yogurt', 'crisps', 'cereal', 'biscuits',
  'chocolate', 'soup', 'rice', 'pasta', 'oil', 'vinegar', 'beetroot',
  'tuna', 'coffee', 'tea', 'juice', 'water', 'detergent', 'shampoo',
];

const VARIANT_GROUPS = [
  ['red', 'green', 'yellow', 'orange', 'white'],
  ['salted', 'unsalted'],
  ['smooth', 'crunchy'],
  ['plain', 'self raising', 'wholemeal'],
  ['mild', 'medium', 'hot'],
  ['mint', 'orange', 'biscoff', 'golden crisp', 'tiffin'],
  ['sliced', 'diced', 'whole'],
  ['smoked', 'unsmoked'],
];

const FORMULATION_GROUPS = [
  ['organic', 'non organic'],
  ['gluten free', 'standard'],
  ['no added sugar', 'standard'],
  ['sugar free', 'standard'],
  ['low fat', 'standard'],
];

function plain(value: string | null | undefined) {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&(?:amp;)?/g, ' and ')
    .replace(/\bkilograms?\b/g, 'kg').replace(/\bgrams?\b/g, 'g')
    .replace(/\blitres?\b/g, 'l').replace(/\bmillilitres?\b/g, 'ml')
    .replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function singular(word: string) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ches|shes|xes|zes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function terms(value: string | null | undefined) {
  return plain(value).replace(/\b\d+(?:\.\d+)?\s*(?:g|kg|ml|l|cl|x|pk|pack)?\b/g, ' ')
    .split(/\s+/).map(singular).filter(word => word.length > 2 && !FILLER.has(word));
}

function skuFromUrl(url: string | null | undefined) {
  return url?.match(/\/products\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
}

function measure(value: string | null | undefined) {
  const match = plain(value).match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/);
  if (!match) return null;
  let amount = Number(match[1]);
  let unit = match[2];
  if (unit === 'kg') { amount *= 1000; unit = 'g'; }
  if (unit === 'l') { amount *= 1000; unit = 'ml'; }
  if (unit === 'cl') { amount *= 10; unit = 'ml'; }
  return { amount, unit };
}

function packCount(value: string | null | undefined) {
  const text = plain(value);
  return Number(text.match(/\b(\d+)\s*(?:x|pack|pk|rolls?|pieces?|bars?|cans?|bottles?)\b/)?.[1] ?? 0) || null;
}

function sameMeasure(left: string | null | undefined, right: string | null | undefined) {
  const a = measure(left);
  const b = measure(right);
  if (!a && !b) return true;
  return Boolean(a && b && a.amount === b.amount && a.unit === b.unit);
}

function samePackCount(left: string | null | undefined, right: string | null | undefined) {
  return packCount(left) === packCount(right);
}

function differentExplicitGroup(left: string, right: string, groups: string[][]) {
  return groups.some(group => {
    const a = group.filter(term => left.includes(term));
    const b = group.filter(term => right.includes(term));
    return a.length > 0 && b.length > 0
      && (a.length !== b.length || a.some(term => !b.includes(term)));
  });
}

function oneSidedMaterialFormulation(left: string, right: string) {
  return ['organic', 'gluten free', 'no added sugar', 'sugar free', 'low fat']
    .some(term => left.includes(term) !== right.includes(term));
}

function addedStrongFlavour(left: string, right: string) {
  return ['orange', 'mint', 'biscoff', 'golden crisp', 'tiffin']
    .some(term => !left.includes(term) && right.includes(term));
}

function explicitProductType(value: string) {
  return PRODUCT_TYPES.filter(type => value.includes(type));
}

export function tescoIdentitySignals(mapping: TescoMappingEvidence, candidateName = mapping.storeProductName ?? ''): TescoIdentitySignals {
  const canonical = plain(mapping.canonicalName);
  const candidate = plain(candidateName);
  const canonicalMeasure = measure(mapping.canonicalName);
  const candidateMeasure = measure(candidateName);
  const canonicalPack = packCount(mapping.canonicalName);
  const candidatePack = packCount(candidateName);
  const expectedTypes = explicitProductType(canonical);
  const actualTypes = explicitProductType(candidate);
  const expectedTerms = terms(mapping.canonicalName);
  const actualTerms = new Set(terms(candidateName));
  const canonicalBrand = plain(mapping.canonicalBrand);
  const storeBrand = plain(mapping.storeBrand);
  const expectedOwnLabel = canonicalBrand === 'tesco';
  const candidateOwnLabel = candidate.startsWith('tesco ');

  return {
    urlSkuConflict: Boolean(mapping.storeSku && skuFromUrl(mapping.storeUrl) && skuFromUrl(mapping.storeUrl) !== mapping.storeSku),
    brandConflict: Boolean(canonicalBrand && !candidate.includes(canonicalBrand) && (!storeBrand || canonicalBrand !== storeBrand)),
    productTypeConflict: expectedTypes.length > 0 && actualTypes.length > 0 && !expectedTypes.some(type => actualTypes.includes(type)),
    variantConflict: differentExplicitGroup(canonical, candidate, VARIANT_GROUPS) || addedStrongFlavour(canonical, candidate),
    measureConflict: Boolean(canonicalMeasure && candidateMeasure && (canonicalMeasure.unit !== candidateMeasure.unit || canonicalMeasure.amount !== candidateMeasure.amount)),
    packCountConflict: Boolean(canonicalPack && candidatePack && canonicalPack !== candidatePack),
    ownLabelConflict: Boolean((expectedOwnLabel || mapping.isOwnBrand) !== candidateOwnLabel && (expectedOwnLabel || mapping.isOwnBrand || candidateOwnLabel)),
    freshFrozenConflict: /\bfresh\b/.test(canonical) !== /\bfresh\b/.test(candidate) && (/\bfrozen\b/.test(canonical) || /\bfrozen\b/.test(candidate)),
    formulationConflict: differentExplicitGroup(canonical, candidate, FORMULATION_GROUPS) || oneSidedMaterialFormulation(canonical, candidate),
    genericCanonical: expectedTerms.length < 2,
    canonicalTermsCovered: expectedTerms.length > 0 && expectedTerms.every(term => actualTerms.has(term)),
  };
}

function mismatchReasons(signals: TescoIdentitySignals) {
  return (Object.entries(signals) as [keyof TescoIdentitySignals, boolean][])
    .filter(([key, value]) => value && key.endsWith('Conflict')).map(([key]) => key);
}

export function classifyTescoMapping(mapping: TescoMappingEvidence): TescoMappingAudit {
  const signals = tescoIdentitySignals(mapping);
  const conflicts = mismatchReasons(signals);
  if (conflicts.length > 0) return { classification: 'material_mismatch', signals, reasons: conflicts };
  if (!mapping.storeSku || !mapping.storeUrl || !mapping.storeProductName) {
    return { classification: 'insufficient_evidence', signals, reasons: ['missing retailer identity evidence'] };
  }
  if (signals.genericCanonical) return { classification: 'ambiguous', signals, reasons: ['generic or underspecified canonical identity'] };
  if (!signals.canonicalTermsCovered) return { classification: 'ambiguous', signals, reasons: ['canonical and stored Tesco titles require review'] };
  if (mapping.duplicateSkuCount > 1) {
    const expected = [...new Set(terms(mapping.canonicalName))].sort().join('|');
    const peers = mapping.duplicateCanonicalNames ?? [];
    const groupIsCorroborated = peers.length === mapping.duplicateSkuCount
      && peers.every(name => [...new Set(terms(name))].sort().join('|') === expected);
    return groupIsCorroborated
      ? { classification: 'exact_synonym_duplicate', signals, reasons: ['duplicate SKU group has equivalent canonical identity'] }
      : { classification: 'ambiguous', signals, reasons: ['duplicate SKU group requires identity review'] };
  }
  if (!mapping.isFresh) return { classification: 'obsolete_mapping', signals, reasons: ['identity consistent but no current trusted observation'] };
  return { classification: 'exact_unique', signals, reasons: ['unique, internally consistent and current'] };
}

export function classifyTescoReplacement(mapping: TescoMappingEvidence, candidate: TescoCandidateEvidence): TescoMappingAudit {
  // Stored retailer brand/own-label fields describe the mapping being replaced,
  // not the expected identity. Replacement decisions derive those expectations
  // from the canonical product only.
  const expectedMapping = {
    ...mapping,
    storeBrand: null,
    isOwnBrand: plain(mapping.canonicalBrand) === 'tesco',
  };
  const signals = tescoIdentitySignals(expectedMapping, candidate.name);
  if (!plain(mapping.canonicalBrand)) signals.ownLabelConflict = false;
  const conflicts = mismatchReasons(signals);
  if (conflicts.length > 0) return { classification: 'material_mismatch', signals, reasons: conflicts };
  if (!candidate.sku || !skuFromUrl(candidate.url) || skuFromUrl(candidate.url) !== candidate.sku) {
    return { classification: 'insufficient_evidence', signals, reasons: ['candidate URL and SKU do not corroborate'] };
  }
  if (signals.genericCanonical || !signals.canonicalTermsCovered) {
    return { classification: 'ambiguous', signals, reasons: ['candidate does not establish full exact canonical identity'] };
  }
  const canonicalBrand = plain(mapping.canonicalBrand);
  if (canonicalBrand && !plain(candidate.name).includes(canonicalBrand)) {
    return { classification: 'material_mismatch', signals, reasons: ['brandExactnessFailed'] };
  }
  if (!sameMeasure(mapping.canonicalName, candidate.name)) {
    return { classification: 'material_mismatch', signals, reasons: ['measureExactnessFailed'] };
  }
  if (!samePackCount(mapping.canonicalName, candidate.name)) {
    return { classification: 'material_mismatch', signals, reasons: ['packExactnessFailed'] };
  }
  return { classification: 'exact_replacement_candidate', signals, reasons: ['candidate identity agrees on all material deterministic checks'] };
}
