-- Machine pair approvals (owner decision, 22 Nov 2026): routine exact relationships are approved by a versioned,
-- tested MACHINE POLICY instead of a human, through the SAME protected pair-review ledger.
--
-- What changes:
--   1. `pair_approval_policies`: append-only registry of machine policies. A policy can only be added by a
--      migration (human-controlled release). Approvals name the policy version they satisfied.
--   2. `retailer_offer_pair_reviews` gains `decision_kind` ('human' | 'machine'), `policy_version` and
--      `machine_evidence`. A machine row is explicitly identified: reviewer = 'machine:<policy_version>', and a
--      human row can never use the 'machine:' prefix (no spoofing in either direction).
--   3. `record_machine_pair_approval(...)` (SECURITY DEFINER, service_role only) is the ONLY machine write path.
--      It re-derives every binding in the database (never trusting the caller), then INSERTS into the ledger,
--      so the existing validate_offer_pair_review (SKU binding, 14-day horizon, distinct retailers) and
--      stamp_offer_pair_review_identity (monitorable identity) triggers fire unchanged. It then checks the
--      stamped identities (brand, pack, GTIN) and raises (rolling back) on any material contradiction.
--   4. `machine_pair_decisions`: append-only audit of EVERY machine decision (approved, rejected, held).
--   5. Dunnes: its SKU-bound product API (`.../api/stores/258/products/<sku>`) becomes an accepted direct source
--      (`retailer_identity_responses.source_kind = 'captured_product_api'`), for binding and for monitoring.
-- Unchanged: service_role still cannot insert into the ledger directly; reviews stay immutable; durable
-- monitoring (current_pair_review_status) suspends a machine approval exactly like a human one.

-- 1. Policy registry -------------------------------------------------------------------------------------------
create table public.pair_approval_policies (
  policy_version text primary key check (policy_version ~ '^[a-z0-9][a-z0-9.-]{2,59}$'),
  description text not null check (length(trim(description)) >= 40),
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_at timestamptz not null default now()
);
create function public.prevent_policy_rewrite() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'pair approval policies are append-only'; end $$;
create trigger pair_approval_policies_immutable before update or delete on public.pair_approval_policies
  for each row execute function public.prevent_policy_rewrite();
alter table public.pair_approval_policies enable row level security;
revoke all on public.pair_approval_policies from public, anon, authenticated, service_role;
grant select on public.pair_approval_policies to service_role;
revoke all on function public.prevent_policy_rewrite() from public, anon, authenticated, service_role;

insert into public.pair_approval_policies(policy_version, description, rules) values (
  'barcode-exact-v1',
  'Exact product: the non-Tesco retailer''s own search resolved exactly this SKU for the GTIN that the Tesco product page itself states; '
  || 'both offers are on the same catalogue record with unshared SKUs; fresh direct captures on both sides; same manufacturer brand; '
  || 'same stated retail pack; no stated variant, formulation, pack or own-label contradiction (src/lib/machine-pair-approval.ts).',
  jsonb_build_object(
    'barcode', 'active strong barcode association: GTIN origin = the Tesco offer, resolved SKU = the other offer''s SKU; the Tesco page states the same GTIN',
    'binding', 'same product_id; each SKU used by exactly one offer of its store; ledger trigger binds each source to its offer',
    'freshness_days', 12,
    'deterministic', 'assessBarcodeHit strong (brand, product words, variant groups, numbers, containers, pack) and comparison-policy deterministicDifference = null',
    'database', 'stamped brands agree, stamped packs agree when both stated, stamped GTINs agree with the association when stated, neither brand own-label',
    'ai', 'not used by v1; a model may only ever hold or reject, never approve'));

-- 2. Explicit machine identity on the ledger -------------------------------------------------------------------
alter table public.retailer_offer_pair_reviews
  add column decision_kind text not null default 'human' check (decision_kind in ('human', 'machine')),
  add column policy_version text references public.pair_approval_policies(policy_version),
  add column machine_evidence jsonb check (machine_evidence is null or jsonb_typeof(machine_evidence) = 'object');
alter table public.retailer_offer_pair_reviews add constraint machine_decision_identified check (
  (decision_kind = 'machine') = (reviewer like 'machine:%')
  and (decision_kind = 'human' or (policy_version is not null and reviewer = 'machine:' || policy_version
       and machine_evidence is not null and machine_evidence ? 'gtin' and machine_evidence ? 'checks')));

-- 5. Dunnes SKU-bound product API as a direct source -----------------------------------------------------------
alter table public.retailer_identity_responses drop constraint retailer_identity_responses_source_kind_check;
alter table public.retailer_identity_responses add constraint retailer_identity_responses_source_kind_check
  check (source_kind in ('captured_product', 'captured_listing', 'captured_product_api')
    and (source_kind <> 'captured_product_api' or (store = 'dunnes'
      and requested_url = 'https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/products/' || sku
      and final_url = requested_url)));

