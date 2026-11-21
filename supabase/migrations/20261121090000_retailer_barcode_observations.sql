-- Barcode-led cross-retailer discovery: persistent, append-only evidence (owner request, 21 Nov 2026).
-- PROPOSED — NOT APPLIED. Writes nothing to mappings, prices or pair reviews.
--
-- retailer_barcode_observations: one row = one retailer barcode-search observation. The GTIN's ORIGIN (Tesco product
--   data) is recorded separately from the RETAILER evidence (the Dunnes/SuperValu search response). `evidence_kind`
--   keeps a SKU found BY a GTIN search distinct from a GTIN the retailer itself RETURNED (never seen for Dunnes or
--   SuperValu today; `retailer_returned_gtin` must then be stored).
-- retailer_barcode_association_reviews: append-only human decisions (accept / reject a resolved SKU for a GTIN at a
--   store), used ONLY to clear a suspension after a legitimate SKU change. A review is NOT an exact-comparison
--   approval: comparisons still require the protected pair review, and mapping changes still go through the existing
--   guarded finaliser / repair processes.
-- current_barcode_associations: latest state per (gtin, store) with a status.

create table if not exists public.retailer_barcode_observations (
  id uuid primary key default gen_random_uuid(),
  gtin text not null check (gtin ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13})$'),
  gtin_kind text not null check (gtin_kind in ('gtin8', 'gtin12', 'gtin13')),
  -- Where the barcode value came from (never counted as independent retailer evidence by itself).
  gtin_origin_store text not null check (gtin_origin_store in ('tesco')),
  gtin_origin_sku text not null check (gtin_origin_sku ~ '^[0-9]{6,12}$'),
  gtin_origin_store_product_id uuid references public.store_products(id) on delete restrict,
  -- Must carry the evidence reference AND the Tesco identity the observation was classified against.
  gtin_origin_evidence jsonb not null check (jsonb_typeof(gtin_origin_evidence) = 'object'
    and gtin_origin_evidence ?& array['table', 'field', 'tesco_name', 'tesco_brand']),
  -- The retailer's own evidence.
  store text not null check (store in ('dunnes', 'supervalu')),
  evidence_kind text not null check (evidence_kind in ('sku_found_by_gtin_search', 'gtin_returned_by_retailer')),
  retailer_returned_gtin text check (retailer_returned_gtin ~ '^[0-9]{8,14}$'),
  query text not null,
  endpoint text not null,
  http_status integer not null check (http_status = 200),
  result_total integer not null check (result_total >= 0),
  result_items jsonb not null check (jsonb_typeof(result_items) = 'array'),
  query_forms jsonb not null default '[]'::jsonb check (jsonb_typeof(query_forms) = 'array'),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  -- Deterministic assessment (src/lib/barcode-matching.ts, rule_version).
  resolved_sku text,
  outcome text not null check (outcome in ('not_found', 'ambiguous', 'identity_conflict', 'identity_consistent')),
  tier text check (tier in ('strong', 'review', 'held')),
  identity_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(identity_reasons) = 'array'),
  review_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(review_reasons) = 'array'),
  title_agreement numeric check (title_agreement between 0 and 1),
  rule_version text not null check (length(rule_version) between 3 and 60),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  check ((gtin_kind = 'gtin8' and length(gtin) = 8) or (gtin_kind = 'gtin12' and length(gtin) = 12) or (gtin_kind = 'gtin13' and length(gtin) = 13)),
  check (query = gtin or query = '0' || gtin),
  check (endpoint ~ ('^https://storefrontgateway\.' || case store when 'dunnes' then 'dunnesstoresgrocery\.com/api/stores/258' else 'supervalu\.ie/api/stores/5550' end || '/search\?')),
  check ((evidence_kind = 'gtin_returned_by_retailer') = (retailer_returned_gtin is not null)),
  check ((outcome in ('identity_consistent', 'identity_conflict')) = (resolved_sku is not null)),
  check ((outcome = 'identity_consistent' and tier in ('strong', 'review'))
      or (outcome in ('identity_conflict', 'ambiguous') and tier = 'held')
      or (outcome = 'not_found' and tier is null)),
  check (resolved_sku is null or resolved_sku <> query),
  unique (gtin, store, response_sha256, observed_at)
);
create index if not exists retailer_barcode_obs_latest on public.retailer_barcode_observations (gtin, store, observed_at desc);
create index if not exists retailer_barcode_obs_sku on public.retailer_barcode_observations (store, resolved_sku);
comment on table public.retailer_barcode_observations is
  'Append-only barcode-search evidence: GTIN origin (Tesco) + the retailer''s own search response and the deterministic assessment. Discovery evidence only; never an exact-match approval.';

create table if not exists public.retailer_barcode_association_reviews (
  id uuid primary key default gen_random_uuid(),
  gtin text not null check (gtin ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13})$'),
  store text not null check (store in ('dunnes', 'supervalu')),
  sku text not null,
  decision text not null check (decision in ('accept', 'reject')),
  observation_id uuid not null references public.retailer_barcode_observations(id) on delete restrict,
  reviewer text not null check (length(trim(reviewer)) >= 2),
  reason text not null check (length(trim(reason)) >= 20),
  reviewed_at timestamptz not null default now()
);
comment on table public.retailer_barcode_association_reviews is
  'Append-only human decisions on a barcode-resolved SKU (accept/reject). Clears a suspension only; NOT a comparison approval.';

