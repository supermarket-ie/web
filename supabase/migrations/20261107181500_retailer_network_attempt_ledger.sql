-- Separates ACTUAL network attempts from SQS queue deliveries for the automated
-- Dunnes/SuperValu workers (review item 4). A batch that is redelivered only
-- because the retailer is paused (breaker open / rate-limit wait) must NOT count
-- toward a product's transient-retry exhaustion: those redeliveries made no
-- retailer request. The worker increments this durable per-(run,product) counter
-- ONLY when it actually issues a request that fails transiently, and uses the
-- returned count — never SQS ApproximateReceiveCount — to decide permanent
-- failure. Durable so the count survives restarts and is shared across tasks.
--
-- Apply AFTER 20261107173000_retailer_governor_recovery_hardening.sql.

create table if not exists public.retailer_network_attempts (
  run_id uuid not null references public.scrape_runs(id) on delete cascade,
  store_product_id uuid not null,
  attempts integer not null default 0,
  last_reason text,
  updated_at timestamptz not null default now(),
  primary key (run_id, store_product_id)
);

alter table public.retailer_network_attempts enable row level security;

comment on table public.retailer_network_attempts is
  'Durable count of REAL transient network attempts per (run, product) for automated Dunnes/SuperValu collection. Drives transient-retry exhaustion independently of SQS delivery count, so paused redeliveries never exhaust retries or DLQ valid work.';

-- Increment and return the real-attempt count for a product. Atomic upsert.
create or replace function public.record_retailer_network_attempt(
  p_run_uuid uuid,
  p_store_product_id uuid,
  p_reason text default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_attempts integer;
begin
  insert into public.retailer_network_attempts (run_id, store_product_id, attempts, last_reason)
  values (p_run_uuid, p_store_product_id, 1, left(coalesce(p_reason, 'unknown'), 200))
  on conflict (run_id, store_product_id) do update
    set attempts = public.retailer_network_attempts.attempts + 1,
        last_reason = left(coalesce(p_reason, 'unknown'), 200),
        updated_at = now()
  returning attempts into v_attempts;
  return v_attempts;
end;
$$;

revoke all on public.retailer_network_attempts from anon, authenticated;
revoke all on function public.record_retailer_network_attempt(uuid, uuid, text) from public, anon, authenticated;
grant select, insert, update on public.retailer_network_attempts to service_role;
grant execute on function public.record_retailer_network_attempt(uuid, uuid, text) to service_role;
