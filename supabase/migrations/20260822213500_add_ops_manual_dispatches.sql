create table if not exists public.ops_manual_dispatches (
  id uuid primary key default gen_random_uuid(),
  dispatch_key text not null unique,
  issue_number integer not null,
  issue_updated_at timestamptz not null,
  operation text not null,
  status text not null default 'running'
    check (status in ('running', 'success', 'failed')),
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.ops_manual_dispatches enable row level security;

revoke all on public.ops_manual_dispatches from anon, authenticated;
grant all on public.ops_manual_dispatches to service_role;

create index if not exists ops_manual_dispatches_created_at_idx
  on public.ops_manual_dispatches(created_at desc);
