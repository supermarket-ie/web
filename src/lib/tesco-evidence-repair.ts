import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { declaredPack, sameBrand, sameBarcode, titleSupport, canonicalVariantConflict, structuredMeasure } from './tesco-hold-reentry';
import type { TescoCollectedProduct } from './tesco-direct-collection-core';
import { SUPERVISED_GATE } from './tesco-supervised-collection';

type Canonical = { id:string; canonical_name:string; brand:string|null; ean:string|null };
type Offer = { id:string; store:string; product_id:string; store_sku:string|null; store_url:string|null;
  store_product_name:string; brand:string|null; gtin:string|null; url_status:string; [key:string]:unknown };
type Peer = { id:string; store:string; store_sku:string; store_product_name:string; brand:string|null;
  gtin:string|null; price:number; observed_at:string };
type Page = { id:string; requested_url:string; final_url:string; mode:string; outcome:string;
  http_status:number; body_sha256:string; product:TescoCollectedProduct|null; product_count:number; total_products:number; created_at:string };
export type RepairContext = { offer:Offer; canonical:Canonical; peers:Peer[]; hint:Page;
  proven:boolean; fresh:boolean; pending:boolean; recent:boolean; old_owners:number; target_owners:number; target_stopped:boolean };
export type ActivationContext = RepairContext & { audit:{ id:string; store_product_id:string; applied_action:string; applied_at:string;
  prior_mapping:{ original:RepairContext; target_sku:string; target_url:string; staged_offer:Offer } };
  source:Page|null; completed_source:boolean };
