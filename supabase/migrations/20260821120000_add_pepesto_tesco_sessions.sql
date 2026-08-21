create table if not exists public.pepesto_tesco_sessions (
  id uuid primary key default gen_random_uuid(),
  run_uuid uuid not null references public.scrape_runs(id) on delete cascade,
  search_session_id text not null unique,
  batch_index integer not null,
  products jsonb not null,
  status text not null default 'submitted' check (status in ('submitted','in_progress','done','failed')),
  submitted_at timestamptz not null default now(),
  retrieved_at timestamptz,
  result_summary jsonb,
  last_error text
);

create index if not exists pepesto_tesco_sessions_pending_idx
  on public.pepesto_tesco_sessions (status, submitted_at)
  where status in ('submitted','in_progress');

alter table public.pepesto_tesco_sessions enable row level security;
revoke all on table public.pepesto_tesco_sessions from anon, authenticated;
grant all on table public.pepesto_tesco_sessions to service_role;
