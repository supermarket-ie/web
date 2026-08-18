-- Persistent intentions for the Supermarket.ie household shopping agent.
-- All application access is server-side through the service-role client.

create table if not exists public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  type text not null check (type in (
    'price_watch',
    'promotion_watch',
    'availability_watch',
    'basket_watch',
    'reminder'
  )),
  status text not null default 'active' check (status in (
    'active', 'paused', 'completed', 'cancelled'
  )),
  canonical_name text,
  product_family text,
  source_request text not null,
  condition jsonb not null default '{}'::jsonb,
  baseline jsonb,
  notification_channel text not null default 'email' check (notification_channel in ('email', 'in_app')),
  cooldown_minutes integer not null default 1440 check (cooldown_minutes >= 0),
  last_evaluated_at timestamptz,
  last_triggered_at timestamptz,
  trigger_count integer not null default 0 check (trigger_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_tasks_subscriber_active
  on public.agent_tasks (subscriber_id, created_at desc)
  where status = 'active';

create index if not exists idx_agent_tasks_product_active
  on public.agent_tasks (canonical_name)
  where status = 'active' and canonical_name is not null;

create index if not exists idx_agent_tasks_type_active
  on public.agent_tasks (type)
  where status = 'active';

alter table public.agent_tasks enable row level security;
revoke all on table public.agent_tasks from anon, authenticated;

-- Notification delivery is separately persisted so retries are idempotent and
-- the UI can later show an auditable agent activity feed.
create table if not exists public.agent_notifications (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.agent_tasks(id) on delete cascade,
  subscriber_id uuid not null references public.subscribers(id) on delete cascade,
  channel text not null check (channel in ('email', 'in_app')),
  dedupe_key text not null unique,
  title text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_notifications_subscriber
  on public.agent_notifications (subscriber_id, created_at desc);

create index if not exists idx_agent_notifications_pending
  on public.agent_notifications (created_at)
  where status = 'pending';

alter table public.agent_notifications enable row level security;
revoke all on table public.agent_notifications from anon, authenticated;