const ID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function id(v:string) { if(!ID.test(v))throw Error('Invalid repair identifier');return `'${v}'`; }
function sku(v:string) { if(!/^\d{6,12}$/.test(v))throw Error('Invalid repair SKU');return v; }
function q(v:unknown):string {
  if(v==null)return 'null';
  const s=typeof v==='object'?JSON.stringify(v):String(v);
  if(s.includes('\0'))throw Error('Invalid repair text');
  return "E'"+s.replaceAll('\\','\\\\').replaceAll("'","''").replaceAll('$','\\044')+"'";
}
function page(ref:string, productSku:string) {
  return `jsonb_build_object('id',${ref}.id,'requested_url',${ref}.requested_url,'final_url',${ref}.final_url,
    'created_at',${ref}.created_at,'mode',${ref}.mode,'outcome',${ref}.outcome,'http_status',${ref}.http_status,'body_sha256',${ref}.body_sha256,
    'total_products',jsonb_array_length(${ref}.parsed->'products'),
    'product_count',(select count(*) from jsonb_array_elements(${ref}.parsed->'products') p where p->>'sku'=${productSku}),
    'product',(select p from jsonb_array_elements(${ref}.parsed->'products') p where p->>'sku'=${productSku} limit 1))`;
}
function pendingMapping(mappingRef:string) {
  return `exists(select 1 from tesco_direct_collection_pages pending_page join scrape_runs pending_run on pending_run.id=pending_page.run_id
    cross join lateral jsonb_array_elements(case when pending_run.run_id like 'tesco_supervised_%'
      then coalesce(pending_run.error_summary::jsonb->'selected','[]'::jsonb) else '[]'::jsonb end) selected
    where pending_page.outcome='pending' and selected->>'id'=${mappingRef}::text
      and selected->>'store_url'=pending_page.requested_url)`;
}
export function repairContextSql(mappingId:string,hintId:string,targetSku:string,sourceId?:string) {
  const target=sku(targetSku), targetUrl=`https://www.tesco.ie/shop/en-IE/products/${target}`;
  return `(select jsonb_build_object('offer',to_jsonb(s),'canonical',jsonb_build_object('id',p.id,
    'canonical_name',p.canonical_name,'brand',p.brand,'ean',p.ean),'hint',${page('d',q(target))},
    'peers',coalesce((select jsonb_agg(to_jsonb(z) order by z.store,z.id) from (
      select x.id,x.store,x.store_sku,x.store_product_name,x.brand,x.gtin,l.price,l.observed_at
      from store_products x join latest_prices l on l.store_product_id=x.id
      where x.product_id=s.product_id and x.store in ('dunnes','supervalu'))z),'[]'::jsonb),
    'proven',exists(select 1 from scrape_product_receipts r where r.store_product_id=s.id and r.outcome='success'),
    'fresh',exists(select 1 from latest_prices l where l.store_product_id=s.id),
    'old_owners',(select count(*) from store_products x where x.store='tesco' and x.store_sku=s.store_sku),
    'target_owners',(select count(*) from store_products x where x.store='tesco' and x.store_sku=${q(target)} and x.id<>s.id),
    'target_stopped',exists(select 1 from tesco_direct_collection_pages x where x.requested_url=${q(targetUrl)} and x.created_at>d.created_at),
    'pending',(exists(select 1 from tesco_direct_collection_pages x where x.requested_url in(s.store_url,${q(targetUrl)}) and x.outcome='pending')
      or ${pendingMapping('s.id')}),
    'recent',exists(select 1 from tesco_direct_collection_pages x where x.requested_url in(s.store_url,${q(targetUrl)})
      and x.created_at>now()-interval '24 hours'
      ${sourceId?`and not(x.id=${id(sourceId)} and (tesco_internal.completed_evidence_source(x.id) or tesco_internal.completed_apify_evidence_source(x.id)))`:''}))
    from store_products s join products p on p.id=s.product_id
    join tesco_direct_collection_pages d on d.id=${id(hintId)} where s.id=${id(mappingId)} and s.store='tesco')`;
}
export function activationContextSql(auditId:string,sourceId:string) {
  return `(select ${repairContextSqlFromAudit(auditId,sourceId)} || jsonb_build_object('audit',to_jsonb(a),
    'source',${page('d',"a.prior_mapping->>'target_sku'")},
    'completed_source',(tesco_internal.completed_evidence_source(d.id) or tesco_internal.completed_apify_evidence_source(d.id)))
    from retailer_mapping_audit_decisions a join tesco_direct_collection_pages d on d.id=${id(sourceId)}
    where a.id=${id(auditId)} and a.store='tesco' and a.applied_action='stage_unverified_repair_target')`;
}
function repairContextSqlFromAudit(auditId:string,sourceId:string) {
  // The staged audit supplies the target; identifiers remain validated literals.
  return `(select jsonb_build_object('offer',to_jsonb(s),'canonical',jsonb_build_object('id',p.id,
    'canonical_name',p.canonical_name,'brand',p.brand,'ean',p.ean),
    'hint',a.prior_mapping #> '{original,hint}',
    'peers',coalesce((select jsonb_agg(to_jsonb(z) order by z.store,z.id) from (
      select x.id,x.store,x.store_sku,x.store_product_name,x.brand,x.gtin,l.price,l.observed_at
      from store_products x join latest_prices l on l.store_product_id=x.id
      where x.product_id=s.product_id and x.store in('dunnes','supervalu'))z),'[]'::jsonb),
    'proven',exists(select 1 from scrape_product_receipts r where r.store_product_id=s.id and r.outcome='success'),
    'fresh',exists(select 1 from latest_prices l where l.store_product_id=s.id),
    'old_owners',(select count(*) from store_products x where x.store='tesco' and x.store_sku=s.store_sku),
    'target_owners',(select count(*) from store_products x where x.store='tesco' and x.store_sku=a.prior_mapping->>'target_sku' and x.id<>s.id),
    'target_stopped',false,
    'pending',(exists(select 1 from tesco_direct_collection_pages x where x.requested_url in(s.store_url,a.prior_mapping #>> '{original,offer,store_url}') and x.outcome='pending')
      or ${pendingMapping('s.id')}),
    'recent',exists(select 1 from tesco_direct_collection_pages x where x.requested_url in(s.store_url,a.prior_mapping #>> '{original,offer,store_url}')
      and x.created_at>now()-interval '24 hours'
      and not(x.id=${id(sourceId)} and (tesco_internal.completed_evidence_source(x.id) or tesco_internal.completed_apify_evidence_source(x.id)))))
    from store_products s join products p on p.id=s.product_id where s.id=a.store_product_id and a.id=${id(auditId)})`;
}
function positiveIdentity(c:Canonical,product:TescoCollectedProduct,peers:Peer[],structured:boolean) {
  const canonical=declaredPack(c.canonical_name), source=declaredPack(product.name);
  if(product.quantity){
    const entries=Object.entries(product.quantity);
    if(entries.length!==1||entries.some(([k,v])=>!['grams','millilitres','pieces'].includes(k)
      ||typeof v!=='number'||!Number.isFinite(v)||v<=0))return false;
  }
  if(!c.brand||!product.brand||/\b(?:tesco|dunnes|supervalu)\b/i.test(c.brand)||!sameBrand(c.brand,product.brand)||!canonical.total
    ||canonical.total!==source.total||canonicalVariantConflict(c.canonical_name,product.name)
    ||!titleSupport(c.canonical_name,product.name)
    ||(canonical.units!=null&&source.units!=null&&canonical.units!==source.units)
    ||(c.ean!=null&&!sameBarcode(c.ean,product.gtin))
    ||(product.quantity&&structuredMeasure(product.quantity)!==source.total)
    ||(structured&&!product.quantity))return false;
  return peers.some(p=>p.price>0&&p.observed_at&&declaredPack(p.store_product_name).total===source.total
    &&(p.brand?sameBrand(p.brand,product.brand!):p.store_product_name.toLowerCase().includes(product.brand!.toLowerCase()))
    &&titleSupport(product.name,p.store_product_name)&&!canonicalVariantConflict(product.name,p.store_product_name)
    &&corroboratesWords(c.canonical_name,product.name,p.store_product_name,c.brand!)
    &&(p.gtin==null||sameBarcode(p.gtin,product.gtin))
    &&(source.units==null||declaredPack(p.store_product_name).units===source.units));
}
function corroboratesWords(canonical:string,source:string,peer:string,brand:string) {
  const medium=(s:string)=>/\bbrine\b/i.test(s)?'brine':/\bspring\s*water\b/i.test(s)?'springwater':/\b(?:sunflower|olive)\s+oil\b/i.exec(s)?.[0].toLowerCase();
  const media=[canonical,source,peer].map(medium).filter(Boolean);
  if(new Set(media).size>1)return false;
  const normal=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/([a-z])['’]([a-z])/g,'$1$2')
    .replace(/\bready to heat\b/g,'microwave').replace(/\bspring water\b/g,'springwater')
    .replace(/\b\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|ml|litres?|l)\b/g,' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|ml|litres?|l)\b/g,' ')
    .replace(/\b\d+\s*(?:packs?|pk|rolls?|pieces?|sticks?|bars?)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ').replace(/\boatlets\b/g,'oats').replace(/\bthinly\b/g,'thin')
    .replace(/\b(pudding|biscuit|treat|dog|crisp)s\b/g,'$1');
  const ignored=new Set([...normal(brand).split(' '),'a','the','and','with','for','in','of','to','from','pack','bottle','bottles','soft','drink','liquid']);
  const words=(s:string)=>new Set(normal(s).split(' ').filter(w=>(w.length>1||/^\d+$/.test(w))&&!ignored.has(w)));
  const c=words(canonical),s=words(source),p=words(peer);
  // Every source-specific term must be explained by the canonical identity or
  // the independent peer, and every canonical term by one of those sources.
  // Similarity alone cannot turn a pea soup into tomato, or a gel into foam.
  return c.size>0&&s.size>0&&[...c].every(w=>s.has(w)||p.has(w))&&[...s].every(w=>c.has(w)||p.has(w));
}
function sourcePageValid(p:Page,direct:boolean) {
  const product=p?.product;
  if(!product||p.product_count!==1||p.outcome!=='ok'||p.http_status!==200||!/^[a-f0-9]{64}$/.test(p.body_sha256)
    ||product.url!==`https://www.tesco.ie/shop/en-IE/products/${sku(product.sku)}`)return false;
  for(const url of[p.requested_url,p.final_url]) {
    try{const u=new URL(url);if(u.protocol!=='https:'||u.host!=='www.tesco.ie'||u.username||u.password||u.hash)return false;}catch{return false;}
  }
  return direct?p.total_products===1&&p.mode==='products'&&p.requested_url===product.url&&p.final_url===product.url
    &&product.available&&product.currency==='EUR'&&Number(product.price)>0:['products','listings'].includes(p.mode);
}
export function supportedRepairHint(c:RepairContext|null) {
  return !!c&&c.offer.store==='tesco'&&c.offer.is_own_brand!==true&&c.proven&&!c.fresh&&!c.pending&&!c.recent&&!c.target_stopped&&c.old_owners<=1&&c.target_owners===0
    &&['resolved','failed'].includes(c.offer.url_status)&&sourcePageValid(c.hint,false)
    &&c.hint.product!.sku!==c.offer.store_sku&&positiveIdentity(c.canonical,c.hint.product!,c.peers,false);
}
function freeGate() {
  return `perform 1 from tesco_egress_pool where egress_key=${q(SUPERVISED_GATE)} for update;
    if not exists(select 1 from tesco_egress_pool where egress_key=${q(SUPERVISED_GATE)}
      and enabled=false and(leased_until is null or leased_until<=now()) and coalesce(cooldown_until,now())<=now())
    then raise exception 'repair_gate_busy'; end if;`;
}
export function stageRepairSql(c:RepairContext,reason:string,batch=`tesco-repair-stage-${randomUUID()}`) {
  if(!supportedRepairHint(c)||reason.trim().length<40)throw Error('Repair hint requires independent review');
  const product=c.hint.product!,url=product.url;
  return `do $repair$ begin
    if current_user<>'postgres' or session_user<>'postgres' then raise exception 'supervised_bridge_required'; end if;
    ${freeGate()} perform 1 from store_products where id=${id(c.offer.id)} for update;
    if ${repairContextSql(c.offer.id,c.hint.id,product.sku)} is distinct from ${q(c)}::jsonb
      then raise exception 'repair_snapshot_changed'; end if;
    update store_products set store_sku=${q(product.sku)},store_url=${q(url)},url_status='failed' where id=${id(c.offer.id)};
    insert into retailer_mapping_audit_decisions(decision_batch,store_product_id,store,classification,reason,
      evidence_source,prior_mapping,applied_action,applied_at)
    values(${q(batch)},${id(c.offer.id)},'tesco','exact_replacement_candidate',${q(reason)},
      'retained_tesco_hint_pending_current_source',(${q({original:c,target_sku:product.sku,target_url:url})}::jsonb
        ||jsonb_build_object('staged_offer',(select to_jsonb(s) from store_products s where id=${id(c.offer.id)}))),
      'stage_unverified_repair_target',now());
    end $repair$; select id audit_id,store_product_id from retailer_mapping_audit_decisions where decision_batch=${q(batch)}`;
}
export function supportedRepairActivation(c:ActivationContext|null) {
  if(!c||!c.completed_source||!c.source||!sourcePageValid(c.source,true)||c.fresh||c.pending||c.recent
    ||!c.proven||c.target_owners!==0||c.old_owners!==1||c.offer.url_status!=='failed'
    ||!Number.isFinite(Date.parse(c.source.created_at))||!Number.isFinite(Date.parse(c.audit.applied_at))
    ||Date.parse(c.source.created_at)<Date.parse(c.audit.applied_at)
    ||c.audit.applied_action!=='stage_unverified_repair_target'||c.audit.store_product_id!==c.offer.id)return false;
  const original=c.audit.prior_mapping.original, source=c.source.product!,hint=original.hint.product!;
  const expected=c.audit.prior_mapping.staged_offer;
  if(!supportedRepairHint(original)||expected.id!==original.offer.id||expected.store_sku!==hint.sku
    ||expected.store_url!==hint.url||expected.url_status!=='failed')return false;
  return isDeepStrictEqual(c.offer,expected)&&isDeepStrictEqual(c.canonical,original.canonical)
    &&source.sku===hint.sku&&source.url===hint.url&&(hint.gtin==null||source.gtin===hint.gtin)
    &&positiveIdentity(c.canonical,source,c.peers,true);
}
export function activateRepairSql(c:ActivationContext,reason:string,batch=`tesco-repair-activate-${randomUUID()}`) {
  if(!supportedRepairActivation(c)||reason.trim().length<40)throw Error('Current repair source requires independent review');
  const product=c.source!.product!;
  return `do $repair$ begin
    if current_user<>'postgres' or session_user<>'postgres' then raise exception 'supervised_bridge_required'; end if;
    ${freeGate()} perform 1 from store_products where id=${id(c.offer.id)} for update;
    if ${activationContextSql(c.audit.id,c.source!.id)} is distinct from ${q(c)}::jsonb
      then raise exception 'repair_snapshot_changed'; end if;
    if tesco_internal.material_title_conflict(${q(c.canonical.canonical_name)},${q(product.name)},${q(product.quantity)}::jsonb)
      then raise exception 'repair_material_conflict'; end if;
    insert into retailer_mapping_audit_decisions(decision_batch,store_product_id,store,classification,reason,
      evidence_source,prior_mapping,applied_action,applied_at)
    values(${q(batch)},${id(c.offer.id)},'tesco','exact_replacement_candidate',${q(reason)},
      'current_supervised_source_and_independent_peer',${q({original:c.offer,stage_audit:c.audit.id,source:c.source,canonical:c.canonical,peers:c.peers})}::jsonb,
      'activate_source_verified_repair',now());
    update store_products set store_product_name=${q(product.name)},brand=${q(product.brand)},gtin=${q(product.gtin)},url_status='resolved'
      where id=${id(c.offer.id)};
    end $repair$; select id audit_id,store_product_id from retailer_mapping_audit_decisions where decision_batch=${q(batch)}`;
}
