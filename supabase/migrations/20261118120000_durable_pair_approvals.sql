-- Durable pair approvals (owner-requested, 18 Nov 2026).
--
-- An approved pair review stays in force while BOTH offers' identities stay unchanged, instead of expiring
-- 14 days after review. Routine captures record lightweight identity OBSERVATIONS (body hash + parsed identity,
-- no body: the same evidence strength as tesco_direct_collection_pages). The approval itself still requires
-- full, fresh, offer-bound evidence at insert time (unchanged validate_offer_pair_review trigger).
--
-- A pair is ACTIVE only while, for each side:
--   * the offer's current store_sku equals the SKU approved, and no other offer of that store uses it;
--   * the latest observation (or the approval's own evidence) is <= 14 days old;
--   * that observation's identity fingerprint equals the fingerprint approved;
-- and the review is <= 365 days old. Otherwise it is SUSPENDED with a reason (the re-review queue).
-- Automation can only keep or suspend a pair. Nothing here creates, edits or upgrades an approval.

-- 1. Deterministic identity fingerprints, computed in the database from stored evidence (never supplied).
create function public.identity_norm(t text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g')), '')
$$;

-- SuperValu / Dunnes parsed identity (retailer_identity_responses.identity / observations.identity).
-- Marketing description is excluded (frequent cosmetic edits); ingredients are included (formulation).
create function public.retailer_identity_fingerprint(identity jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'v', 1,
    'title', public.identity_norm(identity->>'title'),
    'brand', public.identity_norm(identity->>'brand'),
    'manufacturer', public.identity_norm(identity->>'manufacturer'),
    'gtin', nullif(btrim(coalesce(identity->>'gtin', '')), ''),
    'quantity', identity->'quantity',
    'packSize', identity->'packSize',
    'packCount', identity->'packCount',
    'variant', identity->'variant',
    'flavour', identity->'flavour',
    'formulation', identity->'formulation',
    'ingredients', public.identity_norm(identity->>'ingredients')
  )::text, 'UTF8')), 'hex')
$$;

-- Tesco page: the parsed product with this SKU (name, brand, GTIN, structured quantity and pack).
create function public.tesco_page_fingerprint(parsed jsonb, sku text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'v', 1,
    'title', public.identity_norm(p->>'name'),
    'brand', public.identity_norm(p->>'brand'),
    'gtin', nullif(btrim(coalesce(p->>'gtin', '')), ''),
    'quantity', p->'quantity',
    'packSize', p->'identityDetails'->'packSize'
  )::text, 'UTF8')), 'hex')
  from jsonb_array_elements(coalesce(parsed->'products', '[]'::jsonb)) p
  where p->>'sku' = sku
  limit 1
$$;

-- 2. Lightweight identity observations from routine SuperValu/Dunnes direct product captures.
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
  parser_version text not null,
  identity jsonb not null check (jsonb_typeof(identity) = 'object'),
  identity_fingerprint text,
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  run_uuid uuid
);
create index retailer_identity_observations_offer on public.retailer_identity_observations(store_product_id, observed_at desc);

create function public.bind_identity_observation() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare mapped record;
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
  new.identity_fingerprint := public.retailer_identity_fingerprint(new.identity);
  new.recorded_at := now();
  return new;
end $$;
create trigger bind_identity_observation before insert or update or delete on public.retailer_identity_observations
  for each row execute function public.bind_identity_observation();

alter table public.retailer_identity_observations enable row level security;
revoke all on public.retailer_identity_observations from public, anon, authenticated, service_role;
grant select, insert on public.retailer_identity_observations to service_role;
revoke all on function public.bind_identity_observation() from public, anon, authenticated, service_role;
comment on table public.retailer_identity_observations is
  'Immutable lightweight identity observations (hash + parsed identity) from routine direct product captures. Monitoring evidence for durable pair approvals; never an approval.';

-- 3. Approval-time identity, stamped by the database on insert (after the existing validation trigger).
alter table public.retailer_offer_pair_reviews
  add column left_sku text, add column right_sku text,
  add column left_identity_fingerprint text, add column right_identity_fingerprint text;

create function public.stamp_offer_pair_review_identity() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare side record; sku text; fp text;
begin
  for side in
    select 'left' as which, new.left_offer_id as offer_id, new.left_source_kind as kind, new.left_source_id as source_id
    union all
    select 'right', new.right_offer_id, new.right_source_kind, new.right_source_id
  loop
    sku := null; fp := null;
    if side.kind = 'tesco_page' then
      select sp.store_sku, public.tesco_page_fingerprint(p.parsed, sp.store_sku) into sku, fp
      from public.store_products sp join public.tesco_direct_collection_pages p on p.id = side.source_id
      where sp.id = side.offer_id;
    elsif side.kind = 'retailer_response' then
      select e.sku, public.retailer_identity_fingerprint(e.identity) into sku, fp
      from public.retailer_identity_responses e where e.id = side.source_id;
    end if;
    if side.which = 'left' then new.left_sku := sku; new.left_identity_fingerprint := fp;
    else new.right_sku := sku; new.right_identity_fingerprint := fp; end if;
  end loop;
  return new;