-- validate_offer_pair_review: identical to 20261103141000 except that a Dunnes side may also bind to a
-- `captured_product_api` response of its own SKU-bound product API URL.
create or replace function public.validate_offer_pair_review() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $body$
declare
  side record;
  mapped record;
  valid_capture boolean;
begin
  if tg_op <> 'INSERT' then raise exception 'comparison reviews are immutable'; end if;
  if new.reviewed_at > now() or new.reviewed_at < now() - interval '14 days' then
    raise exception 'comparison review timestamp invalid';
  end if;
  if (select store from public.store_products where id=new.left_offer_id) =
     (select store from public.store_products where id=new.right_offer_id) then
    raise exception 'pair must represent different retailers';
  end if;
  for side in
    select new.left_offer_id as offer_id,new.left_source_kind as kind,
           new.left_source_id as source_id,new.left_source_hash as hash,
           new.left_captured_at as captured_at
    union all
    select new.right_offer_id,new.right_source_kind,
           new.right_source_id,new.right_source_hash,new.right_captured_at
  loop
    if side.source_id is null then
      if new.classification in ('exact_product','comparable_alternative') then
        raise exception 'positive comparison missing direct capture';
      end if;
      continue;
    end if;
    select store,store_sku into mapped from public.store_products where id=side.offer_id;
    valid_capture := false;
    if mapped.store='tesco' and side.kind='tesco_page' then
      select exists(
        select 1 from public.tesco_direct_collection_pages p
        where p.id=side.source_id and p.outcome='ok' and p.http_status=200
          and p.body_sha256=side.hash and p.created_at=side.captured_at
          and (strpos(p.requested_url,mapped.store_sku)>0 or strpos(p.final_url,mapped.store_sku)>0)
      ) into valid_capture;
    elsif mapped.store in ('dunnes','supervalu') and side.kind='retailer_response' then
      select exists(
        select 1 from public.retailer_identity_responses e
        where e.id=side.source_id and e.store_product_id=side.offer_id
          and e.store=mapped.store and e.sku=mapped.store_sku
          and (e.source_kind='captured_product'
               or (mapped.store='dunnes' and e.source_kind='captured_product_api'
                   and e.requested_url='https://storefrontgateway.dunnesstoresgrocery.com/api/stores/258/products/'||mapped.store_sku
                   and e.final_url=e.requested_url))
          and e.body_sha256=side.hash and e.retrieved_at=side.captured_at
      ) into valid_capture;
    end if;
    if not valid_capture then raise exception 'comparison evidence does not bind to offer'; end if;
    if side.captured_at > now() or side.captured_at < now() - interval '14 days' then
      raise exception 'comparison capture outside evidence horizon';
    end if;
  end loop;
  return new;
end $body$;
revoke all on function public.validate_offer_pair_review() from public, anon, authenticated, service_role;

-- 4. Audit of every machine decision ---------------------------------------------------------------------------
create table public.machine_pair_decisions (
  id uuid primary key default gen_random_uuid(),
  policy_version text not null references public.pair_approval_policies(policy_version),
  left_offer_id uuid not null references public.store_products(id),
  right_offer_id uuid not null references public.store_products(id),
  gtin text,
  decision text not null check (decision in ('approved', 'rejected', 'held')),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  model_assessment jsonb not null default '{}'::jsonb check (jsonb_typeof(model_assessment) = 'object'),
  review_id uuid references public.retailer_offer_pair_reviews(id),
  decided_at timestamptz not null default now(),
  check ((decision = 'approved') = (review_id is not null)),
  check (decision = 'approved' or jsonb_array_length(reasons) > 0)
);
create index machine_pair_decisions_pair on public.machine_pair_decisions(left_offer_id, right_offer_id, decided_at desc);
create function public.prevent_machine_decision_rewrite() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'machine pair decisions are append-only'; end if;
  new.decided_at := now();
  -- An "approved" audit row can only be written by record_machine_pair_approval, inside its own transaction.
  if new.decision = 'approved' and not exists (select 1 from public.retailer_offer_pair_reviews r
      where r.id = new.review_id and r.decision_kind = 'machine' and r.policy_version = new.policy_version) then
    raise exception 'approved decision must reference its machine review';
  end if;
  return new;
end $$;
create trigger machine_pair_decisions_append_only before insert or update or delete on public.machine_pair_decisions
  for each row execute function public.prevent_machine_decision_rewrite();
create trigger machine_pair_decisions_no_truncate before truncate on public.machine_pair_decisions
  for each statement execute function public.prevent_policy_rewrite();