-- Append-only + DB-stamped recorded_at / reviewed_at.
create or replace function public.prevent_barcode_evidence_rewrite() returns trigger
language plpgsql as $$ begin raise exception 'barcode_evidence_append_only'; end $$;
create or replace function public.stamp_barcode_evidence_time() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'retailer_barcode_observations' then
    new.recorded_at := now();
    if new.observed_at > new.recorded_at + interval '5 minutes' then raise exception 'barcode_observation_in_future'; end if;
  else
    new.reviewed_at := now();
  end if;
  return new;
end $$;
revoke all on function public.prevent_barcode_evidence_rewrite() from public, anon, authenticated, service_role;
revoke all on function public.stamp_barcode_evidence_time() from public, anon, authenticated, service_role;
do $$ declare t text; begin
  foreach t in array array['retailer_barcode_observations', 'retailer_barcode_association_reviews'] loop
    execute format('drop trigger if exists %I_immutable on public.%I', t, t);
    execute format('create trigger %I_immutable before update or delete on public.%I for each row execute function public.prevent_barcode_evidence_rewrite()', t, t);
    execute format('drop trigger if exists %I_no_truncate on public.%I', t, t);
    execute format('create trigger %I_no_truncate before truncate on public.%I for each statement execute function public.prevent_barcode_evidence_rewrite()', t, t);
    execute format('drop trigger if exists %I_stamp on public.%I', t, t);
    execute format('create trigger %I_stamp before insert on public.%I for each row execute function public.stamp_barcode_evidence_time()', t, t);
    execute format('alter table public.%I enable row level security', t);
    -- Supabase default privileges grant ALL; restrict service_role to append + read.
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert on public.%I to service_role', t);
  end loop;
end $$;

-- Current state per (gtin, store).
--   active                      latest is strong and agrees with the reference SKU (last accepted review, else the
--                               first strong resolution), observed within 30 days
--   stale_needs_reverification  as active, but older than 30 days
--   suspended_sku_changed       latest strong SKU differs from the reference SKU and no later accepted review
--   suspended_no_longer_found   a strong association existed, but the latest observation is not_found
--   needs_review | held | not_found  from the latest tier/outcome
create or replace view public.current_barcode_associations with (security_invoker = true) as
with latest as (
  select distinct on (o.gtin, o.store) o.*
  from public.retailer_barcode_observations o
  order by o.gtin, o.store, o.observed_at desc, o.recorded_at desc
), first_strong as (
  select distinct on (o.gtin, o.store) o.gtin, o.store, o.resolved_sku
  from public.retailer_barcode_observations o where o.tier = 'strong'
  order by o.gtin, o.store, o.observed_at asc
), previous_strong as (
  select distinct on (o.gtin, o.store) o.gtin, o.store, o.resolved_sku, o.observed_at
  from public.retailer_barcode_observations o
  join latest l on l.gtin = o.gtin and l.store = o.store and o.id <> l.id
  where o.tier = 'strong'
  order by o.gtin, o.store, o.observed_at desc
), last_review as (
  select distinct on (r.gtin, r.store) r.gtin, r.store, r.sku, r.decision, r.reviewed_at
  from public.retailer_barcode_association_reviews r
  order by r.gtin, r.store, r.reviewed_at desc
)
select l.gtin, l.gtin_kind, l.gtin_origin_store, l.gtin_origin_sku, l.gtin_origin_store_product_id,
  l.store, l.evidence_kind, l.resolved_sku, l.outcome, l.tier, l.identity_reasons, l.review_reasons, l.title_agreement,
  l.rule_version, l.http_status, l.observed_at as last_verified_at, l.id as observation_id, l.response_sha256,
  p.resolved_sku as previous_strong_sku,
  coalesce(case when rv.decision = 'accept' then rv.sku end, f.resolved_sku) as reference_sku,
  case
    when l.tier = 'strong' and rv.decision = 'reject' and rv.sku = l.resolved_sku then 'held'
    when l.tier = 'strong' and l.resolved_sku is distinct from coalesce(case when rv.decision = 'accept' then rv.sku end, f.resolved_sku)
      then 'suspended_sku_changed'
    when l.tier = 'strong' and l.observed_at < now() - interval '30 days' then 'stale_needs_reverification'
    when l.tier = 'strong' then 'active'
    when l.outcome = 'not_found' and f.resolved_sku is not null then 'suspended_no_longer_found'
    when l.tier = 'review' then 'needs_review'
    when l.tier = 'held' then 'held'
    else 'not_found'
  end as status
from latest l
left join first_strong f on f.gtin = l.gtin and f.store = l.store
left join previous_strong p on p.gtin = l.gtin and p.store = l.store
left join last_review rv on rv.gtin = l.gtin and rv.store = l.store;
revoke all on public.current_barcode_associations from public, anon, authenticated, service_role;
grant select on public.current_barcode_associations to service_role;
comment on view public.current_barcode_associations is
  'Latest barcode observation per (gtin, store) with status. Discovery evidence only; never a comparison approval.';
