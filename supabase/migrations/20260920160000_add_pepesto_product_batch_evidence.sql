create table if not exists public.pepesto_tesco_product_batches (
  id uuid primary key default gen_random_uuid(),
  run_uuid uuid not null references public.scrape_runs(id) on delete cascade,
  batch_index integer not null check (batch_index >= 0),
  products jsonb not null,
  response_payload jsonb,
  items_returned integer check (items_returned is null or items_returned >= 0),
  status text not null check (status in ('requesting','retrieved','complete','failed')),
  credits_before_cents integer check (credits_before_cents is null or credits_before_cents >= 0),
  credits_after_cents integer check (credits_after_cents is null or credits_after_cents >= 0),
  actual_cost_cents integer check (actual_cost_cents is null or actual_cost_cents >= 0),
  retrieved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_uuid,batch_index)
);

alter table public.pepesto_tesco_product_batches enable row level security;
revoke all on public.pepesto_tesco_product_batches from public, anon, authenticated;
grant all on public.pepesto_tesco_product_batches to service_role;
create index if not exists pepesto_tesco_product_batches_run_idx on public.pepesto_tesco_product_batches(run_uuid,batch_index);
