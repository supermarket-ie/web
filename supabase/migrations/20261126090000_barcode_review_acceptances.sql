-- AI-assisted REVIEW-tier barcode associations (owner authorised, 24 Nov 2026; policy barcode-review-ai-v1).
-- A review-tier barcode observation (the retailer's own search returned exactly one SKU for the Tesco GTIN, but the
-- titles differ in wording) is NEVER converted into a strong association. Instead an accepted review-tier association
-- is a SEPARATE, append-only record with its own provenance:
--   * retailer_barcode_review_acceptances: bound to the exact review-tier observation (FK on id, gtin, store, sku), the
--     Tesco origin offer, the retailer offer on the SAME catalogue record with an unshared SKU, the retailer's own
--     SKU-bound capture of that offer (recent, store/SKU-bound), the independent AI assessment (verified_exact and every
--     material fact true) and the deterministic checks the application ran (structural SKU/brand/pack/variant/
--     formulation checks passed; no material wording word unexplained).
--   * current_barcode_review_acceptances: ACTIVE only while that observation is still the LATEST for the (gtin, store)
--     (a newer observation that differs suspends it), within 30 days, with the offer still on that SKU and record.
--   * current_machine_associations: strong ACTIVE associations (basis 'strong') plus active acceptances (basis 'ai_review').
--     current_barcode_associations itself is unchanged.
--   * record_machine_pair_approval now reads current_machine_associations. Policy barcode-exact-v1 accepts basis 'strong'
--     ONLY (behaviour unchanged). Policy barcode-review-ai-v1 accepts strong or ai_review sides but requires at least one
--     active AI-accepted side, and its ledger rows carry reviewer machine:barcode-review-ai-v1 and association_basis
--     ai_review. Every other check in the function (same record, unshared SKUs, human precedence, freshness, brand, pack,
--     GTIN, own-label) is unchanged.
-- No price, mapping or existing approval is changed.

insert into public.pair_approval_policies(policy_version, description, rules) values (
  'barcode-review-ai-v1',
  'Exact product where a retailer''s own GTIN search returned exactly this SKU at REVIEW tier (wording differences only), accepted through an '
  || 'independent AI assessment plus deterministic SKU/brand/pack/variant/formulation checks (public.retailer_barcode_review_acceptances); all other '
  || 'barcode-exact-v1 requirements (same record, unshared SKUs, fresh direct captures, brand, pack, GTIN, own-label, human precedence) unchanged.',
  jsonb_build_object(
    'barcode', 'at least one side is an active AI-accepted review-tier association; any other non-Tesco side is strong or AI-accepted',
    'provenance', 'reviewer machine:barcode-review-ai-v1; machine_evidence.checks.association_basis = ai_review',
    'freshness_days', 12,
    'ai', 'recorded in the acceptance; must be verified_exact with every material fact true; wording only, never pack/variant/formulation'));

create table public.retailer_barcode_review_acceptances (
  id uuid primary key default gen_random_uuid(),
  policy_version text not null check (policy_version = 'barcode-review-ai-v1'),
  gtin text not null check (gtin ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13})$'),
  store text not null check (store in ('dunnes', 'supervalu')),
  sku text not null,
  observation_id uuid not null,
  origin_offer_id uuid not null references public.store_products(id) on delete restrict,
  retailer_offer_id uuid not null references public.store_products(id) on delete restrict,
  response_id uuid not null references public.retailer_identity_responses(id) on delete restrict,
  model_assessment jsonb not null check (jsonb_typeof(model_assessment) = 'object'),
  checks jsonb not null check (jsonb_typeof(checks) = 'object'),
  reason text not null check (length(trim(reason)) >= 40),
  accepted_at timestamptz not null default now(),
  foreign key (observation_id, gtin, store, sku) references public.retailer_barcode_observations (id, gtin, store, resolved_sku) on delete restrict,
  unique (observation_id)
);
create index retailer_barcode_review_acceptances_lookup on public.retailer_barcode_review_acceptances (gtin, store);
create function public.stamp_review_acceptance() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'barcode_review_acceptance_append_only'; end if;
  new.accepted_at := now(); return new;
