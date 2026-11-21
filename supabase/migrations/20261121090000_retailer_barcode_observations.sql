-- Barcode-led cross-retailer discovery: persistent, append-only evidence (owner request, 21 Nov 2026).
-- PROPOSED — NOT APPLIED. Writes nothing to mappings, prices or pair reviews.
--
-- One row = one retailer barcode-search observation. The GTIN's ORIGIN (Tesco product data) is recorded separately
-- from the RETAILER evidence (the Dunnes/SuperValu search response). `evidence_kind` keeps a SKU found BY a GTIN
-- search distinct from a GTIN the retailer itself RETURNED (the latter never occurs for Dunnes/SuperValu today).
-- A strong observation is discovery evidence only: exact comparison relationships still require the protected pair
-- review, and mapping changes still go through the existing guarded finaliser / repair processes.

create table if not exists public.retailer_barcode_observations (
  id uuid primary key default gen_random_uuid(),
  gtin text not null check (gtin ~ '^([0-9]{8}|[0-9]{12}|[0-9]{13})$'),
  gtin_kind text not null check (gtin_kind in ('gtin8', 'gtin12', 'gtin13')),
  -- Where the barcode value came from (never counted as independent retailer evidence by itself).
  gtin_origin_store text not null check (gtin_origin_store in ('tesco')),
  gtin_origin_sku text not null check (gtin_origin_sku ~ '^[0-9]{6,12}$'),
  gtin_origin_store_product_id uuid references public.store_products(id) on delete set null,
  gtin_origin_evidence jsonb not null check (jsonb_typeof(gtin_origin_evidence) = 'object'),
  -- The retailer's own evidence.
  store text not null check (store in ('dunnes', 'supervalu')),
  evidence_kind text not null check (evidence_kind in ('sku_found_by_gtin_search', 'gtin_returned_by_retailer')),
  query text not null check (query ~ '^[0-9]{8,13}$'),
  endpoint text not null check (endpoint ~ '^https://storefrontgateway\.(dunnesstoresgrocery\.com|supervalu\.ie)/api/stores/[0-9]+/search\?'),
  http_status integer not null,
  result_total integer not null check (result_total >= 0),
  result_items jsonb not null check (jsonb_typeof(result_items) = 'array'),
  response_sha256 text not null check (response_sha256 ~ '^[a-f0-9]{64}$'),
  -- Deterministic assessment (src/lib/barcode-matching.ts, rule_version).
  resolved_sku text,
  outcome text not null check (outcome in ('not_found', 'ambiguous', 'identity_conflict', 'identity_consistent')),
  tier text check (tier in ('strong', 'review', 'held')),
  identity_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(identity_reasons) = 'array'),
  title_agreement numeric check (title_agreement between 0 and 1),
  rule_version text not null check (length(rule_version) between 3 and 60),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  check ((outcome in ('identity_consistent', 'identity_conflict')) = (resolved_sku is not null)),
  check ((outcome = 'identity_consistent' and tier in ('strong', 'review'))
      or (outcome in ('identity_conflict', 'ambiguous') and tier = 'held')
      or (outcome = 'not_found' and tier is null)),
  check (observed_at <= recorded_at + interval '5 minutes'),
  unique (gtin, store, response_sha256, observed_at)
);
create index if not exists retailer_barcode_obs_latest on public.retailer_barcode_observations (gtin, store, observed_at desc);
create index if not exists retailer_barcode_obs_sku on public.retailer_barcode_observations (store, resolved_sku);
comment on table public.retailer_barcode_observations is
  'Append-only barcode-search evidence: GTIN origin (Tesco) + the retailer''s own search response and the deterministic assessment. Discovery evidence only; never an exact-match approval.';

create or replace function public.prevent_barcode_observation_rewrite() returns trigger
language plpgsql as $$ begin raise exception 'barcode_observation_append_only'; end $$;
revoke all on function public.prevent_barcode_observation_rewrite() from public, anon, authenticated, service_role;
drop trigger if exists retailer_barcode_obs_immutable on public.retailer_barcode_observations;
create trigger retailer_barcode_obs_immutable before update or delete on public.retailer_barcode_observations
  for each row execute function public.prevent_barcode_observation_rewrite();
drop trigger if exists retailer_barcode_obs_no_truncate on public.retailer_barcode_observations;
create trigger retailer_barcode_obs_no_truncate before truncate on public.retailer_barcode_observations
  for each statement execute function public.prevent_barcode_observation_rewrite();

alter table public.retailer_barcode_observations enable row level security;
-- Supabase default privileges grant ALL; restrict service_role to append + read.
revoke all on public.retailer_barcode_observations from public, anon, authenticated, service_role;
grant select, insert on public.retailer_barcode_observations to service_role;

-- Current state per (gtin, store): the latest observation, plus SUSPENSION when the latest strong resolution differs
-- from an earlier strong resolution (SKU reassigned) or when the latest observation is no longer strong.
create or replace view public.current_barcode_associations with (security_invoker = true) as
with latest as (
  select distinct on (o.gtin, o.store) o.*
  from public.retailer_barcode_observations o
  order by o.gtin, o.store, o.observed_at desc, o.recorded_at desc
), prior_strong as (
  select o.gtin, o.store, array_agg(distinct o.resolved_sku) filter (where o.tier = 'strong') as strong_skus
  from public.retailer_barcode_observations o group by o.gtin, o.store
)
select l.gtin, l.gtin_kind, l.gtin_origin_store, l.gtin_origin_sku, l.gtin_origin_store_product_id,
  l.store, l.evidence_kind, l.resolved_sku, l.outcome, l.tier, l.identity_reasons, l.title_agreement,
  l.observed_at as last_verified_at, l.id as observation_id, l.response_sha256,
  case
    when l.tier = 'strong' and coalesce(array_length(p.strong_skus, 1), 0) > 1 then 'suspended_sku_changed'
    when l.tier = 'strong' and l.observed_at < now() - interval '30 days' then 'stale_needs_reverification'
    when l.tier = 'strong' then 'active'
    when l.tier = 'review' then 'needs_review'
    when l.tier = 'held' then 'held'
    else 'not_found'
  end as status
from latest l left join prior_strong p on p.gtin = l.gtin and p.store = l.store;
revoke all on public.current_barcode_associations from public, anon, authenticated, service_role;
grant select on public.current_barcode_associations to service_role;
comment on view public.current_barcode_associations is
  'Latest barcode observation per (gtin, store) with status: active | needs_review | held | not_found | suspended_sku_changed | stale_needs_reverification. Discovery evidence only.';
