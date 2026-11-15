// READ-ONLY canonical enrichment proposal. Pure: decides what brand, variant
// and pack can be SUBSTANTIATED for a canonical product from retailer evidence,
// and whether a generic canonical record covers several products and must be
// split before it can support exact comparisons. Proposes; never writes.
//
// Substantiation rule: a value is substantiated only when the Tesco catalogue
// item AND at least one INDEPENDENT retailer offer (Dunnes or SuperValu) agree
// on it. Tesco-only evidence (including a Tesco-sourced canonical EAN) is never
// enough on its own. The current canonical record must not contradict it.
import { canonicalVariantConflict, declaredPack, normalized, sameBrand, titleSupport } from './tesco-hold-reentry';

export type Offer = { store: 'tesco' | 'dunnes' | 'supervalu'; role: 'proposed' | 'current' | 'peer'; sku: string | null;
  name: string; brand: string | null; gtin?: string | null; url?: string | null; observedAt?: string | null };
export type CanonicalRecord = { id: string; name: string; brand: string | null; ean: string | null };
export type ProductKey = { brand: string | null; pack: string | null; variant: string };
export type EnrichmentStatus = 'substantiated' | 'needs_split' | 'insufficient_evidence' | 'contradicted';
export type EnrichmentProposal = {
  canonicalId: string; status: EnrichmentStatus; reasons: string[];
  current: { name: string; brand: string | null; ean: string | null };
  proposed: { name: string; brand: string; pack: string; variant: string } | null;
  supportingSources: Array<{ store: string; role: string; name: string; brand: string | null; sku: string | null }>;
  splitInto?: Array<ProductKey & { sources: string[] }>;
};

