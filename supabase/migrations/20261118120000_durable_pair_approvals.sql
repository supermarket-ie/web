-- Durable pair approvals (owner-requested, 18 Nov 2026).
--
-- An approved pair review stays in force while BOTH offers' identities stay unchanged, instead of expiring
-- 14 days after review. Routine captures provide monitoring evidence:
--   * SuperValu/Dunnes: lightweight identity OBSERVATIONS (body hash + parsed identity, no body), written by the
--     price worker from the page it already fetches. Trust root: the worker (as for prices); the database binds
--     each observation to the offer as it is now.
--   * Tesco: the existing ok/200 tesco_direct_collection_pages for the offer's exact product URL.
-- The approval itself still requires full, fresh, offer-bound evidence at insert (unchanged
-- validate_offer_pair_review trigger) and is never created, edited or upgraded here.
--
-- A pair is ACTIVE only while, for each side:
--   * the offer's current store_sku equals the approved SKU and no other offer of that store uses it;
--   * NO observation since approval contradicts the approved identity on any stated attribute (STICKY: a change
--     that later reverts still needs a new human review);
--   * the latest usable observation (or the approval's own evidence) is <= 14 days old;
-- and the review is <= 365 days old. Otherwise it is SUSPENDED with a reason (the re-review queue).

-- 1. Identity projections, computed in the database from stored evidence (never supplied by a caller).
--    Attributes are compared one by one: an attribute absent from one source is not a change.
-- NOTE: changing any projection function changes live-recomputed projections; it must ship with a migration that
-- re-stamps approvals, or every affected pair suspends (fails closed).
create function public.identity_norm(t text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(
    translate(replace(replace(replace(lower(coalesce(t, '')), '½', ' 1/2 '), '¼', ' 1/4 '), '¾', ' 3/4 '),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'),
    '[^a-z0-9/]+', ' ', 'g')), '')
$$;

-- A numeric value or null (never raises on malformed retailer data).
create function public.identity_num(t text) returns numeric
language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(t, '')) ~ '^[0-9]+(\.[0-9]+)?$' then btrim(t)::numeric end
$$;

-- Structured pack as "<amount><g|ml|each>" from Tesco quantity / packSize, or null.
create function public.identity_pack(quantity jsonb, pack_size jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(
    case when public.identity_num(quantity->>'grams') is not null then trim_scale(round(public.identity_num(quantity->>'grams'), 3))::text || 'g'
         when public.identity_num(quantity->>'millilitres') is not null then trim_scale(round(public.identity_num(quantity->>'millilitres'), 3))::text || 'ml' end,
    (select case upper(p->>'units')
        when 'G' then trim_scale(round(public.identity_num(p->>'value'), 3))::text || 'g'
        when 'KG' then trim_scale(round(public.identity_num(p->>'value') * 1000, 3))::text || 'g'
        when 'ML' then trim_scale(round(public.identity_num(p->>'value'), 3))::text || 'ml'
        when 'L' then trim_scale(round(public.identity_num(p->>'value') * 1000, 3))::text || 'ml'
        when 'CL' then trim_scale(round(public.identity_num(p->>'value') * 10, 3))::text || 'ml' else null end
     from jsonb_array_elements(case when jsonb_typeof(pack_size) = 'array' then pack_size else '[]'::jsonb end) p
     where jsonb_typeof(p) = 'object' limit 1))
$$;

-- SuperValu / Dunnes parsed identity (retailer_identity_responses.identity / observations.identity).
-- Marketing description is excluded (frequent cosmetic edits); ingredients are included (formulation).
create function public.retailer_identity_projection(identity jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', public.identity_norm(identity->>'title'),
    'brand', public.identity_norm(identity->>'brand'),
    'manufacturer', public.identity_norm(identity->>'manufacturer'),
    'mpn', public.identity_norm(identity->>'manufacturerProductCode'),
    'gtin', nullif(ltrim(btrim(coalesce(identity->>'gtin', '')), '0'), ''),
    'pack', public.identity_pack(case when jsonb_typeof(identity->'quantity') = 'object' then identity->'quantity' else '{}'::jsonb end, identity->'packSize'),
    'variant', public.identity_norm(identity->>'variant'),
    'flavour', public.identity_norm(identity->>'flavour'),
    'formulation', public.identity_norm(identity->>'formulation'),
    'ingredients', public.identity_norm(identity->>'ingredients')))
