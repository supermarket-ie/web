import { brandClaimSchema, rulesFromClaims, eligibleBrand, brandReviewQueue } from './branded-brand-claims';
import { evidenceFromResponse, type IdentityResponse } from './retailer-identity-response';
import { z } from 'zod';
import { digest } from './tesco-discovery';
import { BRAND_RULES, BRAND_REGISTRY_VERSION } from './branded-brand-registry';
import { gateInference, type Corroboration, type InferenceResult } from './branded-inference';
import { brandFor, compare, identityWords, normalise, parsePack, safeProductUrl, supported,
  IDENTITY_VERSION, type BrandRule, type Evidence, type Store, type Decision } from './branded-product-identity';

const text = z.string(), nullable = text.nullable();
const mappingSchema = z.object({ id: text, product_id: text, store: z.enum(['tesco','supervalu','dunnes']),
  store_product_name: nullable, brand: nullable, is_own_brand: z.boolean(), store_sku: nullable,
  store_url: nullable, url_status: nullable, url_last_checked_at: nullable, gtin: nullable,
  price: z.number().nullable(), observed_at: nullable, price_source: nullable,
  receipt_at: nullable, receipt_outcome: nullable, receipt_run_id: nullable, receipt_method: nullable });
const productSchema = z.object({ id: text, canonical_name: text, brand: nullable, category: nullable,
  description: nullable, ingredients: nullable, image_url: nullable, ean: nullable,
  default_quantity:z.union([z.number(),text]).nullable().optional(),default_unit:nullable.optional() });
// Optional normalized captures from an independently acquired retailer response.
// This intake performs no network request and cannot change production mappings.
const captureSchema=z.object({store:z.enum(['tesco','supervalu','dunnes']),sku:text,url:text,title:text,brand:nullable,gtin:nullable,
  quantity:z.object({grams:z.number().optional(),millilitres:z.number().optional(),pieces:z.number().optional()}).nullable().optional(),
  description:nullable.optional(),ingredients:nullable.optional(),imageUrl:nullable.optional(),manufacturer:nullable.optional(),dimensions:nullable.optional(),
  source:z.object({kind:z.literal('captured_product'),ref:text,at:text.datetime(),url:text,hash:text.regex(/^[a-f0-9]{64}$/)})});
const snapshotSchema = z.object({ asOf: text.datetime(), products: z.array(productSchema), mappings: z.array(mappingSchema),
  retailerEvidence:z.array(captureSchema).optional(),
  brandClaims:z.array(brandClaimSchema).optional(),
  retailerResponses:z.array(z.object({id:text,store:z.enum(['supervalu','dunnes']),sku:text,product_url:text,
    requested_url:text,final_url:text,retrieved_at:text,content_type:text,body_text:text,body_sha256:text,parser_version:text,
    source_kind:z.enum(['captured_product','captured_listing']),source_path:text,identity:z.record(text,z.unknown())})).optional(),
  tesco: z.array(z.object({ product: z.object({ sku: text, url: text, name: text, brand: nullable, gtin: nullable,
    quantity: z.object({ grams: z.number().optional(), millilitres: z.number().optional(), pieces: z.number().optional() }).nullable() }),
    page_id: text, created_at: text, body_sha256: text, requested_url: text, final_url: nullable, mode: text })),
  failures: z.array(z.object({ id: text, store_product_id: text, failure_reason: text, created_at: text, raw_error: nullable })).default([]),
  demand: z.array(z.object({ name: text, units: z.number() })),
  attempts: z.array(z.object({ requested_url: text, unresolved: z.boolean(), last_attempt: text })),
  gates: z.array(z.object({ egress_key: text, enabled: z.boolean(), cooldown_until: nullable, leased_until: nullable })),
  renewal: z.object({ due: z.number(), firstDue: nullable, firstExpiry: nullable }) });
export type Snapshot = z.infer<typeof snapshotSchema>;
type Mapping = Snapshot['mappings'][number];
export const STORES: Store[] = ['tesco','supervalu','dunnes'];
const key = (store: Store, sku: string) => `${store}:${sku}`;
const fresh = (at: string | null, now: string, days: number) => at !== null && Number.isFinite(Date.parse(at))
  && Date.parse(at) <= Date.parse(now) && Date.parse(at) > Date.parse(now) - days * 86400000;
