-- Original decoded HTTP bodies, retained only by existing permitted refreshes.
-- No backfill from receipts. No access from browser roles or mutation of prices/mappings.
create table public.retailer_identity_responses (
  id uuid primary key default gen_random_uuid(),
  store text not null check (store in ('supervalu','dunnes')),
  sku text not null check (sku ~ '^[0-9]{5,14}$'),
  product_url text not null,
  requested_url text not null,
  final_url text not null,
  retrieved_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  content_type text not null,
  body_text text not null check (octet_length(body_text) between 1 and 4194304),
  body_sha256 text not null,
  parser_version text not null,
  source_kind text not null check (source_kind in ('captured_product','captured_listing')),
  source_path text not null,
  identity jsonb not null check (jsonb_typeof(identity) = 'object'),
  run_uuid uuid not null,
  store_product_id uuid not null
);
create function public.hash_identity_response() returns trigger language plpgsql set search_path = '' as $$
begin new.body_sha256 := encode(sha256(convert_to(new.body_text,'UTF8')),'hex'); return new; end $$;
create trigger hash_identity_response before insert on public.retailer_identity_responses
for each row execute function public.hash_identity_response();
create index retailer_identity_responses_latest on public.retailer_identity_responses (store,sku,retrieved_at desc);
alter table public.retailer_identity_responses enable row level security;
revoke all on public.retailer_identity_responses from public, anon, authenticated, service_role;
grant select, insert on public.retailer_identity_responses to service_role;
create function public.reject_identity_evidence_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Identity evidence is append-only'; end $$;
create trigger immutable_identity_responses before update or delete on public.retailer_identity_responses
for each row execute function public.reject_identity_evidence_mutation();
comment on table public.retailer_identity_responses is 'Private append-only original UTF-8 decoded HTTP responses, not wire/compression bytes. Parsed identity is revalidated against body before matching. No historical backfill or independent acquisition schedule.';