$$;

-- Tesco page: the parsed product with this exact SKU.
create function public.tesco_page_projection(parsed jsonb, sku text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', public.identity_norm(p->>'name'),
    'brand', public.identity_norm(p->>'brand'),
    'gtin', nullif(ltrim(btrim(coalesce(p->>'gtin', '')), '0'), ''),
    'pack', public.identity_pack(coalesce(p->'quantity', '{}'::jsonb), p->'identityDetails'->'packSize'),
    'ingredients', public.identity_norm(p->'identityDetails'->>'ingredients')))
  from jsonb_array_elements(coalesce(parsed->'products', '[]'::jsonb)) p
  where p->>'sku' = sku
  limit 1
$$;

-- A projection is usable only with a title and brand.
create function public.identity_usable(v jsonb) returns boolean
language sql immutable set search_path = '' as $$ select v ? 'title' and v ? 'brand' $$;

-- Material change: any attribute stated in BOTH projections differs.
create function public.identity_changed(approved jsonb, observed jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_each_text(approved) a join jsonb_each_text(observed) o on o.key = a.key where o.value <> a.value)
$$;

revoke all on function public.identity_norm(text), public.identity_num(text), public.identity_pack(jsonb, jsonb), public.retailer_identity_projection(jsonb),
  public.tesco_page_projection(jsonb, text), public.identity_usable(jsonb), public.identity_changed(jsonb, jsonb)
  from public, anon, authenticated;

-- 2. Approval-time identity, stamped by the database on insert (after the existing validation trigger).
alter table public.retailer_offer_pair_reviews
  add column left_sku text, add column right_sku text,
  add column left_identity jsonb, add column right_identity jsonb;

create function public.stamp_offer_pair_review_identity() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare side record; sku text; v jsonb;
begin
  for side in
    select 'left' as which, new.left_offer_id as offer_id, new.left_source_kind as kind, new.left_source_id as source_id
    union all
    select 'right', new.right_offer_id, new.right_source_kind, new.right_source_id
  loop
    sku := null; v := null;
    if side.kind = 'tesco_page' then
      select sp.store_sku, public.tesco_page_projection(p.parsed, sp.store_sku) into sku, v
      from public.store_products sp join public.tesco_direct_collection_pages p on p.id = side.source_id
      where sp.id = side.offer_id;
    elsif side.kind = 'retailer_response' then
      select e.sku, public.retailer_identity_projection(e.identity) into sku, v
      from public.retailer_identity_responses e where e.id = side.source_id;
    end if;
    -- A positive decision must be monitorable from its own evidence; never insert a silently dead approval.
    if new.classification in ('exact_product', 'comparable_alternative') and (sku is null or v is null or not public.identity_usable(v)) then
      raise exception 'comparison evidence has no monitorable identity (%)', side.which;
    end if;
    if side.which = 'left' then new.left_sku := sku; new.left_identity := v;
    else new.right_sku := sku; new.right_identity := v; end if;
  end loop;
  return new;
end $$;
-- Trigger names fire alphabetically: "zz_" runs after validate_offer_pair_review.
create trigger zz_stamp_offer_pair_review_identity before insert on public.retailer_offer_pair_reviews
  for each row execute function public.stamp_offer_pair_review_identity();
revoke all on function public.stamp_offer_pair_review_identity() from public, anon, authenticated, service_role;

-- 3. Lightweight identity observations (SuperValu/Dunnes), only for offers in a positive pair decision.
create table public.retailer_identity_observations (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null references public.store_products(id),
  store text not null check (store in ('supervalu', 'dunnes')),
  sku text not null check (sku ~ '^[0-9]{5,14}$'),
  source_kind text not null check (source_kind = 'captured_product'),
  product_url text not null,
  requested_url text not null,
  final_url text not null,
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  parser_version text not null check (parser_version = 'retailer-identity-response-v3'),
  identity jsonb not null check (jsonb_typeof(identity) = 'object' and length(coalesce(identity->>'title', '')) > 0),
  identity_projection jsonb,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  run_uuid uuid
);
create index retailer_identity_observations_offer on public.retailer_identity_observations(store_product_id, observed_at desc);