function recordsFrom(input: Snapshot): Evidence[] {
  const groups = new Map<string, Mapping[]>();
  for (const m of input.mappings) {
    const id = key(m.store,m.store_sku || `missing-${m.id}`);
    groups.set(id,[...(groups.get(id) ?? []),m]);
  }
  const records = new Map<string, Evidence>();
  for (const [id, mappings] of groups) {
    const ordered = [...mappings].sort((a,b) => (Date.parse(b.receipt_at ?? '') || 0) - (Date.parse(a.receipt_at ?? '') || 0) || a.id.localeCompare(b.id));
    const m = ordered[0];
    const direct = m.receipt_outcome === 'success' && ((m.store === 'supervalu' && m.receipt_method === 'vercel_direct_product_page')
      || (m.store === 'dunnes' && m.receipt_method === 'vercel_queue_dunnes_api_resolved_first'));
    records.set(id, { id, store:m.store, sku:m.store_sku ?? '', url:m.store_url ?? '', title:m.store_product_name ?? '',
      brand:m.brand, gtin:m.gtin, source:{ kind:direct ? 'refresh_attested' : 'stored_mapping', ref:m.receipt_run_id ?? m.id,
        at: direct ? m.receipt_at : m.url_last_checked_at, url:m.store_url },
      lastLiveVerifiedAt: direct && m.store === 'supervalu' ? m.receipt_at : null,
      mappingIds:mappings.map(x=>x.id).sort(), canonicalIds:[...new Set(mappings.map(x=>x.product_id))].sort(),
      conflicts:mappings.length > 1 ? ['duplicate_sku_ownership_requires_review'] : [] });
  }
  const bySku = new Map<string, Snapshot['tesco']>();
  for (const t of input.tesco) bySku.set(t.product.sku,[...(bySku.get(t.product.sku) ?? []),t]);
  for (const [sku, rows] of bySku) {
    rows.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||a.page_id.localeCompare(b.page_id));
    const t=rows[0], p=t.product, id=key('tesco',sku), mapped=records.get(id);
    const conflicts=[...(mapped?.conflicts ?? [])];
    if (rows.some(x=>x.created_at===t.created_at && digest(x.product)!==digest(p))) conflicts.push('equal_time_evidence_conflict');
    const direct=t.mode==='products' && t.requested_url===p.url && t.final_url===p.url;
    if (t.mode==='products' && !direct) conflicts.push('product_provenance_conflict');
    records.set(id,{ id,store:'tesco',sku,url:p.url,title:p.name,brand:p.brand,gtin:p.gtin,quantity:p.quantity,
      source:{kind:direct ? 'captured_product':'captured_listing',ref:t.page_id,at:t.created_at,url:t.requested_url,hash:t.body_sha256,archiveRef:`tesco_direct_collection_pages:${t.page_id}`},
      mappingIds:mapped?.mappingIds ?? [],canonicalIds:mapped?.canonicalIds ?? [],conflicts,
      lastLiveVerifiedAt:direct ? t.created_at : null });
  }
  for(const e of [...(input.retailerEvidence??[])].sort((a,b)=>a.source.at.localeCompare(b.source.at)||a.source.ref.localeCompare(b.source.ref))){
    const id=key(e.store,e.sku),previous=records.get(id),conflicts=[...(previous?.conflicts??[])];
    if(previous&&Date.parse(e.source.at)<Date.parse(previous.source.at??''))continue;
    if(e.source.url!==e.url)conflicts.push('product_provenance_conflict');
    if(previous&&e.source.at===previous.source.at&&(e.title!==previous.title||e.url!==previous.url||e.gtin!==previous.gtin))conflicts.push('equal_time_evidence_conflict');
    records.set(id,{...e,id,conflicts,mappingIds:previous?.mappingIds??[],canonicalIds:previous?.canonicalIds??[],lastLiveVerifiedAt:e.source.at});
  }
  for(const row of [...(input.retailerResponses??[])].sort((a,b)=>a.retrieved_at.localeCompare(b.retrieved_at)||a.id.localeCompare(b.id))){
    const e=evidenceFromResponse(row as IdentityResponse & {id:string}); if(!e)continue;
    const id=key(e.store,e.sku),previous=records.get(id);
    if(previous && Date.parse(e.source.at!)<Date.parse(previous.source.at??''))continue;
    const conflicts=[...(previous?.conflicts??[])];
    if(previous&&e.source.at===previous.source.at&&(e.title!==previous.title||e.url!==previous.url||e.gtin!==previous.gtin))conflicts.push('equal_time_evidence_conflict');
    records.set(id,{...e,id,conflicts,mappingIds:previous?.mappingIds??[],canonicalIds:previous?.canonicalIds??[]});
  }
  return [...records.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export type Pair = { id: string; left: string; right: string; result: Decision };
export type InferenceProposal = {left:string;right:string;evidenceDigest:string;result:InferenceResult;corroboration:Corroboration[]};
export function evaluate(raw: unknown, rules: BrandRule[]=BRAND_RULES, proposals:InferenceProposal[]=[]) {
  const input=snapshotSchema.parse(raw); rules=rulesFromClaims(rules,input.brandClaims??[],input.asOf);
  const records=recordsFrom(input), byId=new Map(records.map(r=>[r.id,r]));
  const brands=new Map(records.map(r=>[r.id,brandFor(r,rules)]));
  const national=records.filter(r=>eligibleBrand(brands.get(r.id)!.rule));
  const byBrand=new Map<string,Evidence[]>();
  for (const r of national) { const b=brands.get(r.id)!.rule!.name; byBrand.set(b,[...(byBrand.get(b)??[]),r]); }
  const pairs:Pair[]=[], pairMap=new Map<string,Pair>();
  const pairKey=(a:string,b:string)=>[a,b].sort().join('|');
  function pair(a:Evidence,b:Evidence) {
    const id=pairKey(a.id,b.id); const prior=pairMap.get(id);if(prior)return prior;
    let result=compare(a,b,rules,input.asOf);
    const proposal=proposals.find(x=>pairKey(x.left,x.right)===id&&x.evidenceDigest===digest([a,b].sort((x,y)=>x.id.localeCompare(y.id))));
    if(proposal&&result.decision==='insufficient_evidence') {
      const gated=gateInference(a,b,proposal.result,rules,input.asOf,proposal.corroboration);
      if(gated.accepted)result={...result,decision:'exact_match',method:'llm_corroborated',reasons:gated.reasons,missing:[]};
    }
    const p={id,left:a.id,right:b.id,result}; pairs.push(p);pairMap.set(id,p);return p;
  }
  // Blocking by verified brand + shared identity token, not by the canonical
  // association. No candidate truncation can turn ambiguity into acceptance.
  for (const group of byBrand.values()) {
    const index=new Map<string,Evidence[]>();
    for (const r of group) for (const w of [...identityWords(r,brands.get(r.id)!.titleAlias),...(r.gtin?[`gtin:${r.gtin.replace(/^0+/,'')}`]:[])]) {
      index.set(w,[...(index.get(w)??[]),r]);
    }
    for (const a of group) {
      const pool=new Set<Evidence>();
      for (const w of [...identityWords(a,brands.get(a.id)!.titleAlias),...(a.gtin?[`gtin:${a.gtin.replace(/^0+/,'')}`]:[])]) for(const b of index.get(w)??[]) if(b.store!==a.store && b.id>a.id)pool.add(b);
      for(const b of pool)pair(a,b);
    }
  }
  const exactNeighbors=new Map<string,Set<string>>();
  for(const p of pairs)if(p.result.decision==='exact_match') {
    if(!exactNeighbors.has(p.left))exactNeighbors.set(p.left,new Set()); exactNeighbors.get(p.left)!.add(p.right);
    if(!exactNeighbors.has(p.right))exactNeighbors.set(p.right,new Set()); exactNeighbors.get(p.right)!.add(p.left);
  }
  const duplicateExact=new Set<string>();
  for(const [id,neighbors] of exactNeighbors)for(const store of STORES)if([...neighbors].filter(n=>byId.get(n)!.store===store).length>1)duplicateExact.add(id);
  const triples: {ids:string[]; pairs:Pair[]}[]=[];
  for(const t of national.filter(r=>r.store==='tesco')) {
    const neighbors=[...(exactNeighbors.get(t.id)??[])].map(id=>byId.get(id)!);
    for(const s of neighbors.filter(r=>r.store==='supervalu'))for(const d of neighbors.filter(r=>r.store==='dunnes')){
      const ps=[pair(t,s),pair(t,d),pair(s,d)];
      if(ps.every(p=>p.result.decision==='exact_match') && ![t,s,d].some(r=>duplicateExact.has(r.id)))triples.push({ids:[t.id,s.id,d.id],pairs:ps});
    }
  }
  const mappings=new Map(input.mappings.map(m=>[m.id,m])), products=new Map(input.products.map(p=>[p.id,p]));
  const demands=new Map(input.demand.map(d=>[normalise(d.name),d.units]));
  function retailer(r:Evidence, canonicalId:string|null) {
    const ms=r.mappingIds.map(id=>mappings.get(id)!).filter(Boolean);
    const m=canonicalId ? ms.find(x=>x.product_id===canonicalId) : ms.length===1?ms[0]:undefined;
    const goodMapping=Boolean(m && m.url_status==='resolved' && m.store_sku===r.sku && m.store_url===r.url && !r.conflicts.length);
    const hasPrice=Boolean(goodMapping && m?.price && m.price>0 && fresh(m.observed_at,input.asOf,7));
    const attempted=input.attempts.find(a=>a.requested_url===r.url);
    const holds:string[]=[];
    if(!goodMapping)holds.push('mapping_repair_or_assignment_required');
    if(attempted?.unresolved)holds.push('unknown_request_hold');
    // Reuse existing runner eligibility; this report never authorises a retry.
    if(r.store==='tesco' && attempted && !hasPrice)holds.push('supervised_runner_preflight_required');
    if(r.store==='tesco' && input.renewal.due>0)holds.push('renewal_priority');
    if(r.store==='tesco' && input.gates.some(g=>(g.leased_until && Date.parse(g.leased_until)>Date.parse(input.asOf)) || (g.cooldown_until && Date.parse(g.cooldown_until)>Date.parse(input.asOf))))holds.push('operational_gate_preflight_required');
    return {evidenceId:r.id,sku:r.sku,url:r.url,title:r.title,gtin:r.gtin,brand:r.brand,pack:parsePack(r.title,r.quantity,r.source.kind==='captured_product'),
      evidence:r.source,urlVerification:'stored_only_this_run' as const,lastLiveVerifiedAt:r.lastLiveVerifiedAt,
      hasCurrentTrustedPrice:hasPrice,price:hasPrice?m!.price:null,priceObservedAt:hasPrice?m!.observed_at:null,
      currentMappingId:m?.id??null,mappingRepairRequired:!goodMapping||!canonicalId,collectionReady:!hasPrice&&goodMapping&&Boolean(canonicalId)&&!holds.length,
      conflicts:[...r.conflicts,...holds]};
  }
  const intersection=triples.map(t=>{
    const rs=t.ids.map(id=>byId.get(id)!), common=rs[0].canonicalIds.filter(id=>rs.every(r=>r.canonicalIds.includes(id)));
    const canonicalId=common.length===1?common[0]:null, canonical=canonicalId?products.get(canonicalId):undefined;
    const brand=brands.get(rs[0].id)!.rule!;
    const retailers=Object.fromEntries(rs.map(r=>[r.store,retailer(r,canonicalId)])) as Record<Store,ReturnType<typeof retailer>>;
    const missingPrices=STORES.filter(s=>!retailers[s].hasCurrentTrustedPrice);
    const independentlyCaptured=rs.every(r=>Boolean(r.source.archiveRef)&&r.source.kind.startsWith('captured_'));
    return {id:digest(t.ids),category:independentlyCaptured?'A' as const:'B' as const,canonicalProductId:canonicalId,canonicalName:canonical?.canonical_name??null,
      name:rs[0].title,normalisedName:normalise(rs[0].title),brand:brand.name,manufacturer:brand.owner,brandEvidence:brand,
      pack:parsePack(rs[0].title,rs[0].quantity,rs[0].source.kind==='captured_product'),
      decision:t.pairs.some(p=>p.result.method==='llm_corroborated')?'llm_corroborated':t.pairs.some(p=>p.result.method==='barcode')?'barcode':'deterministic',
      verificationStatus:independentlyCaptured?'exact_independently_captured_identity':'exact_recorded_identity_pending_independent_capture',rawEvidenceAtAllThree:independentlyCaptured,
      requiredCorroboration:independentlyCaptured?[]:rs.filter(r=>!(r.source.archiveRef&&r.source.kind.startsWith('captured_'))).map(r=>`${r.store}:independent_product_response_or_sku_bound_gtin`),
      immediatelyCollectionReady:independentlyCaptured&&missingPrices.length>0&&missingPrices.every(s=>retailers[s].collectionReady),
      retailers,missingPrices,mappingRepairRequired:STORES.some(s=>retailers[s].mappingRepairRequired),
      demand:canonical?demands.get(normalise(canonical.canonical_name))??0:0};
  });
  // Audit every original association separately; it never seeds acceptance.
  const associations=input.products.map(p=>{
    const ms=input.mappings.filter(m=>m.product_id===p.id), rs=ms.map(m=>byId.get(key(m.store,m.store_sku||`missing-${m.id}`))!).filter(Boolean);
    const known=intersection.find(t=>t.canonicalProductId===p.id);
    if(known)return {productId:p.id,name:p.canonical_name,category:known.category,reasons:known.requiredCorroboration,retailers:rs.map(r=>retailer(r,p.id))};
    const ps=rs.flatMap((a,i)=>rs.slice(i+1).map(b=>pair(a,b)));
    const reasons=[...new Set(ps.flatMap(q=>q.result.reasons))];
    const own=rs.some(r=>brands.get(r.id)!.rule?.kind==='retailer_private_label');
    const allBranded=rs.length===3&&rs.every(r=>eligibleBrand(brands.get(r.id)!.rule));
    const badUrl=rs.some(r=>!safeProductUrl(r)), conflicts=ps.some(q=>q.result.contradictions.length);
    const category=own?'excluded_private_label':badUrl?'D':conflicts?'C':allBranded&&ps.every(q=>q.result.plausible&&q.result.samePack)?'B':'E';
    return {productId:p.id,name:p.canonical_name,category,reasons,retailers:rs.map(r=>retailer(r,p.id))};
  });
  // New cross-canonical candidates are also retained, so the review queue does
  // not inherit the old catalogue's associations.
  const candidates=pairs.filter(p=>p.result.decision==='insufficient_evidence'&&p.result.plausible&&p.result.samePack&&!p.result.contradictions.length);
  const opportunities=intersection.filter(x=>x.missingPrices.length).sort((a,b)=>a.missingPrices.length-b.missingPrices.length||b.demand-a.demand||a.name.localeCompare(b.name));
  const reasonCounts:Record<string,number>={};for(const a of associations)for(const r of a.reasons)reasonCounts[r]=(reasonCounts[r]??0)+1;
  const perStore=Object.fromEntries(STORES.map(store=>[store,{uniqueRetailerIdentities:records.filter(r=>r.store===store).length,
    recognisedManufacturerBrandIdentities:national.filter(r=>r.store===store&&safeProductUrl(r)).length,
    supportedManufacturerBrandIdentities:national.filter(r=>r.store===store&&supported(r,input.asOf)).length,
    excludedPrivateLabelIdentities:records.filter(r=>r.store===store&&brands.get(r.id)!.rule?.kind==='retailer_private_label').length,
    retailerExclusiveManufacturerIdentities:records.filter(r=>r.store===store&&brands.get(r.id)!.rule?.kind==='retailer_exclusive_manufacturer').length,
    unknownBrandIdentities:records.filter(r=>r.store===store&&!brands.get(r.id)!.rule).length}]));
  const visited=new Set<string>();let twoGroups=0;
  const exactGroups:Record<string,unknown>[]=[];
  for(const start of exactNeighbors.keys()){
    if(visited.has(start))continue;const component:string[]=[],queue=[start];
    while(queue.length){const id=queue.pop()!;if(visited.has(id))continue;visited.add(id);component.push(id);queue.push(...(exactNeighbors.get(id)??[]));}
    const rs=component.map(id=>byId.get(id)!);
    if(rs.length>=2&&new Set(rs.map(r=>r.store)).size===rs.length&&rs.every((a,i)=>rs.slice(i+1).every(b=>pair(a,b).result.decision==='exact_match'))){
      twoGroups++;
      const common=rs[0].canonicalIds.filter(id=>rs.every(r=>r.canonicalIds.includes(id))),canonicalId=common.length===1?common[0]:null;
      const brand=brands.get(rs[0].id)!.rule!,retailers=Object.fromEntries(rs.map(r=>[r.store,retailer(r,canonicalId)]));
      exactGroups.push({id:digest(component.sort()),name:rs[0].title,brand:brand.name,manufacturer:brand.owner,
        normalisedIdentity:identityWords(rs[0],brands.get(rs[0].id)!.titleAlias),pack:parsePack(rs[0].title,rs[0].quantity,rs[0].source.kind==='captured_product'),
        canonicalProductId:canonicalId,verificationStatus:rs.every(r=>r.source.archiveRef)?'independently_captured_at_present_retailers':'provisional_recorded_identity',
        missingRetailerIdentities:STORES.filter(s=>!retailers[s]),missingFreshPrices:STORES.filter(s=>!retailers[s]?.hasCurrentTrustedPrice),
        mappingRepairRequired:!canonicalId||Object.values(retailers).some(r=>r.mappingRepairRequired),retailers});
    }
  }
  return {version:IDENTITY_VERSION,brandRegistryVersion:BRAND_REGISTRY_VERSION,brandRegistryDigest:digest(rules),asOf:input.asOf,inputDigest:digest({input,proposals}),
    summary:{canonicalProducts:input.products.length,mappingRows:input.mappings.length,retailerRecords:records.length,perStore,
      evaluatedPairs:pairs.length,recordedExactAnyTwoIdentityGroups:twoGroups,recordedExactThree:intersection.length,
      independentlyVerifiedThree:intersection.filter(t=>t.rawEvidenceAtAllThree).length,
      rawEvidenceThree:intersection.filter(t=>t.rawEvidenceAtAllThree).length,
      recordedThreeFreshPrices:intersection.filter(t=>!t.missingPrices.length).length,
      independentlyVerifiedThreeFreshPrices:intersection.filter(t=>t.rawEvidenceAtAllThree&&!t.missingPrices.length).length,
      missingOnly:Object.fromEntries(STORES.map(s=>[s,intersection.filter(t=>t.missingPrices.length===1&&t.missingPrices[0]===s).length])),
      mappingRepairs:intersection.filter(t=>t.mappingRepairRequired).length,
      categories:Object.fromEntries(['A','B','C','D','E','excluded_private_label'].map(c=>[c,associations.filter(a=>a.category===c).length])),
      recordedExactAssociations:intersection.filter(t=>t.canonicalProductId).length,
      strongCandidateAssociationsExcludingRecordedExact:associations.filter(a=>a.category==='B'&&!intersection.some(t=>t.canonicalProductId===a.productId)).length,
      inferenceCandidatePairs:candidates.length,ambiguousMultipleSkuRecords:duplicateExact.size,
      exactBarcodePairs:pairs.filter(p=>p.result.method==='barcode').length,exactDeterministicPairs:pairs.filter(p=>p.result.method==='deterministic').length,
      llmCorroboratedPairs:pairs.filter(p=>p.result.method==='llm_corroborated').length,
      actualModelCallsThisEvaluation:0,actualModelCostUsdThisEvaluation:0,liveInferenceStatus:proposals.length?'external_proposals_replayed_no_calls':'not_run_offline_evaluation',reasonCounts,
      renewal:input.renewal,unresolvedRequests:input.attempts.filter(a=>a.unresolved).length},
    exactGroups,brandRules:rules,brandReviewQueue:brandReviewQueue(records,rules),intersection,opportunities,associations,records,pairs,candidates,canonicalMetadata:input.products,
    limitations:['Known stored catalogue only; no estimate of full retailer assortment.',
      'Refresh-attested peer titles are retained retailer output; original peer response bodies/GTIN are unavailable.',
      'Identity evidence ceiling is 14 days; trusted prices retain the existing seven-day policy.',
      'No retailer URL was fetched during this offline run. Stored evidence cannot prove current availability.',
      'Unknown brand ownership and conflicting or ambiguous pack evidence remain unresolved.']};
}
