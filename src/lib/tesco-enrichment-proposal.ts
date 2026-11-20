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

export type Offer = { store: 'tesco' | 'dunnes' | 'supervalu' | 'aldi' | 'lidl'; role: 'proposed' | 'current' | 'peer' | 'other'; sku: string | null;
  name: string; brand: string | null; gtin?: string | null; url?: string | null; observedAt?: string | null };
export type CanonicalRecord = { id: string; name: string; brand: string | null; ean: string | null };
export type ProductKey = { brand: string | null; pack: string | null; variant: string };
// substantiated : Tesco + >=1 independent offer agree; NO attached offer conflicts.
// split_ready   : the core identity is substantiated AND every conflicting
//                 attached offer is a complete product (brand + pack stated), so
//                 the record can be split into exact products with evidence.
// needs_split   : attached offers are different products but the core identity
//                 is not substantiated (or a conflict is incomplete).
export type EnrichmentStatus = 'substantiated' | 'split_ready' | 'needs_split' | 'insufficient_evidence' | 'contradicted';
export type EnrichmentProposal = {
  canonicalId: string; status: EnrichmentStatus; reasons: string[];
  current: { name: string; brand: string | null; ean: string | null };
  proposed: { name: string; brand: string; pack: string; variant: string } | null;
  supportingSources: Array<{ store: string; role: string; name: string; brand: string | null; sku: string | null }>;
  splitInto?: Array<ProductKey & { complete?: boolean; sources: string[] }>;
  // Every attached customer-visible offer and how it relates to the Tesco item.
  offerVerdicts?: Array<{ store: string; role: string; sku: string | null; name: string; brand: string | null; brandSource: 'structured' | 'title' | 'none';
    verdict: 'agrees' | 'conflicts' | 'silent'; conflicts: string[] }>;
  detachForReview?: Array<{ store: string; sku: string | null; name: string }>;
};

