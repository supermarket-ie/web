import { z } from 'zod';
import { brandFor, normalise, type BrandRule, type Evidence } from './branded-product-identity';

// Import these versioned, reviewed claims from Supabase. Retailer metadata and
// model suggestions feed the queue; neither alone changes brand eligibility.
export const brandClaimSchema = z.object({
  id: z.string().min(1), name: z.string().min(2), aliases: z.array(z.string().min(2)),
  owner: z.string().min(2).nullable(),
  kind: z.enum(['manufacturer_brand', 'retailer_private_label', 'retailer_exclusive_manufacturer', 'unresolved']),
  source: z.string().url(), sourceSummary: z.string().min(15),
  sourceKind: z.enum(['manufacturer_portfolio', 'manufacturer_brand_site', 'retailer_ownership_statement', 'gtin_licensee']),
  checkedAt: z.string().date(), reviewedBy: z.string().min(1),
  status: z.enum(['proposed', 'approved', 'rejected']),
});
export type BrandClaim = z.infer<typeof brandClaimSchema>;
export const eligibleBrand = (rule: BrandRule | undefined) => rule?.kind === 'manufacturer_brand' || rule?.kind === 'retailer_exclusive_manufacturer';
export function rulesFromClaims(base: BrandRule[], claims: BrandClaim[], asOf: string): BrandRule[] {
  const rules = base.map(r => ({ ...r, aliases: [...r.aliases] }));
  const accepted = claims.filter(c => c.status === 'approved' && c.kind !== 'unresolved' && (c.kind === 'retailer_private_label' || c.owner)
    && Date.parse(c.checkedAt) <= Date.parse(asOf) && Date.parse(c.checkedAt) > Date.parse(asOf) - 365 * 86400000);
  const byName = new Map<string, BrandClaim[]>();
  for (const c of accepted) byName.set(normalise(c.name), [...(byName.get(normalise(c.name)) ?? []), c]);
  for (const [name, rows] of byName) {
    // Contradictory approved claims hold this brand out; no last-writer wins.
    if (new Set(rows.map(c => JSON.stringify([c.owner,c.kind]))).size !== 1) {
      const i = rules.findIndex(r => normalise(r.name) === name); if (i >= 0) rules.splice(i,1); continue;
    }
    const c = [...rows].sort((a,b) => b.checkedAt.localeCompare(a.checkedAt))[0];
    const i = rules.findIndex(r => normalise(r.name) === name);
    if (i >= 0 && rules[i].kind !== c.kind) { rules.splice(i,1); continue; }
    const rule: BrandRule = { name:c.name, aliases:[...new Set([...(i>=0?rules[i].aliases:[]),...rows.flatMap(x=>x.aliases)])], owner:c.owner,
      kind:c.kind as BrandRule['kind'], source:c.source, checkedAt:c.checkedAt };
    if(i>=0)rules[i]=rule;else rules.push(rule);
  }
  // Alias collisions across brands are ambiguous, not a prefix tie-break.
  const owners=new Map<string,Set<string>>();
  for(const r of rules)for(const a of [r.name,...r.aliases]){const k=normalise(a);owners.set(k,new Set([...(owners.get(k)??[]),r.name]));}
  return rules.filter(r=>owners.get(normalise(r.name))!.size===1).map(r=>({...r,aliases:r.aliases.filter(a=>owners.get(normalise(a))!.size===1)}));
}
export function brandReviewQueue(records: Evidence[], rules: BrandRule[]) {
  const unknown=records.filter(r=>!brandFor(r,rules).rule), groups=new Map<string,Evidence[]>();
  for(const r of unknown){const label=normalise(r.brand??'')||normalise(r.title).split(' ').slice(0,2).join(' ');groups.set(label,[...(groups.get(label)??[]),r]);}
  return [...groups].map(([label,rs])=>({label,classification:'unresolved',identities:rs.length,
    retailers:[...new Set(rs.map(r=>r.store))].sort(),evidenceIds:rs.map(r=>r.id),examples:rs.slice(0,4).map(r=>({title:r.title,brand:r.brand,url:r.url})),
    nextAction:'Obtain manufacturer portfolio/brand ownership or authoritative GTIN-licensee evidence; review a versioned claim.'}))
    .sort((a,b)=>b.retailers.length-a.retailers.length||b.identities-a.identities||a.label.localeCompare(b.label));
}