end $$;
create trigger retailer_barcode_review_acceptances_stamp before insert or update or delete on public.retailer_barcode_review_acceptances
  for each row execute function public.stamp_review_acceptance();
create trigger retailer_barcode_review_acceptances_no_truncate before truncate on public.retailer_barcode_review_acceptances
  for each statement execute function public.prevent_barcode_evidence_rewrite();
alter table public.retailer_barcode_review_acceptances enable row level security;
revoke all on public.retailer_barcode_review_acceptances from public, anon, authenticated, service_role;
grant select on public.retailer_barcode_review_acceptances to service_role;
revoke all on function public.stamp_review_acceptance() from public, anon, authenticated, service_role;

create function public.accept_barcode_review_association(p_origin_offer uuid, p_gtin text, p_store text, p_offer uuid, p_response uuid,
  p_model jsonb, p_checks jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t record; o record; ob record; rs record; acc uuid; k text;
  g text := nullif(ltrim(btrim(coalesce(p_gtin, '')), '0'), '');
  own_label constant text := '^(dunnes( stores)?|supervalu|tesco|simply better|signature tastes)( |$)';
begin
  if g is null or p_gtin !~ '^[0-9]{8,14}$' or p_store not in ('dunnes', 'supervalu') or length(trim(coalesce(p_reason, ''))) < 40
     or jsonb_typeof(p_checks) is distinct from 'object' or jsonb_typeof(p_model) is distinct from 'object' then
    raise exception 'review acceptance needs GTIN, store, reason, checks and model assessment';
  end if;
  select id, product_id, store, store_sku into t from public.store_products where id = p_origin_offer;
  if t.id is null or t.store <> 'tesco' or t.product_id is null then raise exception 'origin is not a Tesco offer on a record'; end if;
  select id, product_id, store, store_sku into o from public.store_products where id = p_offer;
  if o.id is null or o.store <> p_store or o.store_sku is null or o.product_id is distinct from t.product_id then
    raise exception 'offer is not this retailer''s offer on the origin record';
  end if;
  if (select count(*) from public.store_products d where d.store = o.store and d.store_sku = o.store_sku) <> 1 then raise exception 'offer SKU is shared'; end if;
  -- The LATEST observation for this (gtin, store) must be a review-tier one from this origin that resolved exactly this SKU.
  select * into ob from public.retailer_barcode_observations x where ltrim(x.gtin, '0') = g and x.store = p_store
    order by x.observed_at desc, x.recorded_at desc limit 1;
  if ob.id is null or ob.tier is distinct from 'review' or ob.outcome <> 'identity_consistent' or ob.resolved_sku is distinct from o.store_sku
     or ob.gtin_origin_store_product_id is distinct from t.id or ob.gtin_origin_sku is distinct from t.store_sku then
    raise exception 'latest observation is not a review-tier resolution of this SKU from this origin';
  end if;
  if ob.observed_at < now() - interval '30 days' then raise exception 'review observation too old'; end if;
  -- The retailer's own SKU-bound capture of this offer.
  select * into rs from public.retailer_identity_responses r where r.id = p_response;
  if rs.id is null or rs.store_product_id <> o.id or rs.store <> o.store or rs.sku <> o.store_sku
     or rs.source_kind not in ('captured_product', 'captured_product_api') or rs.retrieved_at < now() - interval '7 days'
     or rs.retrieved_at > now() + interval '5 minutes' then
    raise exception 'SKU-bound retailer capture missing, mismatched or too old';
  end if;
  if nullif(btrim(coalesce(rs.identity->>'brand', '')), '') is null or (rs.identity->>'brand') ~* own_label or coalesce(rs.identity->>'title', '') ~* own_label then
    raise exception 'retailer brand missing or own-label';
  end if;
  -- Independent AI assessment: verified_exact with EVERY material fact true.
  if p_model->>'decision' is distinct from 'verified_exact' or jsonb_typeof(p_model->'facts') is distinct from 'object'
     or length(coalesce(p_model->>'rationale', '')) < 20 then
    raise exception 'AI assessment must be verified_exact with a rationale';
  end if;
  foreach k in array array['brand_matches', 'product_type_matches', 'flavour_formulation_matches', 'variant_matches', 'quantity_matches', 'pack_count_matches', 'age_stage_matches'] loop
    if (p_model->'facts'->>k) is distinct from 'true' then raise exception 'AI fact % is not true', k; end if;
  end loop;
  foreach k in array array['structural', 'wording_only', 'barcode_fresh_search'] loop
    if (p_checks->>k) is distinct from 'pass' then raise exception 'check % did not pass', k; end if;
  end loop;
  insert into public.retailer_barcode_review_acceptances(policy_version, gtin, store, sku, observation_id, origin_offer_id, retailer_offer_id,
      response_id, model_assessment, checks, reason)
    values ('barcode-review-ai-v1', ob.gtin, p_store, o.store_sku, ob.id, t.id, o.id, rs.id, p_model, p_checks, p_reason) returning id into acc;
  return acc;
end $$;
revoke all on function public.accept_barcode_review_association(uuid, text, text, uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.accept_barcode_review_association(uuid, text, text, uuid, uuid, jsonb, jsonb, text) to service_role;

create view public.current_barcode_review_acceptances with (security_invoker = true) as
select a.id, a.policy_version, a.gtin, a.store, a.sku, a.observation_id, a.origin_offer_id, a.retailer_offer_id, a.response_id, a.accepted_at,
  l.observed_at as last_verified_at,
  case
    when l.id is distinct from a.observation_id then 'suspended_observation_changed'
    when o.id is null or o.store_sku is distinct from a.sku or o.product_id is distinct from t.product_id then 'suspended_offer_changed'
    when l.observed_at < now() - interval '30 days' then 'stale_needs_reverification'
    else 'active'
  end as status
from public.retailer_barcode_review_acceptances a
join lateral (select x.id, x.observed_at from public.retailer_barcode_observations x
  where x.gtin = a.gtin and x.store = a.store order by x.observed_at desc, x.recorded_at desc limit 1) l on true
left join public.store_products t on t.id = a.origin_offer_id
left join public.store_products o on o.id = a.retailer_offer_id;
revoke all on public.current_barcode_review_acceptances from public, anon, authenticated, service_role;
grant select on public.current_barcode_review_acceptances to service_role;

create view public.current_machine_associations with (security_invoker = true) as
select c.gtin, c.store, c.resolved_sku, c.status, c.gtin_origin_store_product_id, 'strong'::text as basis
from public.current_barcode_associations c
union all
select v.gtin, v.store, v.sku, v.status, v.origin_offer_id, 'ai_review'::text
from public.current_barcode_review_acceptances v;
revoke all on public.current_machine_associations from public, anon, authenticated, service_role;
grant select on public.current_machine_associations to service_role;

-- record_machine_pair_approval: identical to 20261122090000 except it reads current_machine_associations (basis-aware).
create or replace function public.record_machine_pair_approval(
  p_policy_version text, p_offer_a uuid, p_offer_b uuid, p_source_a uuid, p_source_b uuid, p_gtin text,
  p_checks jsonb, p_rationale text, p_model_assessment jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a record; b record; l record; r record; t record; x record;
  sa record; sb record; review_id uuid; v jsonb;
  g text := nullif(ltrim(btrim(coalesce(p_gtin, '')), '0'), '');
  v_bases text[] := case when p_policy_version = 'barcode-review-ai-v1' then array['strong', 'ai_review'] else array['strong'] end;
  own_label constant text := '^(dunnes( stores)?|supervalu|tesco|simply better|signature tastes)( |$)';
begin
  if not exists (select 1 from public.pair_approval_policies where policy_version = p_policy_version) then
    raise exception 'unknown machine policy %', p_policy_version;
  end if;
  if g is null or p_gtin !~ '^[0-9]{8,14}$' then raise exception 'machine approval needs a GTIN'; end if;
  if jsonb_typeof(p_checks) is distinct from 'object' or jsonb_typeof(p_model_assessment) is distinct from 'object' then
    raise exception 'checks and model assessment must be objects';
  end if;
  if coalesce(p_model_assessment->>'verdict', 'none') not in ('none', 'exact') then
    raise exception 'a model verdict other than exact can never be approved';
  end if;
  -- The review policy approves ONLY a pair in which at least one side's association is an AI-accepted REVIEW-tier
  -- association (public.retailer_barcode_review_acceptances); its ledger rows say so in reviewer and machine_evidence.
  if p_policy_version = 'barcode-review-ai-v1' and p_checks->>'association_basis' is distinct from 'ai_review' then
    raise exception 'review policy needs association_basis ai_review';
  end if;
  select id, product_id, store, store_sku into a from public.store_products where id = p_offer_a;
  select id, product_id, store, store_sku into b from public.store_products where id = p_offer_b;
  if a.id is null or b.id is null or a.store = b.store then raise exception 'two offers of different retailers required'; end if;
  if a.product_id is null or a.product_id is distinct from b.product_id then raise exception 'offers are not on the same catalogue record'; end if;
  -- A human decision on this pair (of any classification) always takes precedence: the machine never overrides
  -- or re-approves it. Changing such a pair is a human exception.
  if exists (select 1 from public.retailer_offer_pair_reviews h where h.decision_kind = 'human'
      and h.left_offer_id = least(a.id::text, b.id::text)::uuid and h.right_offer_id = greatest(a.id::text, b.id::text)::uuid) then
    raise exception 'a human decision exists for this pair';
  end if;
  if a.store_sku is null or b.store_sku is null
     or (select count(*) from public.store_products d where d.store = a.store and d.store_sku = a.store_sku) <> 1
     or (select count(*) from public.store_products d where d.store = b.store and d.store_sku = b.store_sku) <> 1 then
    raise exception 'offer SKU missing or shared';
  end if;
  -- Barcode association, re-read from the append-only evidence (never the caller): an active strong association
  -- whose GTIN origin is a Tesco offer of this record and whose resolved SKU is the non-Tesco offer's SKU.
  for x in select * from (values (a.id, a.store, a.store_sku), (b.id, b.store, b.store_sku)) s(id, store, sku) where s.store <> 'tesco' loop
    if not exists (select 1 from public.current_machine_associations c
        join public.store_products o on o.id = c.gtin_origin_store_product_id
        where ltrim(c.gtin, '0') = g and c.store = x.store and c.resolved_sku = x.sku and c.status = 'active' and c.basis = any(v_bases)
          and o.store = 'tesco' and o.product_id = a.product_id
          and (a.store <> 'tesco' or o.id = a.id) and (b.store <> 'tesco' or o.id = b.id)) then
      raise exception 'no active barcode association for % SKU %', x.store, x.sku;
    end if;
  end loop;
  -- Without a Tesco side, the origin Tesco offer's own recent page must state this GTIN (for a Tesco side the
  -- stamped page identity is checked below).
  -- Both sides' associations must come from the SAME origin Tesco offer, and that offer's page must state the GTIN.
  if a.store <> 'tesco' and b.store <> 'tesco' and not exists (
      select 1 from public.current_machine_associations c
      join public.current_machine_associations c2 on c2.gtin_origin_store_product_id = c.gtin_origin_store_product_id
        and ltrim(c2.gtin, '0') = g and c2.store = b.store and c2.resolved_sku = b.store_sku and c2.status = 'active' and c2.basis = any(v_bases)
      join public.store_products o on o.id = c.gtin_origin_store_product_id
      join public.tesco_direct_collection_pages p on p.requested_url = 'https://www.tesco.ie/shop/en-IE/products/' || o.store_sku
      where ltrim(c.gtin, '0') = g and c.store = a.store and c.resolved_sku = a.store_sku and c.status = 'active' and c.basis = any(v_bases)
        and p.outcome = 'ok' and p.http_status = 200 and p.created_at >= now() - interval '12 days'
        and nullif(ltrim(public.tesco_page_projection(p.parsed, o.store_sku)->>'gtin', '0'), '') = g) then
    raise exception 'origin Tesco page does not state the GTIN';
  end if;
  if p_policy_version = 'barcode-review-ai-v1' and not exists (
      select 1 from public.current_barcode_review_acceptances v
      where v.status = 'active' and ltrim(v.gtin, '0') = g and v.retailer_offer_id in (a.id, b.id)) then
    raise exception 'no active AI-accepted review association for this pair';
  end if;
  -- Sources: the kind follows the offer's store; hash and capture time come from the source row itself.
  for x in select * from (values ('a', a.store, p_source_a), ('b', b.store, p_source_b)) s(which, store, src) loop
    if x.store = 'tesco' then
      select 'tesco_page'::text as kind, p.id, p.body_sha256 as hash, p.created_at as at into t
        from public.tesco_direct_collection_pages p where p.id = x.src;
    else
      select 'retailer_response'::text as kind, e.id, e.body_sha256 as hash, e.retrieved_at as at into t
        from public.retailer_identity_responses e where e.id = x.src;
    end if;
    if t.id is null then raise exception 'source % not found', x.which; end if;
    if t.at < now() - interval '12 days' then raise exception 'source % older than the machine freshness limit', x.which; end if;
    if x.which = 'a' then sa := t; else sb := t; end if;
  end loop;
  if a.id::text < b.id::text then l := a; r := b; else l := b; r := a; end if;
  insert into public.retailer_offer_pair_reviews(left_offer_id, right_offer_id, classification,
      left_source_kind, left_source_id, left_source_hash, left_captured_at,
      right_source_kind, right_source_id, right_source_hash, right_captured_at,
      rationale, reviewer, checked_attributes, model_assessment, decision_kind, policy_version, machine_evidence)
    values (l.id, r.id, 'exact_product',
      case when l.id = a.id then sa.kind else sb.kind end, case when l.id = a.id then sa.id else sb.id end,
      case when l.id = a.id then sa.hash else sb.hash end, case when l.id = a.id then sa.at else sb.at end,
      case when r.id = a.id then sa.kind else sb.kind end, case when r.id = a.id then sa.id else sb.id end,
      case when r.id = a.id then sa.hash else sb.hash end, case when r.id = a.id then sa.at else sb.at end,
      p_rationale, 'machine:' || p_policy_version,
      '["gtin_barcode_search","sku_binding","source_freshness","manufacturer_brand","retail_pack","variant","formulation","own_label_absent"]'::jsonb,
      p_model_assessment, 'machine', p_policy_version,
      jsonb_build_object('gtin', g, 'checks', p_checks, 'source_a', p_source_a, 'source_b', p_source_b))
    returning id into review_id;
  -- Material identity contradictions in the identities the triggers just stamped from the evidence itself.
  select left_identity, right_identity into x from public.retailer_offer_pair_reviews where id = review_id;
  if (x.left_identity->>'brand') is null or (x.right_identity->>'brand') is null
     or not (x.left_identity->>'brand' = x.right_identity->>'brand'
             or starts_with(x.left_identity->>'brand', (x.right_identity->>'brand') || ' ')
             or starts_with(x.right_identity->>'brand', (x.left_identity->>'brand') || ' ')) then
    raise exception 'manufacturer brand contradiction or missing';
  end if;
  if (x.left_identity->>'brand') ~ own_label or (x.right_identity->>'brand') ~ own_label
     or (x.left_identity->>'title') ~ own_label or (x.right_identity->>'title') ~ own_label then
    raise exception 'own-label product cannot be a cross-retailer exact match';
  end if;
  if x.left_identity ? 'pack' and x.right_identity ? 'pack' and x.left_identity->>'pack' <> x.right_identity->>'pack' then
    raise exception 'retail pack contradiction';
  end if;
  if (l.store = 'tesco' and not (x.left_identity ? 'gtin')) or (r.store = 'tesco' and not (x.right_identity ? 'gtin')) then
    raise exception 'Tesco page does not state the GTIN';
  end if;
  foreach v in array array[x.left_identity, x.right_identity] loop
    if v ? 'gtin' and v->>'gtin' <> g then raise exception 'GTIN contradiction'; end if;
  end loop;
  insert into public.machine_pair_decisions(policy_version, left_offer_id, right_offer_id, gtin, decision, reasons, evidence, model_assessment, review_id)
    values (p_policy_version, l.id, r.id, g, 'approved', '[]'::jsonb, jsonb_build_object('checks', p_checks), p_model_assessment, review_id);
  return review_id;
end $$;
revoke all on function public.record_machine_pair_approval(text, uuid, uuid, uuid, uuid, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_machine_pair_approval(text, uuid, uuid, uuid, uuid, text, jsonb, text, jsonb) to service_role;