// Brand: the structured field, else the longest known brand that the title
// starts with (retailer titles often state the brand when the field is blank).
let LEXICON: string[] = [];
export function setBrandLexicon(brands: Iterable<string>) {
  LEXICON = [...new Set([...brands].map(b => b.trim()).filter(b => normalized(b).length >= 2))]
    .sort((a, b) => normalized(b).length - normalized(a).length);
}
const OWN_LABEL = ['Tesco Finest', 'Tesco', 'Dunnes Stores', 'Simply Better', 'SuperValu Signature Tastes', 'SuperValu', 'Daily Basics'];
export function titleBrand(name: string): string | null {
  const t = ` ${normalized(name)} `;
  for (const b of [...OWN_LABEL, ...LEXICON]) { const n = normalized(b); if (n && t.startsWith(` ${n} `)) return b; }
  return null;
}
const brandWithSource = (o: Offer): { brand: string | null; source: 'structured' | 'title' | 'none' } => {
  if (o.brand && o.brand.trim()) return { brand: o.brand.trim(), source: 'structured' };
  const t = titleBrand(o.name);
  return t ? { brand: t, source: 'title' } : { brand: null, source: 'none' };
};
const brandOf = (o: Offer) => brandWithSource(o).brand;
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
  // Check EVERY attached customer-visible offer (Tesco current offers too)
  // against the Tesco item. Only Dunnes/SuperValu may substantiate; any offer
  // may conflict (it is shown to customers as an exact comparison today).
  const tk = keyOf(tesco);
  const conflictsOf = (o: Offer): string[] => {
    const k = keyOf(o); const out: string[] = [];
    if (k.brand && tk.brand && !sameBrand(k.brand, tk.brand)) out.push(`brand(${k.brand} vs ${tk.brand})`);
    if (k.pack && tk.pack && k.pack !== tk.pack) out.push(`pack(${k.pack} vs ${tk.pack})`);
    if (canonicalVariantConflict(tesco.name, o.name)) out.push('variant_qualifier');
    else if (k.brand && tk.brand && sameBrand(k.brand, tk.brand) && k.pack === tk.pack && !variantsAgree(tesco, o, canonical.name, tk.brand)
      && words(variantOf(o.name, k.brand)).size > 0) out.push('variant_words');
    return out;
  };
  // ALL attached offers, any retailer (Aldi/Lidl too): none may stay attached
  // to a now-specific record unless it agrees.
  const attached = offers.filter(o => o !== tesco)
    .filter(o => { const k = `${o.store}|${o.sku ?? o.name}`; if (seen.has(`a|${k}`)) return false; seen.add(`a|${k}`); return true; });
  const verdicts = attached.map(o => {
    const c = conflictsOf(o);
    const agrees = !c.length && (o.store === 'dunnes' || o.store === 'supervalu') && !!brandOf(o) && sameProduct(tesco, o)
      && variantsAgree(tesco, o, canonical.name, tk.brand);
    return { o, verdict: (c.length ? 'conflicts' : agrees ? 'agrees' : 'silent') as 'agrees' | 'conflicts' | 'silent', conflicts: c };
  });
  const offerVerdicts = verdicts.map(v => ({ store: v.o.store, role: v.o.role, sku: v.o.sku, name: v.o.name,
    brand: brandOf(v.o), brandSource: brandWithSource(v.o).source, verdict: v.verdict, conflicts: v.conflicts }));
  const independent = verdicts.filter(v => v.verdict === 'agrees').map(v => v.o);
  const conflicting = verdicts.filter(v => v.verdict === 'conflicts').map(v => v.o);
  const silent = verdicts.filter(v => v.verdict === 'silent' && v.o.role === 'peer').map(v => v.o);
  const reasons: string[] = [];
  if (canonical.brand && tk.brand && !sameBrand(canonical.brand, tk.brand)) reasons.push(`canonical_brand_contradicts(${canonical.brand} vs ${tk.brand})`);
  const cp = packLabel(declaredPack(canonical.name).total);
  if (cp && tk.pack && cp !== tk.pack) reasons.push(`canonical_pack_contradicts(${cp} vs ${tk.pack})`);
  if (canonicalVariantConflict(canonical.name, tesco.name)) reasons.push('canonical_variant_contradicts');
  const complete = (o: Offer) => { const k = keyOf(o); return !!k.pack && !!k.brand; };
  const groups: Offer[][] = [[tesco, ...independent]];
  for (const o of conflicting) { const g = groups.slice(1).find(x => sameProduct(x[0], o) && variantsAgree(x[0], o, canonical.name, brandOf(x[0]))); if (g) g.push(o); else groups.push([o]); }
  const splitInto = groups.map(g => ({ ...keyOf(g[0]), complete: !!keyOf(g[0]).brand && !!keyOf(g[0]).pack,
    sources: g.map(o => `${o.store}:${o.role}:${o.sku ?? o.name}`) }));
  const coreOk = independent.length > 0 && !!tk.brand && !!tk.pack && !reasons.length;
  if (conflicting.length) {
    // Every conflict is an explicit contradiction (brand, pack or variant), so
    // each conflicting offer is demonstrably a different product and can be
    // detached. Completeness only decides whether its NEW canonical record is
    // itself exact (brand + pack) or must stay generic pending evidence.
    const ready = coreOk;
    return { ...base, status: ready ? 'split_ready' : 'needs_split',
      reasons: [...reasons, `attached_offers_are_${groups.length}_different_products`,
        ...(!coreOk ? ['core_identity_not_substantiated'] : []),
        ...(conflicting.some(o => !complete(o)) ? ['a_split_out_product_lacks_brand_or_pack'] : [])],
      proposed: ready ? coreProposal() : null, splitInto, offerVerdicts,
      detachForReview: silent.map(o => ({ store: o.store, sku: o.sku, name: o.name })),
      supportingSources: [tesco, ...independent].map(o => ({ store: o.store, role: o.role, name: o.name, brand: brandOf(o), sku: o.sku })) };
  }
  function coreProposal() {
    const agreed = new Set(independent.flatMap(o => [...words(variantOf(o.name, tk.brand))]));
    const variant = variantOf(tesco!.name, tk.brand).split(/\s+/).filter(w => agreed.has(normalized(w))).join(' ');
    const brand = tk.brand!.replace(/\b([A-Z])([A-Z']+)\b/g, (_: string, x: string, y: string) => x + y.toLowerCase());
    return { name: `${brand} ${variant} ${tk.pack}`.replace(/\s+/g, ' ').trim(), brand, pack: tk.pack!, variant };
  }
  if (reasons.length) return { ...base, status: 'contradicted', reasons, proposed: null, offerVerdicts };
  if (!independent.length) return { ...base, status: 'insufficient_evidence', offerVerdicts,
    reasons: [peers.length ? `no_independent_retailer_confirms(${offerVerdicts.filter(v => v.role === 'peer').map(v => `${v.store}:${v.verdict}`).join(',')})` : 'no_independent_retailer_offer'], proposed: null };
  if (!tk.brand || !tk.pack) return { ...base, status: 'insufficient_evidence', reasons: [!tk.brand ? 'brand_unstated' : 'pack_unstated'], proposed: null, offerVerdicts };
  return { ...base, status: 'substantiated', reasons: [], proposed: coreProposal(), offerVerdicts,
    detachForReview: silent.map(o => ({ store: o.store, sku: o.sku, name: o.name })),
    supportingSources: [tesco, ...independent].map(o => ({ store: o.store, role: o.role, name: o.name, brand: brandOf(o), sku: o.sku })) };
}