const brandOf = (o: Offer) => {
  if (o.brand && !/^(?:tesco|dunnes(?: stores)?|supervalu)$/i.test(o.brand.trim())) return o.brand.trim();
  return o.brand?.trim() ?? null;
};
const packLabel = (total: string | null) => {
  if (!total) return null;
  const [u, v] = total.split(':'); const n = Number(v);
  return u === 'g' ? (n >= 1000 && n % 1000 === 0 ? `${n / 1000}kg` : `${n}g`) : u === 'ml' ? (n >= 1000 && n % 1000 === 0 ? `${n / 1000}L` : `${n}ml`) : `${n}`;
};
// Variant: the title words that are not the brand or the pack.
export function variantOf(name: string, brand: string | null) {
  let s = ` ${name} `;
  if (brand) s = s.replace(new RegExp(`\\s${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'i'), ' ');
  s = s.replace(/\b\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|litres?)\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|litres?)\b/gi, ' ').replace(/\(\s*\)/g, ' ')
    .replace(/\b(?:tesco|dunnes stores|supervalu)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return s;
}
// Words that describe packaging or provenance, not product identity.
const DESCRIPTORS = new Set(['the', 'and', 'with', 'of', 'in', 'a', 'jar', 'tin', 'can', 'bottle', 'pack', 'tub', 'pot', 'box', 'bag',
  'carton', 'original', 'classic', 'traditional', 'irish', 'fresh', 'loose', 'each']);
const words = (s: string) => new Set(normalized(s).split(' ').filter(w => w.length > 1 && !/^\d/.test(w) && !DESCRIPTORS.has(w)));
// Symmetric: every significant variant word of each title is explained by the
// other title or the canonical name. "Barista" vs "No Sugars" fails.
export function variantsAgree(a: Offer, b: Offer, canonicalName: string, brand: string | null) {
  const wa = words(variantOf(a.name, brand)), wb = words(variantOf(b.name, brand)), wc = words(canonicalName);
  return wa.size > 0 && wb.size > 0 && [...wa].every(w => wb.has(w) || wc.has(w)) && [...wb].every(w => wa.has(w) || wc.has(w));
}
const keyOf = (o: Offer): ProductKey => ({ brand: brandOf(o), pack: packLabel(declaredPack(o.name).total), variant: variantOf(o.name, brandOf(o)) });
const sameProduct = (a: Offer, b: Offer) => {
  const ka = keyOf(a), kb = keyOf(b);
  const brandAgree = ka.brand && kb.brand ? sameBrand(ka.brand, kb.brand)
    : (` ${normalized(b.name)} `).includes(` ${normalized(ka.brand ?? '~')} `) || (` ${normalized(a.name)} `).includes(` ${normalized(kb.brand ?? '~')} `);
  return !!brandAgree && ka.pack != null && ka.pack === kb.pack
    && titleSupport(a.name, b.name) && !canonicalVariantConflict(a.name, b.name);
};

export function proposeEnrichment(canonical: CanonicalRecord, offers: Offer[]): EnrichmentProposal {
  const current = { name: canonical.name, brand: canonical.brand, ean: canonical.ean };
  const tesco = offers.find(o => o.store === 'tesco' && o.role === 'proposed');
  // Independent retailers for the owner's peer rule: Dunnes and SuperValu only.
  const seen = new Set<string>();
  const peers = offers.filter(o => o.role === 'peer' && (o.store === 'dunnes' || o.store === 'supervalu'))
    .filter(o => { const k = `${o.store}|${o.sku ?? o.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const base = { canonicalId: canonical.id, current, supportingSources: [] as EnrichmentProposal['supportingSources'] };
  if (!tesco) return { ...base, status: 'insufficient_evidence', reasons: ['no_tesco_catalogue_item'], proposed: null };
  // Classify each Dunnes/SuperValu offer against the Tesco item:
  //   agrees    - brand, stated pack, title and variant all agree
  //   conflicts - a STATED brand or pack differs, or the variant contradicts
  //   silent    - states too little to confirm or contradict (no pack/brand)
  // A conflicting offer that is itself a complete product (brand + pack stated)
  // means the canonical record covers more than one product -> split.
  const tk = keyOf(tesco);
  const classify = (o: Offer): 'agrees' | 'conflicts' | 'silent' => {
    const k = keyOf(o);
    const brandStated = !!k.brand || (!!tk.brand && (` ${normalized(o.name)} `).includes(` ${normalized(tk.brand)} `));
    const brandConflict = !!k.brand && !!tk.brand && !sameBrand(k.brand, tk.brand);
    const packConflict = !!k.pack && !!tk.pack && k.pack !== tk.pack;
    if (brandConflict || packConflict || canonicalVariantConflict(tesco.name, o.name)) return 'conflicts';
    return sameProduct(tesco, o) && brandStated && variantsAgree(tesco, o, canonical.name, tk.brand) ? 'agrees' : 'silent';
  };
  const judged = peers.map(o => ({ o, c: classify(o) }));
  const independent = judged.filter(x => x.c === 'agrees').map(x => x.o);
  const conflicting = judged.filter(x => x.c === 'conflicts').map(x => x.o);
  const reasons: string[] = [];
  if (canonical.brand && tk.brand && !sameBrand(canonical.brand, tk.brand)) reasons.push(`canonical_brand_contradicts(${canonical.brand} vs ${tk.brand})`);
  const cp = packLabel(declaredPack(canonical.name).total);
  if (cp && tk.pack && cp !== tk.pack) reasons.push(`canonical_pack_contradicts(${cp} vs ${tk.pack})`);
  if (canonicalVariantConflict(canonical.name, tesco.name)) reasons.push('canonical_variant_contradicts');
  const completeConflicts = conflicting.filter(o => { const k = keyOf(o); return !!k.pack && (!!k.brand || /^(dunnes|supervalu)/i.test(o.name)); });
  if (completeConflicts.length) {
    const groups: Offer[][] = [[tesco, ...independent]];
    for (const o of completeConflicts) { const g = groups.slice(1).find(x => sameProduct(x[0], o)); if (g) g.push(o); else groups.push([o]); }
    return { ...base, status: 'needs_split', reasons: [...reasons, `retailers_offer_${groups.length}_different_products`], proposed: null,
      splitInto: groups.map(g => ({ ...keyOf(g[0]), sources: g.map(o => `${o.store}:${o.role}:${o.sku ?? o.name}`) })),
      supportingSources: [tesco, ...peers].map(o => ({ store: o.store, role: o.role, name: o.name, brand: o.brand, sku: o.sku })) };
  }
  if (reasons.length) return { ...base, status: 'contradicted', reasons, proposed: null };
  if (!independent.length) return { ...base, status: 'insufficient_evidence',
    reasons: [peers.length ? `no_independent_retailer_confirms(${judged.map(x => `${x.o.store}:${x.c}`).join(',')})` : 'no_independent_retailer_offer'], proposed: null };
  if (!tk.brand || !tk.pack) return { ...base, status: 'insufficient_evidence', reasons: [!tk.brand ? 'brand_unstated' : 'pack_unstated'], proposed: null };
  // Name = brand + ONLY the variant words the Tesco item and an agreeing
  // independent offer share (Tesco order) + pack. Tesco-only words are dropped.
  const agreed = new Set(independent.flatMap(o => [...words(variantOf(o.name, tk.brand))]));
  const variant = variantOf(tesco.name, tk.brand).split(/\s+/).filter(w => agreed.has(normalized(w))).join(' ');
  const brand = tk.brand.replace(/\b([A-Z])([A-Z']+)\b/g, (_, a: string, b: string) => a + b.toLowerCase());
  return { ...base, status: 'substantiated', reasons: [],
    proposed: { name: `${brand} ${variant} ${tk.pack}`.replace(/\s+/g, ' ').trim(), brand, pack: tk.pack, variant },
    supportingSources: [tesco, ...independent].map(o => ({ store: o.store, role: o.role, name: o.name, brand: o.brand, sku: o.sku })) };
}
