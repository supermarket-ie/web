-- Only the exact successful acquisition page is exempt for a separately
-- reviewed new live price request. All other recent/pending attempts still block.
create function tesco_internal.completed_evidence_source(p_page_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $body$
  select exists(select 1 from public.tesco_direct_collection_pages d
    join public.scrape_runs r on r.id=d.run_id where d.id=p_page_id
    and case when r.run_id like 'tesco_supervised_evidence_%' then
      r.store='tesco' and r.status='success' and r.finished_at is not null
      and coalesce((r.error_summary::jsonb->>'evidenceOnly')::boolean,false)
      and r.error_summary::jsonb->>'activeSupervisor' is null
      and d.outcome='ok' and d.http_status=200 and d.mode='products'
      and d.parsed #>> '{products,0,available}'='true'
      and d.parsed #>> '{products,0,currency}'='EUR'
      and jsonb_typeof(d.parsed #> '{products,0,price}')='number'
      and (d.parsed #>> '{products,0,price}')::numeric>0
      and d.requested_url=d.final_url and d.body_sha256 ~ '^[a-f0-9]{64}$'
      and d.detail::jsonb->>'acquisitionOnly'='true'
      and d.detail::jsonb->>'pricesInserted'='0'
      and d.created_at>=r.started_at and d.created_at<=r.finished_at
      and not exists(select 1 from public.scrape_product_receipts z where z.run_id=r.id)
    else false end);
$body$;
revoke all on function tesco_internal.completed_evidence_source(uuid) from public,anon,authenticated,service_role;

create or replace function tesco_internal.record_verified_hold_reentry(
  p_mapping_id uuid,
  p_source_page_id uuid,
  p_evidence_snapshot jsonb,
  p_independent_assessment jsonb
) returns uuid language plpgsql security invoker set search_path = ''
as $function$
declare
  v_evidence jsonb;
  v_mapping jsonb;
  v_page jsonb;
  v_source jsonb;
  v_review_id uuid;
begin
  if current_user <> 'postgres' or session_user <> 'postgres' then
    raise exception 'tesco_sql_bridge_identity_required';
  end if;
  if p_mapping_id is null or p_source_page_id is null
    or jsonb_typeof(p_evidence_snapshot) is distinct from 'object'
    or jsonb_typeof(p_independent_assessment) is distinct from 'object'
    or p_independent_assessment->>'decision' is distinct from 'verified_exact'
    or p_independent_assessment #> '{validation,independently_exact}' is distinct from 'true'::jsonb
  then raise exception 'verified_identity_evidence_required'; end if;

  perform 1 from public.store_products
    where id = p_mapping_id and store = 'tesco' for update;
  if not found then raise exception 'tesco_mapping_not_found'; end if;
  perform 1 from public.tesco_direct_collection_pages
    where id = p_source_page_id for share;
  if not found then raise exception 'retained_tesco_page_not_found'; end if;

  select jsonb_build_object(
    'mapping',to_jsonb(m),
    'sameSkuCount',(select count(*) from public.store_products x where x.store='tesco' and x.store_sku=m.store_sku),
    'page',jsonb_build_object('id',d.id,'requested_url',d.requested_url,'final_url',d.final_url,
      'outcome',d.outcome,'http_status',d.http_status,'body_sha256',d.body_sha256,'mode',d.mode,'parsed',d.parsed),
    'sourceRun',jsonb_build_object('status',r.status,'finished_at',r.finished_at),
    'peers',coalesce((select jsonb_agg(to_jsonb(q) order by q.store,q.id) from (
      select s.id,s.store,s.store_product_name,s.brand,s.gtin,s.store_sku,l.observed_at,l.price
      from public.store_products s join public.latest_prices l on l.store_product_id=s.id
      where s.product_id=m.product_id and s.store in ('dunnes','supervalu')) q),'[]'::jsonb),
    'proven',exists(select 1 from public.scrape_product_receipts z where z.store_product_id=m.id and z.outcome='success'),
    'freshTesco',exists(select 1 from public.latest_prices l where l.store_product_id=m.id),
    'pending',exists(select 1 from public.tesco_direct_collection_pages x where x.requested_url=m.store_url and x.outcome='pending'),
    'recentAttempt',exists(select 1 from public.tesco_direct_collection_pages x where x.requested_url=m.store_url
      and x.created_at>now()-interval '24 hours'
      and (x.id<>d.id or not tesco_internal.completed_evidence_source(d.id))))
    into v_evidence
    from (select s.id,s.product_id,p.canonical_name,p.brand canonical_brand,(to_jsonb(p)->>'ean') canonical_ean,
      s.store_product_name,s.brand store_brand,s.is_own_brand,s.store_sku,s.store_url,s.url_status,s.gtin
      from public.store_products s join public.products p on p.id=s.product_id
      where s.id=p_mapping_id and s.store='tesco') m
    join public.tesco_direct_collection_pages d on d.id=p_source_page_id
    join public.scrape_runs r on r.id=d.run_id;

  if v_evidence is null or v_evidence is distinct from p_evidence_snapshot then
    raise exception 'tesco_recovery_evidence_snapshot_changed'; end if;
  v_mapping := v_evidence->'mapping';
  v_page := v_evidence->'page';
  v_source := v_page #> '{parsed,products,0}';

  if (v_evidence->>'sameSkuCount')::integer is distinct from 1
    or v_evidence->>'proven' is distinct from 'true'
    or v_evidence->>'freshTesco' is distinct from 'false'
    or v_evidence->>'pending' is distinct from 'false'
    or v_evidence->>'recentAttempt' is distinct from 'false'
    or v_mapping->>'url_status' is distinct from 'resolved'
    or not coalesce(v_mapping->>'store_sku' ~ '^[0-9]{6,12}$', false)
    or v_mapping->>'store_url' is distinct from 'https://www.tesco.ie/shop/en-IE/products/' || (v_mapping->>'store_sku')
    or v_page->>'requested_url' is distinct from v_mapping->>'store_url'
    or v_page->>'final_url' is distinct from v_mapping->>'store_url'
    or v_page->>'outcome' is distinct from 'ok' or (v_page->>'http_status')::integer is distinct from 200
    or v_page->>'mode' is distinct from 'products'
    or not coalesce(v_page->>'body_sha256' ~ '^[a-f0-9]{64}$', false)
    or not coalesce((v_evidence #>> '{sourceRun,status}') in ('success','degraded'), false)
    or v_evidence #>> '{sourceRun,finished_at}' is null
    or jsonb_typeof(v_page #> '{parsed,products}') is distinct from 'array'
    or jsonb_array_length(v_page #> '{parsed,products}') is distinct from 1
    or v_page #> '{parsed,listing}' is distinct from 'null'::jsonb
    or v_source->>'sku' is distinct from v_mapping->>'store_sku'
    or v_source->>'url' is distinct from v_mapping->>'store_url'
    or nullif(trim(coalesce(v_source->>'name','')),'') is null
    or nullif(trim(coalesce(v_source->>'brand','')),'') is null
    or jsonb_typeof(v_source->'quantity') is distinct from 'object'
    or jsonb_typeof(v_evidence->'peers') is distinct from 'array'
    or jsonb_array_length(v_evidence->'peers') > 2
  then raise exception 'tesco_recovery_source_identity_not_exact'; end if;

  if (select count(*) from jsonb_each(v_source->'quantity')) <> 1
    or exists(select 1 from jsonb_each(v_source->'quantity') q
      where q.key not in ('grams','millilitres','pieces') or jsonb_typeof(q.value) <> 'number')
  then raise exception 'tesco_recovery_source_identity_not_exact'; end if;
  if (select value::text::numeric from jsonb_each(v_source->'quantity')) <= 0
  then raise exception 'tesco_recovery_source_identity_not_exact'; end if;

  -- Material barcode and brand contradictions cannot be attested away by AI.
  if (v_mapping->>'gtin' is not null and v_mapping->>'gtin' is distinct from v_source->>'gtin')
    or (v_mapping->>'canonical_ean' is not null and
      (v_source->>'gtin' is null or v_source->>'gtin' !~ '^[0-9]{8,14}$' or
       ltrim(v_mapping->>'canonical_ean','0') is distinct from ltrim(v_source->>'gtin','0')))
    or (v_mapping->>'store_brand' is not null and
      lower(regexp_replace(v_mapping->>'store_brand','[^a-zA-Z0-9]','','g')) is distinct from
      lower(regexp_replace(v_source->>'brand','[^a-zA-Z0-9]','','g')))
    or (v_mapping->>'canonical_brand' is not null and
      lower(regexp_replace(v_mapping->>'canonical_brand','[^a-zA-Z0-9]','','g')) is distinct from
      lower(regexp_replace(v_source->>'brand','[^a-zA-Z0-9]','','g')))
  then raise exception 'tesco_recovery_barcode_or_brand_conflict'; end if;

  if tesco_internal.material_title_conflict(v_mapping->>'canonical_name',v_source->>'name',v_source->'quantity')
    or tesco_internal.material_title_conflict(v_mapping->>'store_product_name',v_source->>'name',v_source->'quantity')
  then raise exception 'tesco_recovery_pack_or_variant_conflict'; end if;

  if p_independent_assessment->>'mapping_id' is distinct from p_mapping_id::text
    or p_independent_assessment->>'source_page_id' is distinct from p_source_page_id::text
    or p_independent_assessment->>'source_body_sha256' is distinct from v_page->>'body_sha256'
    or length(trim(coalesce(p_independent_assessment->>'reason',''))) < 30
    or length(trim(coalesce(p_independent_assessment->>'model',''))) < 3
    or length(trim(coalesce(p_independent_assessment->>'source',''))) < 5
  then raise exception 'tesco_recovery_assessment_not_bound_to_source'; end if;

  if exists (select 1 from public.tesco_hold_reentry_reviews v
    where v.store_product_id=p_mapping_id and v.expires_at>now()
      and not exists(select 1 from public.tesco_hold_reentry_uses u where u.review_id=v.id)
      and not exists(select 1 from public.tesco_hold_reentry_revocations x where x.review_id=v.id))
  then raise exception 'tesco_recovery_decision_already_active'; end if;

  -- This local context only passes the table's BEFORE INSERT trigger within
  -- this transaction; the function's privileges stay INVOKER. A caller with a
  -- normal API role has neither EXECUTE nor INSERT authority for this path.
  perform pg_catalog.set_config('tesco.verified_reentry_decision','armed',true);
  insert into public.tesco_hold_reentry_reviews
    (store_product_id,source_page_id,evidence_snapshot,independent_reason,
     approval_kind,machine_assessment,expires_at)
  values (p_mapping_id,p_source_page_id,v_evidence,p_independent_assessment->>'reason',
    'collector',p_independent_assessment,now()+interval '48 hours')
  returning id into v_review_id;
  perform pg_catalog.set_config('tesco.verified_reentry_decision','',true);
  return v_review_id;
end $function$;