end $$;
-- Trigger names fire alphabetically: "zz_" runs after validate_offer_pair_review.
create trigger zz_stamp_offer_pair_review_identity before insert on public.retailer_offer_pair_reviews
  for each row execute function public.stamp_offer_pair_review_identity();
revoke all on function public.stamp_offer_pair_review_identity() from public, anon, authenticated, service_role;

-- 4. Current status of every positive pair decision (latest review per pair). The app reads ACTIVE rows only;
--    the others are the re-review queue, with the reason.
create function public.current_pair_review_status(p_now timestamptz default now())
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
    order by r.left_offer_id, r.right_offer_id, r.reviewed_at desc, r.created_at desc
  ),
  sides as (
    select l.*, s.which, s.offer_id, s.sku, s.fp, s.src_at
    from latest l
    cross join lateral (values
      ('left', l.left_offer_id, l.left_sku, l.left_identity_fingerprint, l.left_captured_at),
      ('right', l.right_offer_id, l.right_sku, l.right_identity_fingerprint, l.right_captured_at)
    ) as s(which, offer_id, sku, fp, src_at)
    where l.classification in ('exact_product', 'comparable_alternative')
  ),
  checked as (
    select x.*, sp.store_sku as current_sku,
      (select count(*) from public.store_products o where o.store = sp.store and o.store_sku = sp.store_sku) as sku_rows,
      obs.at as obs_at, obs.fp as obs_fp
    from sides x
    join public.store_products sp on sp.id = x.offer_id
    cross join lateral (
      select v.at, v.fp from (
        -- the approval's own evidence is the first observation
        select x.src_at as at, x.fp as fp
        union all
        select p.created_at, public.tesco_page_fingerprint(p.parsed, sp.store_sku)
        from public.tesco_direct_collection_pages p
        where sp.store = 'tesco' and p.outcome = 'ok' and p.http_status = 200 and p.body_sha256 is not null
          and p.created_at <= p_now
          and (strpos(p.requested_url, sp.store_sku) > 0 or strpos(coalesce(p.final_url, ''), sp.store_sku) > 0)
        union all
        select e.retrieved_at, public.retailer_identity_fingerprint(e.identity)
        from public.retailer_identity_responses e
        where e.store_product_id = sp.id and e.source_kind = 'captured_product' and e.sku = sp.store_sku and e.retrieved_at <= p_now
        union all
        select o.observed_at, o.identity_fingerprint
        from public.retailer_identity_observations o
        where o.store_product_id = sp.id and o.sku = sp.store_sku and o.observed_at <= p_now
      ) v
      order by v.at desc nulls last
      limit 1
    ) obs
  ),
  per_side as (
    select c.*,
      case
        when c.sku is null or c.fp is null then 'suspended_unmonitorable'
        when c.current_sku is distinct from c.sku or c.sku_rows <> 1 then 'suspended_sku_changed'
        when c.obs_at is null or c.obs_at < p_now - interval '14 days' then 'suspended_no_recent_evidence'
        when c.obs_fp is distinct from c.fp then 'suspended_identity_changed'
        else 'active'
      end as side_status
    from checked c
  )
  select l.left_offer_id, l.right_offer_id, l.classification,
    l.left_source_hash, l.right_source_hash,
    max(s.obs_at) filter (where s.which = 'left'), max(s.obs_at) filter (where s.which = 'right'),
    l.reviewed_at, l.rationale, l.reviewer,
    case
      when l.reviewed_at < p_now - interval '365 days' then 'expired_needs_review'
      when count(s.*) <> 2 then 'suspended_unmonitorable'
      when bool_or(s.side_status = 'suspended_sku_changed') then 'suspended_sku_changed'
      when bool_or(s.side_status = 'suspended_unmonitorable') then 'suspended_unmonitorable'
      when bool_or(s.side_status = 'suspended_identity_changed') then 'suspended_identity_changed'
      when bool_or(s.side_status = 'suspended_no_recent_evidence') then 'suspended_no_recent_evidence'
      else 'active'
    end
  from latest l
  left join per_side s on s.left_offer_id = l.left_offer_id and s.right_offer_id = l.right_offer_id
  where l.classification in ('exact_product', 'comparable_alternative')
  group by l.left_offer_id, l.right_offer_id, l.classification, l.left_source_hash, l.right_source_hash,
    l.reviewed_at, l.rationale, l.reviewer
$$;
revoke all on function public.current_pair_review_status(timestamptz) from public, anon, authenticated;
grant execute on function public.current_pair_review_status(timestamptz) to service_role;
comment on function public.current_pair_review_status(timestamptz) is
  'Durable pair approvals: active while SKU, identity fingerprint and <=14-day monitoring evidence hold; otherwise suspended with a reason (re-review queue). Read-only.';
