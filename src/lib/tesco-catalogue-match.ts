// Match canonical products to Tesco Ireland catalogue items. Pure; grants no trust.
//   barcode_exact   : ONE catalogue SKU carries the canonical EAN or a Dunnes/
//                     SuperValu peer GTIN, with no variant/pack conflict. This is
//                     the only class counted as a VERIFIED link here.
//   peer_candidate  : no barcode, but brand + stated pack + title + variant agree
//                     with the canonical AND with BOTH fresh peers independently.
//                     Still needs the AI verified_exact verdict before it is a link.
//   barcode_conflict: a barcode hit whose title/pack contradicts the canonical (held).
//   ambiguous       : more than one SKU qualifies (shared/ambiguous queue).
// Relation to the current Tesco mapping decides the next step: confirms_mapping
// (refresh), replacement (guarded repair), new_link (needs a mapping), shared
// (SKU already owned by another canonical).
import { canonicalVariantConflict, declaredPack, normalized, sameBarcode, sameBrand, titleSupport } from './tesco-hold-reentry';

export type CatalogueItem = { sku: string; gtin: string | null; name: string; brand: string | null; url: string;
  department: string | null; superDepartment: string | null; price: number | null };
export type Canonical = { id: string; name: string; brand: string | null; ean: string | null };
export type Peer = { store: 'dunnes' | 'supervalu'; name: string; brand: string | null; gtin: string | null };
export type TescoMapping = { id: string; sku: string | null };
export type MatchKind = 'barcode_exact' | 'peer_candidate' | 'barcode_conflict' | 'ambiguous' | 'no_match';
export type Relation = 'confirms_mapping' | 'replacement' | 'new_link' | 'shared' | 'none';
export type MatchResult = { productId: string; kind: MatchKind; relation: Relation; sku: string | null; skus: string[]; reasons: string[] };

const code = (g: string | null | undefined) => (g && /^\d{8,14}$/.test(g) ? g.replace(/^0+/, '') : null);

export function indexCatalogue(items: CatalogueItem[]) {
  const byGtin = new Map<string, CatalogueItem[]>(); const byBrand = new Map<string, CatalogueItem[]>();
  for (const it of items) {
    const c = code(it.gtin); if (c) byGtin.set(c, [...(byGtin.get(c) ?? []), it]);
    const b = normalized(it.brand).replaceAll(' ', ''); if (b) byBrand.set(b, [...(byBrand.get(b) ?? []), it]);
  }
  return { byGtin, byBrand };
}

function packConflict(a: string, b: string) {
  const x = declaredPack(a), y = declaredPack(b);
  return (x.total != null && y.total != null && x.total !== y.total)
    || (x.countExplicit && y.countExplicit && x.units !== y.units);
}

function relationFor(sku: string, mappings: TescoMapping[], owners: Map<string, string>, productId: string): Relation {
  const owner = owners.get(sku);
  if (owner && owner !== productId) return 'shared';
  if (mappings.some(m => m.sku === sku)) return 'confirms_mapping';
  return mappings.length ? 'replacement' : 'new_link';
}

export function matchCanonical(c: Canonical, peers: Peer[], mappings: TescoMapping[],
  idx: ReturnType<typeof indexCatalogue>, skuOwner: Map<string, string>): MatchResult {
  const codes = new Set([c.ean, ...peers.map(p => p.gtin)].map(code).filter((x): x is string => !!x));
  const hits = new Map<string, CatalogueItem>();
  for (const k of codes) for (const it of idx.byGtin.get(k) ?? []) hits.set(it.sku, it);
  if (hits.size) {
    const clean = [...hits.values()].filter(it => !canonicalVariantConflict(c.name, it.name) && !packConflict(c.name, it.name));
    if (clean.length === 1) {
      const it = clean[0];
      return { productId: c.id, kind: 'barcode_exact', relation: relationFor(it.sku, mappings, skuOwner, c.id), sku: it.sku, skus: [it.sku], reasons: [] };
    }
    if (clean.length > 1) return { productId: c.id, kind: 'ambiguous', relation: 'none', sku: null, skus: clean.map(x => x.sku), reasons: ['multiple_barcode_skus'] };
    return { productId: c.id, kind: 'barcode_conflict', relation: 'none', sku: null, skus: [...hits.keys()], reasons: ['barcode_hit_contradicts_canonical'] };
  }
  // No barcode: brand + stated pack + title must agree with the canonical AND with
  // BOTH peers (one per store) independently. AI still required afterwards.
  const stores = new Set(peers.map(p => p.store));
  const brand = c.brand ?? (peers.find(p => p.brand)?.brand ?? null);
  if (!brand || stores.size < 2 || declaredPack(c.name).total == null) {
    return { productId: c.id, kind: 'no_match', relation: 'none', sku: null, skus: [], reasons: [!brand ? 'no_brand' : stores.size < 2 ? 'peers_lt_2' : 'canonical_pack_unknown'] };
  }
  const pool = idx.byBrand.get(normalized(brand).replaceAll(' ', '')) ?? [];
  const ok = pool.filter(it => it.brand && sameBrand(brand, it.brand)
    && declaredPack(it.name).total === declaredPack(c.name).total
    && titleSupport(c.name, it.name) && !canonicalVariantConflict(c.name, it.name)
    && peers.every(p => declaredPack(p.name).total === declaredPack(it.name).total
      && titleSupport(it.name, p.name) && !canonicalVariantConflict(it.name, p.name)
      && (p.gtin == null || sameBarcode(p.gtin, it.gtin))));
  if (ok.length === 1) return { productId: c.id, kind: 'peer_candidate', relation: relationFor(ok[0].sku, mappings, skuOwner, c.id), sku: ok[0].sku, skus: [ok[0].sku], reasons: [] };
  if (ok.length > 1) return { productId: c.id, kind: 'ambiguous', relation: 'none', sku: null, skus: ok.map(x => x.sku), reasons: ['multiple_peer_candidates'] };
  return { productId: c.id, kind: 'no_match', relation: 'none', sku: null, skus: [], reasons: ['no_catalogue_candidate'] };
}
