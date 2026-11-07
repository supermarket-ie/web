-- Shared per-retailer request governor for the AUTOMATED Dunnes/SuperValu
-- collection path. Two concerns, one durable row per retailer so the limit and
-- the circuit breaker stay correct across concurrent SQS-consumer tasks and
-- survive restarts:
--   1. Token-bucket rate limit. EVERY outbound request (product fetch, search,
--      and retry) consumes one token. A fixed-window counter refills each
--      window; when the window's budget is spent the caller is told to wait.
--   2. Circuit breaker. Repeated access denials / throttles (403/429/timeouts)
--      open the breaker for the retailer, pausing all its requests until a
--      cooldown elapses, after which a single half-open probe may close it.
--
-- Tesco is intentionally NOT governed here; it has its own supervised egress
-- gate (tesco_egress_pool). This migration is additive and changes no existing
-- scraper, matching, or price logic.
--
-- Note on naming: RETURNS TABLE output columns are prefixed out_* so they never
-- collide with the base table's column names inside UPDATE/RETURNING bodies.

create table if not exists public.retailer_request_governor (
  store text primary key,
  -- Token bucket (fixed window).
  window_started_at timestamptz not null default now(),
  window_count integer not null default 0,
  -- Circuit breaker.
  breaker_open boolean not null default false,
  breaker_open_until timestamptz,
  consecutive_denials integer not null default 0,
  last_denial_at timestamptz,
  last_denial_reason text,
  last_success_at timestamptz,
  -- Lifetime counters for observability.
  total_requests bigint not null default 0,
  total_denials bigint not null default 0,
  total_breaker_trips bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.retailer_request_governor enable row level security;

comment on table public.retailer_request_governor is
  'Shared token-bucket rate limit and circuit-breaker state for automated Dunnes/SuperValu collection. One row per retailer; concurrency-safe via row locks.';

-- Acquire one request slot for a retailer. Atomic under a row lock so parallel
-- workers cannot overspend the window or race the breaker. Returns a decision:
--   'blocked' : breaker is open; out_retry_after_ms is the time until half-open
--   'wait'    : rate-limited; out_retry_after_ms is the time until the window
--   'allowed' : a token was consumed; proceed with the request
-- The row is created on first use. p_max_per_minute and p_window_seconds are
-- supplied by the caller (env-tunable) so limits change without a migration.
create or replace function public.acquire_retailer_request_slot(
  p_store text,
  p_max_per_minute integer default 30,
  p_window_seconds integer default 60,
  p_breaker_cooldown_seconds integer default 900
)
returns table (
  out_decision text,
  out_retry_after_ms integer,
  out_breaker_open boolean,
  out_window_count integer,
  out_consecutive_denials integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_seconds integer := greatest(1, least(coalesce(p_window_seconds, 60), 3600));
  v_max integer := greatest(1, least(coalesce(p_max_per_minute, 30), 100000));
  v_window_elapsed numeric;
  v_remaining_ms integer;
  v_rec public.retailer_request_governor%rowtype;
begin
  if p_store is null or btrim(p_store) = '' then
    raise exception 'store is required';
  end if;

  insert into public.retailer_request_governor (store)
  values (p_store)
  on conflict (store) do nothing;

  select * into v_rec
  from public.retailer_request_governor r
  where r.store = p_store
  for update;

  -- Circuit breaker gate. While open and before its cooldown expires, refuse
  -- all requests for this retailer. A denied request never consumes a token.
  if v_rec.breaker_open then
    if v_rec.breaker_open_until is not null and v_rec.breaker_open_until > v_now then
      v_remaining_ms := ceil(extract(epoch from (v_rec.breaker_open_until - v_now)) * 1000);
      return query select 'blocked'::text, greatest(0, v_remaining_ms), true, v_rec.window_count, v_rec.consecutive_denials;
      return;
    end if;
    -- Cooldown elapsed: move to half-open. Allow exactly one probe request
    -- through by closing the breaker here; a subsequent denial re-opens it, a
    -- success fully resets it.
    update public.retailer_request_governor r
       set breaker_open = false,
           breaker_open_until = null,
           updated_at = v_now
     where r.store = p_store
    returning r.* into v_rec;
  end if;

  -- Token bucket (fixed window). Reset the window if it has elapsed.
  v_window_elapsed := extract(epoch from (v_now - v_rec.window_started_at));
  if v_window_elapsed >= v_window_seconds then
    update public.retailer_request_governor r
       set window_started_at = v_now,
           window_count = 1,
           total_requests = r.total_requests + 1,
           updated_at = v_now
     where r.store = p_store
    returning r.* into v_rec;
    return query select 'allowed'::text, 0, false, v_rec.window_count, v_rec.consecutive_denials;
    return;
  end if;

  if v_rec.window_count >= v_max then
    -- Budget spent for this window. Tell the caller how long until it refills.
    v_remaining_ms := ceil((v_window_seconds - v_window_elapsed) * 1000);
    return query select 'wait'::text, greatest(1, v_remaining_ms), false, v_rec.window_count, v_rec.consecutive_denials;
    return;
  end if;

  update public.retailer_request_governor r
     set window_count = r.window_count + 1,
         total_requests = r.total_requests + 1,
         updated_at = v_now
   where r.store = p_store
  returning r.* into v_rec;
  return query select 'allowed'::text, 0, false, v_rec.window_count, v_rec.consecutive_denials;
end;
$$;

-- Record an access denial / throttle (403/429/timeout). When the consecutive
-- streak reaches p_trip_threshold the breaker opens for p_cooldown_seconds.
create or replace function public.record_retailer_denial(
  p_store text,
  p_reason text,
  p_trip_threshold integer default 5,
  p_cooldown_seconds integer default 900
)
returns table (out_breaker_open boolean, out_consecutive_denials integer, out_breaker_open_until timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_threshold integer := greatest(1, least(coalesce(p_trip_threshold, 5), 1000));
  v_cooldown integer := greatest(30, least(coalesce(p_cooldown_seconds, 900), 86400));
  v_rec public.retailer_request_governor%rowtype;
  v_will_trip boolean;
  v_was_open boolean;
begin
  if p_store is null or btrim(p_store) = '' then
    raise exception 'store is required';
  end if;

  insert into public.retailer_request_governor (store)
  values (p_store)
  on conflict (store) do nothing;

  select * into v_rec
  from public.retailer_request_governor r
  where r.store = p_store
  for update;

  v_was_open := v_rec.breaker_open;
  v_will_trip := (v_rec.consecutive_denials + 1) >= v_threshold;

  update public.retailer_request_governor r
     set consecutive_denials = r.consecutive_denials + 1,
         last_denial_at = v_now,
         last_denial_reason = left(coalesce(p_reason, 'unknown'), 200),
         total_denials = r.total_denials + 1,
         breaker_open = case when v_will_trip then true else r.breaker_open end,
         breaker_open_until = case when v_will_trip then v_now + make_interval(secs => v_cooldown) else r.breaker_open_until end,
         total_breaker_trips = case when v_will_trip and not v_was_open then r.total_breaker_trips + 1 else r.total_breaker_trips end,
         updated_at = v_now
   where r.store = p_store
  returning r.* into v_rec;

  return query select v_rec.breaker_open, v_rec.consecutive_denials, v_rec.breaker_open_until;
end;
$$;

-- Record a successful request. Resets the denial streak and fully closes the
-- breaker (a half-open probe that succeeds).
create or replace function public.record_retailer_success(p_store text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_store is null or btrim(p_store) = '' then
    raise exception 'store is required';
  end if;

  insert into public.retailer_request_governor (store)
  values (p_store)
  on conflict (store) do nothing;

  update public.retailer_request_governor r
     set consecutive_denials = 0,
         breaker_open = false,
         breaker_open_until = null,
         last_success_at = now(),
         updated_at = now()
   where r.store = p_store;
end;
$$;

-- Read-only snapshot for the scrape-watchdog alert. Reports which governed
-- retailers currently have an OPEN breaker so a paused retailer surfaces as an
-- actionable, delivered operational alert rather than silent stalling.
create or replace function public.retailer_governor_state()
returns table (
  store text,
  breaker_open boolean,
  breaker_open_until timestamptz,
  consecutive_denials integer,
  last_denial_at timestamptz,
  last_denial_reason text,
  last_success_at timestamptz,
  total_requests bigint,
  total_denials bigint,
  total_breaker_trips bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select r.store, r.breaker_open, r.breaker_open_until, r.consecutive_denials,
         r.last_denial_at, r.last_denial_reason, r.last_success_at,
         r.total_requests, r.total_denials, r.total_breaker_trips
  from public.retailer_request_governor r;
$$;

revoke all on public.retailer_request_governor from anon, authenticated;
revoke all on function public.acquire_retailer_request_slot(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.record_retailer_denial(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_retailer_success(text) from public, anon, authenticated;
revoke all on function public.retailer_governor_state() from public, anon, authenticated;

grant select, insert, update on public.retailer_request_governor to service_role;
grant execute on function public.acquire_retailer_request_slot(text, integer, integer, integer) to service_role;
grant execute on function public.record_retailer_denial(text, text, integer, integer) to service_role;
grant execute on function public.record_retailer_success(text) to service_role;
grant execute on function public.retailer_governor_state() to service_role;
