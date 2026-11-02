-- Existing supervised SQL-bridge operator may record a narrowly evidenced
-- held-mapping decision. No new Supabase Auth account, service-role INSERT,
-- Data API endpoint, RLS bypass function, price write or hold removal.
-- The normal collector alone consumes the decision and finalises a live price.

alter table public.tesco_hold_reentry_reviews
  alter column reviewer_id drop not null,
  add column collector_identity text;

alter table public.tesco_hold_reentry_reviews
  drop constraint tesco_hold_reentry_reviews_approval_kind_check,
  add constraint tesco_hold_reentry_reviews_approval_kind_check
    check (approval_kind in ('human', 'machine', 'collector')),
  drop constraint tesco_machine_approval_evidence,
  add constraint tesco_machine_approval_evidence check (coalesce(
    (approval_kind = 'human' and machine_assessment is null)
    or (approval_kind in ('machine', 'collector')
      and jsonb_typeof(machine_assessment) = 'object'
      and machine_assessment->>'decision' = 'verified_exact'
      and length(trim(coalesce(machine_assessment->>'model', ''))) >= 3
      and length(trim(coalesce(machine_assessment->>'reason', ''))) >= 30
      and length(trim(coalesce(machine_assessment->>'source', ''))) >= 5
      and machine_assessment #> '{validation,independently_exact}' = 'true'::jsonb
      and machine_assessment->>'mapping_id' = store_product_id::text
      and machine_assessment->>'source_page_id' = source_page_id::text
      and machine_assessment->>'source_body_sha256' = evidence_snapshot #>> '{page,body_sha256}')
  , false)),
  add constraint tesco_reentry_accountable_actor check (
    (approval_kind = 'collector' and reviewer_id is null
      and collector_identity = 'postgres:supervised_sql_bridge')
    or (approval_kind in ('human', 'machine') and reviewer_id is not null
      and collector_identity is null)
  );

-- An ordinary Auth actor may still submit a human review through the original
-- JWT-granted path. The unnecessary machine-account branch is retired.
drop policy tesco_hold_review_authenticated_insert on public.tesco_hold_reentry_reviews;
create policy tesco_hold_review_authenticated_insert on public.tesco_hold_reentry_reviews
  for insert to authenticated with check (
    approval_kind = 'human' and reviewer_id = (select auth.uid())
    and coalesce((select auth.jwt()) #>> '{app_metadata,tesco_reentry_reviewer}', 'false') = 'true'
    and coalesce((select auth.jwt()) #>> '{app_metadata,tesco_reentry_machine_approver}', 'false') <> 'true'
  );

create or replace function public.bind_tesco_reentry_review_actor() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.approval_kind = 'collector' then
    -- Only the trusted postgres SQL bridge, in the body of the single-purpose
    -- verified decision function below, may append a collector decision.
    -- This is NOT an INSERT grant to service_role or an authenticated caller.
    if current_user <> 'postgres' or session_user <> 'postgres'
      or current_setting('tesco.verified_reentry_decision', true) is distinct from 'armed'
    then raise exception 'tesco_operational_recovery_function_required'; end if;
    new.reviewer_id := null;
    new.collector_identity := 'postgres:supervised_sql_bridge';
    new.approved_at := now();
    return new;
  end if;
  if new.approval_kind <> 'human' or auth.uid() is null
    or coalesce(auth.jwt() #>> '{app_metadata,tesco_reentry_reviewer}', 'false') <> 'true'
    or coalesce(auth.jwt() #>> '{app_metadata,tesco_reentry_machine_approver}', 'false') = 'true'
  then raise exception 'authenticated_tesco_reentry_reviewer_required'; end if;
  new.reviewer_id := auth.uid();
  new.collector_identity := null;
  new.approved_at := now();
  return new;
end $$;

create schema if not exists tesco_internal;
revoke all on schema tesco_internal from public, anon, authenticated, service_role;

-- A conservative second-line database check for explicit pack/variant
-- contradictions. The existing TypeScript independentExactIdentity check
-- remains mandatory before the SQL call and after a live fetch.
create function tesco_internal.material_title_conflict(
  p_canonical text, p_tesco text, p_source_quantity jsonb default null
)
returns boolean language plpgsql immutable set search_path = ''
as $check$
declare
  c text := lower(regexp_replace(coalesce(p_canonical,''), '(\d),(\d{3})(\D|$)', '\1\2\3', 'g'));
  t text := lower(regexp_replace(coalesce(p_tesco,''), '(\d),(\d{3})(\D|$)', '\1\2\3', 'g'));
  term text;
  terms text[] := array['juice drink','citrus','lemon','lime','vanilla','chocolate',
    'strawberry','zero','diet','sugar free','gluten free','organic'];
  cm text[];
  tm text[];
  cc text[];
  tc text[];
  t_multi text[];
  c_units numeric;
  t_units numeric;
  c_measures integer;
  t_measures integer;
  c_quantity numeric;
  t_quantity numeric;
  source_unit text;
  source_quantity numeric;
begin
  c := replace(replace(c, ',', '.'), '×', 'x');
  t := replace(replace(t, ',', '.'), '×', 'x');
  foreach term in array terms loop
    if (c ~ ('\m' || replace(term,' ','[[:space:]]+') || '\M'))
      is distinct from (t ~ ('\m' || replace(term,' ','[[:space:]]+') || '\M'))
    then return true; end if;
  end loop;

  -- A compound title cannot be reduced to its first measure. Keep it held
  -- rather than silently dropping the extra quantity or dimension.
  select count(*) into c_measures from regexp_matches(c, '(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\M', 'g');
  select count(*) into t_measures from regexp_matches(t, '(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\M', 'g');
  if c_measures > 1 or t_measures > 1 then return true; end if;
  cm := regexp_match(c, '(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\M');
  tm := regexp_match(t, '(\d+(?:\.\d+)?)\s*(kg|g|ml|l|litres?)\M');
  if cm is not null then
    c_quantity := cm[1]::numeric * case when cm[2] in ('kg','l','litre','litres') then 1000 else 1 end;
    if c_quantity <= 0 then return true; end if;
  end if;
  if tm is not null then
    t_quantity := tm[1]::numeric * case when tm[2] in ('kg','l','litre','litres') then 1000 else 1 end;
    if t_quantity <= 0 then return true; end if;
  end if;
  if cm is not null and tm is not null then
    if (cm[2] in ('kg','g')) <> (tm[2] in ('kg','g')) or c_quantity <> t_quantity
    then return true; end if;
  end if;

  cc := regexp_match(c, '\m(\d+)\s*(?:x\s*\d|(?:(?:standard|dental|jumbo|mini|large|small|sausage)\s+)?(?:packs?|pk|rolls?|sheets?|pieces?|pairs?|bars?|sticks?|pouches?|sachets?|chews?|pods?|cubes?|tablets?|bottles?|tubes?|cans?)\M)');
  tc := regexp_match(t, '\m(\d+)\s*(?:x\s*\d|(?:(?:standard|dental|jumbo|mini|large|small|sausage)\s+)?(?:packs?|pk|rolls?|sheets?|pieces?|pairs?|bars?|sticks?|pouches?|sachets?|chews?|pods?|cubes?|tablets?|bottles?|tubes?|cans?)\M)');
  -- Match the independent collector's conservative single-unit inference:
  -- "1L" is one unit, and must not approve "6x1L" in either direction.
  c_units := case when cc is not null then cc[1]::numeric when cm is not null then 1 end;
  t_units := case when tc is not null then tc[1]::numeric when tm is not null then 1 end;
  if c_units <= 0 or t_units <= 0
    or (c_units is not null and t_units is not null and c_units <> t_units)
  then return true; end if;

  -- Structured source quantity is retained retailer evidence, not an AI claim.
  -- Tesco's Nx-size product measure is the total pack amount; an ordinary
  -- counted title such as "7 sticks 110g" already states the total weight.
  if p_source_quantity is not null then
    select key, value::text::numeric into source_unit, source_quantity
      from jsonb_each(p_source_quantity);
    t_multi := regexp_match(t, '\m(\d+)\s*x\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|l|litres?)\M');
    if tm is not null and (
      source_unit is distinct from case when tm[2] in ('kg','g') then 'grams' else 'millilitres' end
      or source_quantity <> t_quantity * case when t_multi is not null then t_multi[1]::numeric else 1 end
    ) then return true; end if;
    if tm is null and source_unit = 'pieces' and t_units is not null
      and source_quantity <> t_units then return true; end if;
    if tm is null and cm is not null and coalesce(c_units,1) = 1 and (
      source_unit is distinct from case when cm[2] in ('kg','g') then 'grams' else 'millilitres' end
      or source_quantity <> c_quantity
    ) then return true; end if;
  end if;
  return false;
end $check$;
revoke all on function tesco_internal.material_title_conflict(text,text,jsonb)
  from public, anon, authenticated, service_role;

-- SECURITY INVOKER: this routine receives no privileges beyond the existing
-- postgres SQL bridge, and is not exposed to browser/API roles. It rereads
-- the actual database mapping, retained source, receipts, peers and attempts
-- while holding the mapping/source rows; submitted evidence cannot substitute
-- for database evidence. It records a one-use *decision*, never a price.
create function tesco_internal.record_verified_hold_reentry(
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
      and x.created_at>now()-interval '24 hours'))
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

revoke all on function tesco_internal.record_verified_hold_reentry(uuid,uuid,jsonb,jsonb)
  from public, anon, authenticated, service_role;
-- PostgreSQL's administrative owner can execute it through the existing
-- supervised SQL connector. Nothing is granted to a runtime Data API role.
comment on function tesco_internal.record_verified_hold_reentry(uuid,uuid,jsonb,jsonb)
  is 'Narrow, evidence-bound append-only recovery decision for supervised postgres SQL bridge; never approves via a new Auth principal or writes a price.';
