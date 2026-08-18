alter table public.subscribers
  add column if not exists agent_proactivity text not null default 'important_only';

alter table public.subscribers
  drop constraint if exists subscribers_agent_proactivity_check;

alter table public.subscribers
  add constraint subscribers_agent_proactivity_check
  check (agent_proactivity in ('important_only', 'useful_updates', 'quiet'));

create table if not exists public.household_insights (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  canonical_name text not null,
  kind text not null check (kind in ('price_drop', 'promotion', 'replenishment', 'price_rise')),
  priority integer not null check (priority between 0 and 100),
  title text not null,
  body text not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'seen', 'dismissed')),
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists household_insights_subscriber_created_idx
  on public.household_insights (subscriber_id, created_at desc);

create index if not exists household_insights_product_created_idx
  on public.household_insights (canonical_name, created_at desc);

create index if not exists list_items_canonical_subscriber_observed_idx
  on public.list_items (canonical_name, subscriber_id, observed_at desc);

alter table public.household_insights enable row level security;
revoke all on table public.household_insights from anon, authenticated;
