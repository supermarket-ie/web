-- Only this evidence-bound approval path can resolve an inferred item count.
-- Ordinary collection, repair activation and explicit-count checks are unchanged.
create function tesco_internal.reviewed_plural_pack_conflict(e jsonb)
returns boolean language plpgsql immutable security invoker set search_path = ''
as $proof$
declare
  m jsonb := e->'mapping';
  s jsonb := e #> '{page,parsed,products,0}';
  c text := lower(replace(replace(m->>'canonical_name',chr(39),''),'’',''));
  t text := lower(replace(replace(s->>'name',chr(39),''),'’',''));
  b text := lower(regexp_replace(s->>'brand','[^a-zA-Z0-9]','','g'));
  counts text := '\m(\d+)\s*(?:x\s*\d|(?:(?:standard|dental|jumbo|mini|large|small|sausage|reduced|salt|beef|chicken|vegetable|stock|be|good|wholemeal|seeded|ultimate|breaded|fillet|pepperoni|and|cheese|triple|pizza)\s+){0,6}(?:packs?|pk|rolls?|sheets?|pieces?|pairs?|bars?|sticks?|pouches?|sachets?|chews?|pods?|cubes?|bagels?|burgers?|pots?|tablets?|bottles?|tubes?|cans?|pockets?)\M)';
  measure text := '(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|litres?)\M';
  sc text[]; pc text[];
  ct text; tt text; pt text;
  cw text[]; tw text[]; pw text[];
  noun text; item text; peer jsonb;
begin
  if not tesco_internal.material_title_conflict(m->>'canonical_name',s->>'name',s->'quantity') then return false; end if;
  if jsonb_typeof(s->'quantity') is distinct from 'object' then return true; end if;
  if (select count(*) from jsonb_each(s->'quantity'))<>1
    or exists(select 1 from jsonb_each(s->'quantity') q where q.key not in ('grams','millilitres')
      or jsonb_typeof(q.value)<>'number') then return true; end if;
  if (select value::text::numeric from jsonb_each(s->'quantity'))<=0 then return true; end if;
  -- Missing/malformed evidence cannot create a new positive proof.
  if c is null or t is null or b is null or b='' or b ~ '^(tesco|dunnes|supervalu)'
    or coalesce((m->>'is_own_brand')::boolean,false)
    or m->>'canonical_brand' is null
    or lower(regexp_replace(m->>'canonical_brand','[^a-zA-Z0-9]','','g'))<>b
    or coalesce((case when m->>'store_brand' is not null then
      lower(regexp_replace(m->>'store_brand','[^a-zA-Z0-9]','','g'))<>b
      else position(' '||b||' ' in ' '||regexp_replace(lower(replace(replace(m->>'store_product_name',chr(39),''),'’','')),'[^a-z0-9]+',' ','g')||' ')=0 end),true)
    or regexp_match(c,counts) is not null
    or regexp_match(c,measure) is null or regexp_match(t,measure) is null
  then return true; end if;
  -- This narrow path accepts counted whole-pack titles, never Nx-unit-size titles.
  sc := regexp_match(t,'\m(\d+)\s*(?:packs?|pk)\M');
  if sc is null or sc[1]::int<=1 or sc[1]::int>1000
    or t ~ '\m\d+\s*x\s*\d' then return true; end if;
  foreach noun in array array['pockets','bars','biscuits','burgers','puddings','sticks','chews','treats','rolls','sachets','pouches','pots','cakes'] loop
    if c ~ ('\m'||noun||'\M') and t ~ ('\m'||noun||'\M') then item:=noun; exit; end if;
  end loop;
  if item is null then return true; end if;
  tt := regexp_replace(t,'\m\d+\s*(?:packs?|pk)\M','','g');
  -- All existing dimensional, structured-measure and recipe checks still run.
  if tesco_internal.material_title_conflict(c,tt,s->'quantity') then return true; end if;
  ct := regexp_replace(regexp_replace(c,measure,'','g'),'[^a-z0-9]+',' ','g');
  tt := regexp_replace(regexp_replace(tt,measure,'','g'),'[^a-z0-9]+',' ','g');
  -- Source and canonical product words must agree exactly after manufacturer
  -- and pack syntax removal. No recipe/form aliases are introduced here.
  select array_agg(w order by w) into cw from (select distinct w from unnest(regexp_split_to_array(ct,'\s+')) w
    where length(w)>1 and w<>b and w not in ('and','with','in','of','pack','packs','pk')) q;
  select array_agg(w order by w) into tw from (select distinct w from unnest(regexp_split_to_array(tt,'\s+')) w
    where length(w)>1 and w<>b and w not in ('and','with','in','of','pack','packs','pk')) q;
  if cw is null or cw is distinct from tw then return true; end if;
  for peer in select value from jsonb_array_elements(e->'peers') loop
    pt := lower(replace(replace(peer->>'store_product_name',chr(39),''),'’',''));
    pc := regexp_match(pt,counts);
    if peer->>'observed_at' is null or coalesce((peer->>'price')::numeric,0)<=0
      or not coalesce(peer->>'store' in ('dunnes','supervalu'),false)
      or peer->>'brand' is null or lower(regexp_replace(peer->>'brand','[^a-zA-Z0-9]','','g'))<>b
      or pc is null or pc[1]::int<>sc[1]::int
      or not coalesce(pt ~ ('\m'||item||'\M'),false)
      or regexp_match(pt,measure) is null
      or (peer->>'gtin' is not null and ltrim(peer->>'gtin','0') is distinct from ltrim(s->>'gtin','0'))
    then continue; end if;
    -- Remove only the corroborated integer, retaining every descriptive word.
    pt := regexp_replace(pt,'\m'||pc[1]||'\s*','','');
    if tesco_internal.material_title_conflict(c,pt,s->'quantity') then continue; end if;
    pt := regexp_replace(regexp_replace(pt,measure,'','g'),'[^a-z0-9]+',' ','g');
    pw := regexp_split_to_array(pt,'\s+');
    if cw <@ pw then return false; end if;
  end loop;
  return true;
end $proof$;
revoke all on function tesco_internal.reviewed_plural_pack_conflict(jsonb) from public,anon,authenticated,service_role;

-- Preserve the invoker function and its existing ACL; only canonical count
-- conflict handling changes, using the SERVER-derived immutable snapshot.
CREATE OR REPLACE FUNCTION tesco_internal.record_verified_hold_reentry(p_mapping_id uuid, p_source_page_id uuid, p_evidence_snapshot jsonb, p_independent_assessment jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  if tesco_internal.reviewed_plural_pack_conflict(v_evidence)
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
end $function$