create function public.bind_identity_observation() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare mapped record; last record;
begin
  if tg_op <> 'INSERT' then raise exception 'identity observations are immutable'; end if;
  select store, store_sku, store_url into mapped from public.store_products where id = new.store_product_id;
  -- Bound to the offer as it is NOW: same store, same SKU, its own product URL fetched directly.
  if mapped is null or mapped.store <> new.store or mapped.store_sku is distinct from new.sku
     or new.product_url is distinct from mapped.store_url
     or new.requested_url <> new.product_url or new.final_url <> new.product_url then
    raise exception 'identity observation does not bind to offer';
  end if;
  -- Live observations only: no backfilled or future-dated monitoring evidence.
  if new.observed_at > now() + interval '5 minutes' or new.observed_at < now() - interval '1 day' then
    raise exception 'identity observation time invalid';
  end if;
  -- Volume: only offers in a positive pair decision are monitored; others are silently not stored.
  if not exists (select 1 from public.retailer_offer_pair_reviews r
                 where r.classification in ('exact_product', 'comparable_alternative')
                   and (r.left_offer_id = new.store_product_id or r.right_offer_id = new.store_product_id)) then
    return null;
  end if;
  new.identity_projection := public.retailer_identity_projection(new.identity);
  new.recorded_at := now();
  -- Unchanged identity observed within 3 days: nothing new to store.
  select o.identity_projection, o.observed_at into last from public.retailer_identity_observations o
    where o.store_product_id = new.store_product_id order by o.observed_at desc limit 1;
  if last is not null and last.identity_projection = new.identity_projection and last.observed_at > new.observed_at - interval '3 days' then
    return null;
  end if;
  return new;
end $$;
create trigger bind_identity_observation before insert or update or delete on public.retailer_identity_observations
  for each row execute function public.bind_identity_observation();

alter table public.retailer_identity_observations enable row level security;
revoke all on public.retailer_identity_observations from public, anon, authenticated, service_role;
grant select, insert on public.retailer_identity_observations to service_role;
revoke all on function public.bind_identity_observation() from public, anon, authenticated, service_role;
comment on table public.retailer_identity_observations is
  'Immutable lightweight identity observations (hash + parsed identity) for offers in a pair decision. Monitoring evidence for durable pair approvals; never an approval.';

create index if not exists tesco_direct_collection_pages_requested_url
  on public.tesco_direct_collection_pages(requested_url, created_at desc);

-- 4. Current status of every positive pair decision (latest review per pair). The app reads ACTIVE rows;
--    the others are the re-review queue, with the reason.
create function public.current_pair_review_status(p_now timestamptz default now(), p_active_only boolean default false)
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
    -- Every usable observation of each side since its approval evidence (the approval's own evidence included).
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
      where e.store_product_id = sp.id and e.source_kind = 'captured_product'
        and e.retrieved_at >= x.src_at and e.retrieved_at <= p_now
      union all
      -- every observation of this offer, whatever SKU it carried (a SKU change, even reverted, is sticky)
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
          -- STICKY: an observation under a different SKU since approval (reassigned, even if reverted)
          or exists (select 1 from observed o where o.l_id = x.l_id and o.r_id = x.r_id and o.which = x.which and o.sku is distinct from x.sku)
          then 'suspended_sku_changed'
        -- STICKY: any title-bearing observation since approval that contradicts a stated attribute, even if a
        -- later one reverts or the contradicting one lacks a brand.
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
comment on function public.current_pair_review_status(timestamptz, boolean) is
  'Durable pair approvals: active while SKU and stated identity attributes are unchanged since approval (sticky) and monitoring evidence is <= 14 days old; otherwise suspended with a reason (re-review queue). Read-only.';
