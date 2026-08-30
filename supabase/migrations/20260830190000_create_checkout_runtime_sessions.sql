create table if not exists public.checkout_runtime_sessions (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  list_id uuid not null references public.saved_lists(id) on delete cascade,
  retailer text not null check (retailer in ('supervalu')),
  provider text not null check (provider in ('browserbase')),
  provider_session_id text not null unique,
  state text not null check (state in (
    'prepared',
    'awaiting_shopper_auth',
    'awaiting_store_context',
    'populating_trolley',
    'trolley_ready',
    'failed',
    'expired'
  )),
  plan jsonb not null,
  populated_product_ids jsonb not null default '[]'::jsonb,
  verified_item_count integer,
  verified_trolley_value numeric(10, 2),
  failure_code text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  operation_locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checkout_runtime_sessions_owner_idx
  on public.checkout_runtime_sessions (subscriber_id, created_at desc);

create index if not exists checkout_runtime_sessions_expiry_idx
  on public.checkout_runtime_sessions (expires_at)
  where state not in ('expired', 'failed');

alter table public.checkout_runtime_sessions enable row level security;

-- Checkout runtime rows contain provider identifiers and basket plans. They are
-- deliberately accessible only through server routes using the service role.
create policy "Service role full access"
  on public.checkout_runtime_sessions
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.claim_checkout_runtime_session(
  p_session_id uuid,
  p_subscriber_id uuid
)
returns public.checkout_runtime_sessions
language sql
security definer
set search_path = public
as $$
  update public.checkout_runtime_sessions
  set operation_locked_until = now() + interval '90 seconds',
      updated_at = now()
  where id = p_session_id
    and subscriber_id = p_subscriber_id
    and state in ('awaiting_shopper_auth', 'awaiting_store_context', 'populating_trolley')
    and (operation_locked_until is null or operation_locked_until < now())
  returning *;
$$;

revoke all on function public.claim_checkout_runtime_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_checkout_runtime_session(uuid, uuid) to service_role;