alter table public.machine_pair_decisions enable row level security;
revoke all on public.machine_pair_decisions from public, anon, authenticated, service_role;
grant select, insert on public.machine_pair_decisions to service_role;
revoke all on function public.prevent_machine_decision_rewrite() from public, anon, authenticated, service_role;

-- 3. The machine write path ------------------------------------------------------------------------------------
-- The caller names the two offers, the two source rows, the GTIN, the policy and its own (TS) check results.
-- Everything that decides validity is re-derived here; the ledger triggers then bind and stamp as for a human.
create function public.record_machine_pair_approval(
  p_policy_version text, p_offer_a uuid, p_offer_b uuid, p_source_a uuid, p_source_b uuid, p_gtin text,
  p_checks jsonb, p_rationale text, p_model_assessment jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a record; b record; l record; r record; t record; x record;
  sa record; sb record; review_id uuid; v jsonb;
  g text := nullif(ltrim(btrim(coalesce(p_gtin, '')), '0'), '');
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
  select id, product_id, store, store_sku into a from public.store_products where id = p_offer_a;
  select id, product_id, store, store_sku into b from public.store_products where id = p_offer_b;
  if a.id is null or b.id is null or a.store = b.store then raise exception 'two offers of different retailers required'; end if;
  if a.product_id is null or a.product_id is distinct from b.product_id then raise exception 'offers are not on the same catalogue record'; end if;
  if a.store_sku is null or b.store_sku is null
     or (select count(*) from public.store_products d where d.store = a.store and d.store_sku = a.store_sku) <> 1
     or (select count(*) from public.store_products d where d.store = b.store and d.store_sku = b.store_sku) <> 1 then
    raise exception 'offer SKU missing or shared';
  end if;
  -- Barcode association, re-read from the append-only evidence (never the caller): an active strong association
  -- whose GTIN origin is a Tesco offer of this record and whose resolved SKU is the non-Tesco offer's SKU.
  for x in select * from (values (a.id, a.store, a.store_sku), (b.id, b.store, b.store_sku)) s(id, store, sku) where s.store <> 'tesco' loop
    if not exists (select 1 from public.current_barcode_associations c
        join public.store_products o on o.id = c.gtin_origin_store_product_id
        where ltrim(c.gtin, '0') = g and c.store = x.store and c.resolved_sku = x.sku and c.status = 'active'
          and o.store = 'tesco' and o.product_id = a.product_id
          and (a.store <> 'tesco' or o.id = a.id) and (b.store <> 'tesco' or o.id = b.id)) then
      raise exception 'no active barcode association for % SKU %', x.store, x.sku;
    end if;
  end loop;
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
     or not (starts_with(x.left_identity->>'brand', x.right_identity->>'brand') or starts_with(x.right_identity->>'brand', x.left_identity->>'brand')) then
    raise exception 'manufacturer brand contradiction or missing';
  end if;
  if (x.left_identity->>'brand') ~ own_label or (x.right_identity->>'brand') ~ own_label
     or (x.left_identity->>'title') ~ own_label or (x.right_identity->>'title') ~ own_label then
    raise exception 'own-label product cannot be a cross-retailer exact match';
  end if;
  if x.left_identity ? 'pack' and x.right_identity ? 'pack' and x.left_identity->>'pack' <> x.right_identity->>'pack' then
    raise exception 'retail pack contradiction';
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
comment on function public.record_machine_pair_approval(text, uuid, uuid, uuid, uuid, text, jsonb, text, jsonb) is
  'The only machine write path into retailer_offer_pair_reviews: re-derives barcode association, catalogue binding and sources, inserts through the unchanged ledger triggers, then rejects stamped brand/pack/GTIN/own-label contradictions.';
comment on table public.retailer_offer_pair_reviews is
  'Immutable pairwise review ledger. Human rows: protected postgres operator. Machine rows: record_machine_pair_approval only, reviewer machine:<policy_version>.';

-- Durable monitoring also reads Dunnes SKU-bound product API captures (same projection, same rules).
create or replace function public.current_pair_review_status(p_now timestamptz default now(), p_active_only boolean default false)
returns table (
  left_offer_id uuid, right_offer_id uuid, classification text,
  left_source_hash text, right_source_hash text,
  left_evidence_at timestamptz, right_evidence_at timestamptz,
  reviewed_at timestamptz, rationale text, reviewer text,
  status text
)
language sql stable security invoker set search_path = '' as $$
  with latest as (
    select distinct on (r.left_offer_id, r.right_offer_id) r.*
    from public.retailer_offer_pair_reviews r
    where r.reviewed_at <= p_now
    order by r.left_offer_id, r.right_offer_id, r.reviewed_at desc, r.created_at desc, r.id desc
  ),
  sides as (
    select l.left_offer_id as l_id, l.right_offer_id as r_id, s.which, s.offer_id, s.sku, s.approved, s.src_at
    from latest l
    cross join lateral (values
      ('left', l.left_offer_id, l.left_sku, l.left_identity, l.left_captured_at),
      ('right', l.right_offer_id, l.right_sku, l.right_identity, l.right_captured_at)
    ) as s(which, offer_id, sku, approved, src_at)
    where l.classification in ('exact_product', 'comparable_alternative')
  ),
  observed as (
    select x.l_id, x.r_id, x.which, v.at, v.projection, v.sku
    from sides x
    join public.store_products sp on sp.id = x.offer_id
    cross join lateral (
      select x.src_at as at, x.approved as projection, x.sku as sku
      union all
      select p.created_at, public.tesco_page_projection(p.parsed, sp.store_sku), sp.store_sku
      from public.tesco_direct_collection_pages p
      where sp.store = 'tesco' and p.outcome = 'ok' and p.http_status = 200 and p.body_sha256 is not null
        and p.created_at >= x.src_at and p.created_at <= p_now
        and p.requested_url = 'https://www.tesco.ie/shop/en-IE/products/' || sp.store_sku
      union all
      select e.retrieved_at, public.retailer_identity_projection(e.identity), e.sku
      from public.retailer_identity_responses e
      where e.store_product_id = sp.id
        and (e.source_kind = 'captured_product' or (sp.store = 'dunnes' and e.source_kind = 'captured_product_api'))
        and e.retrieved_at >= x.src_at and e.retrieved_at <= p_now
      union all
      select o.observed_at, o.identity_projection, o.sku
      from public.retailer_identity_observations o
      where o.store_product_id = sp.id and o.observed_at >= x.src_at and o.observed_at <= p_now
    ) v
    where v.projection ? 'title'
  ),
  per_side as (
    select x.l_id, x.r_id, x.which,
      (select max(o.at) from observed o where o.l_id = x.l_id and o.r_id = x.r_id and o.which = x.which
         and o.sku = x.sku and public.identity_usable(o.projection)) as evidence_at,
      case
        when x.sku is null or x.approved is null then 'suspended_unmonitorable'
        when sp.store_sku is distinct from x.sku
          or (select count(*) from public.store_products d where d.store = sp.store and d.store_sku = sp.store_sku) <> 1
          or exists (select 1 from observed o where o.l_id = x.l_id and o.r_id = x.r_id and o.which = x.which and o.sku is distinct from x.sku)
          then 'suspended_sku_changed'
        when exists (select 1 from observed o where o.l_id = x.l_id and o.r_id = x.r_id and o.which = x.which
                     and public.identity_changed(x.approved, o.projection)) then 'suspended_identity_changed'
        when coalesce((select max(o.at) from observed o where o.l_id = x.l_id and o.r_id = x.r_id and o.which = x.which
                         and o.sku = x.sku and public.identity_usable(o.projection)), '-infinity')
          < p_now - interval '14 days' then 'suspended_no_recent_evidence'
        else 'active'
      end as side_status
    from sides x
    left join public.store_products sp on sp.id = x.offer_id
  ),
  result as (
    select l.left_offer_id, l.right_offer_id, l.classification, l.left_source_hash, l.right_source_hash,
      max(s.evidence_at) filter (where s.which = 'left') as left_evidence_at,
      max(s.evidence_at) filter (where s.which = 'right') as right_evidence_at,
      l.reviewed_at, l.rationale, l.reviewer,
      case
        when l.reviewed_at < p_now - interval '365 days' then 'expired_needs_review'
        when count(s.*) <> 2 then 'suspended_unmonitorable'
        when bool_or(s.side_status = 'suspended_sku_changed') then 'suspended_sku_changed'
        when bool_or(s.side_status = 'suspended_unmonitorable') then 'suspended_unmonitorable'
        when bool_or(s.side_status = 'suspended_identity_changed') then 'suspended_identity_changed'
        when bool_or(s.side_status = 'suspended_no_recent_evidence') then 'suspended_no_recent_evidence'
        else 'active'
      end as status
    from latest l
    left join per_side s on s.l_id = l.left_offer_id and s.r_id = l.right_offer_id
    where l.classification in ('exact_product', 'comparable_alternative')
    group by l.left_offer_id, l.right_offer_id, l.classification, l.left_source_hash, l.right_source_hash,
      l.reviewed_at, l.rationale, l.reviewer
  )
  select * from result where not p_active_only or status = 'active'
  order by left_offer_id, right_offer_id
$$;
revoke all on function public.current_pair_review_status(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.current_pair_review_status(timestamptz, boolean) to service_role;
