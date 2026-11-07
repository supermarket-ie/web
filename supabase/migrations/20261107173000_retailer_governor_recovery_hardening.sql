-- Hardens the retailer request governor (base migration 20261107150000) after
-- an independent review. Four correctness fixes, all in the durable layer so
-- they hold across concurrent SQS-consumer tasks and restarts:
--
--  1. Exclusive, expiring half-open probe lease. After the cooldown the breaker
--     does NOT simply close; exactly ONE caller receives a probe lease and is
--     allowed through. Concurrent callers are still blocked until the probe
--     resolves or its lease expires.
--  2. Generation-bound recovery. Each time the breaker opens, a generation
--     counter advances. A success only clears the breaker if it carries the
--     CURRENT generation and the active probe token, so an earlier in-flight
--     success cannot clear a newer cooldown.
--  3. Durable full deadline. A long Retry-After is persisted as an absolute
--     deadline (`deadline_until`) and enforced across deliveries/restarts — it
--     is never shortened to the SQS 900s delivery cap.
--
-- This migration is additive (new columns, replaced functions) and must be
-- applied AFTER 20261107150000_retailer_request_governor.sql.

alter table public.retailer_request_governor
  add column if not exists generation bigint not null default 0,
  add column if not exists probe_token uuid,
  add column if not exists probe_leased_until timestamptz,
  add column if not exists deadline_until timestamptz;

-- Drop the prior signatures FIRST. CREATE OR REPLACE cannot change a function's
-- return type or OUT parameters, and the hardened versions add arguments and
-- change return columns, so the old ones must be removed before re-creation.
drop function if exists public.acquire_retailer_request_slot(text, integer, integer, integer);
drop function if exists public.record_retailer_denial(text, text, integer, integer);
drop function if exists public.record_retailer_success(text);
drop function if exists public.retailer_governor_state();

comment on column public.retailer_request_governor.generation is
  'Advances each time the breaker opens. A success must match this to clear the breaker (prevents a stale in-flight success clearing a newer cooldown).';
comment on column public.retailer_request_governor.probe_token is
  'Exclusive half-open probe lease holder. Only the caller that received this token may clear the breaker on success.';
comment on column public.retailer_request_governor.deadline_until is
  'Absolute, durable retailer pause deadline (e.g. a long Retry-After). Enforced across deliveries and restarts; never shortened to the queue delivery cap.';

-- Acquire one request slot. Adds the half-open probe lease and durable deadline
-- on top of the token bucket. Outputs gain the probe token + generation so a
-- later success can be bound to this exact probe.
create or replace function public.acquire_retailer_request_slot(
  p_store text,
  p_max_per_minute integer default 30,
  p_window_seconds integer default 60,
  p_breaker_cooldown_seconds integer default 900,
  p_probe_lease_seconds integer default 60
)
returns table (
  out_decision text,
  out_retry_after_ms integer,
  out_breaker_open boolean,
  out_window_count integer,
  out_consecutive_denials integer,
  out_generation bigint,
  out_probe_token uuid
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_seconds integer := greatest(1, least(coalesce(p_window_seconds, 60), 3600));
  v_max integer := greatest(1, least(coalesce(p_max_per_minute, 30), 100000));
  v_probe_lease integer := greatest(5, least(coalesce(p_probe_lease_seconds, 60), 900));
  v_window_elapsed numeric;
  v_remaining_ms integer;
  v_pause_until timestamptz;
  v_new_probe uuid;
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

  -- The retailer is paused while EITHER the breaker cooldown OR a durable
  -- deadline (e.g. a long Retry-After) is still in the future.
  v_pause_until := greatest(
    coalesce(v_rec.breaker_open_until, 'epoch'::timestamptz),
    coalesce(v_rec.deadline_until, 'epoch'::timestamptz)
  );

  if v_rec.breaker_open or (v_rec.deadline_until is not null and v_rec.deadline_until > v_now) then
    -- Still within the pause window -> blocked. retry_after is time-to-deadline.
    if v_pause_until > v_now then
      v_remaining_ms := ceil(extract(epoch from (v_pause_until - v_now)) * 1000);
      return query select 'blocked'::text, greatest(0, v_remaining_ms), v_rec.breaker_open,
                          v_rec.window_count, v_rec.consecutive_denials, v_rec.generation, null::uuid;
      return;
    end if;

    -- Pause elapsed. HALF-OPEN: grant an exclusive probe lease to exactly one
    -- caller. If a probe lease is already held and unexpired, everyone else is
    -- blocked until it resolves or expires.
    if v_rec.probe_token is not null and v_rec.probe_leased_until is not null and v_rec.probe_leased_until > v_now then
      v_remaining_ms := ceil(extract(epoch from (v_rec.probe_leased_until - v_now)) * 1000);
      return query select 'blocked'::text, greatest(1, v_remaining_ms), true,
                          v_rec.window_count, v_rec.consecutive_denials, v_rec.generation, null::uuid;
      return;
    end if;

    v_new_probe := gen_random_uuid();
    update public.retailer_request_governor r
       set probe_token = v_new_probe,
           probe_leased_until = v_now + make_interval(secs => v_probe_lease),
           total_requests = r.total_requests + 1,
           updated_at = v_now
     where r.store = p_store
    returning r.* into v_rec;
    -- The sole probe request is allowed through; it carries the generation and
    -- probe token so ONLY its success can close this breaker generation.
    return query select 'allowed'::text, 0, true,
                        v_rec.window_count, v_rec.consecutive_denials, v_rec.generation, v_new_probe;
    return;
  end if;

  -- Breaker fully closed. Token bucket (fixed window).
  v_window_elapsed := extract(epoch from (v_now - v_rec.window_started_at));
  if v_window_elapsed >= v_window_seconds then
    update public.retailer_request_governor r
       set window_started_at = v_now,
           window_count = 1,
           total_requests = r.total_requests + 1,
           updated_at = v_now
     where r.store = p_store
    returning r.* into v_rec;
    return query select 'allowed'::text, 0, false,
                        v_rec.window_count, v_rec.consecutive_denials, v_rec.generation, null::uuid;
    return;
  end if;

  if v_rec.window_count >= v_max then
    v_remaining_ms := ceil((v_window_seconds - v_window_elapsed) * 1000);
    return query select 'wait'::text, greatest(1, v_remaining_ms), false,
                        v_rec.window_count, v_rec.consecutive_denials, v_rec.generation, null::uuid;
    return;
  end if;

  update public.retailer_request_governor r
     set window_count = r.window_count + 1,
         total_requests = r.total_requests + 1,
         updated_at = v_now
   where r.store = p_store
  returning r.* into v_rec;
  return query select 'allowed'::text, 0, false,
                      v_rec.window_count, v_rec.consecutive_denials, v_rec.generation, null::uuid;
end;
$$;

-- Record a denial/throttle. Opens (or extends) the breaker, advances the
-- generation on an OPENING edge, clears any half-open probe, and persists the
-- FULL deadline: max of the cooldown and any server Retry-After (never
-- shortened). p_retry_after_ms carries a parsed Retry-After in milliseconds.
create or replace function public.record_retailer_denial(
  p_store text,
  p_reason text,
  p_trip_threshold integer default 5,
  p_cooldown_seconds integer default 900,
  p_retry_after_ms bigint default null
)
returns table (out_breaker_open boolean, out_consecutive_denials integer, out_breaker_open_until timestamptz, out_deadline_until timestamptz, out_generation bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_threshold integer := greatest(1, least(coalesce(p_trip_threshold, 5), 1000));
  v_cooldown integer := greatest(30, least(coalesce(p_cooldown_seconds, 900), 86400));
  v_retry_after interval := case when coalesce(p_retry_after_ms, 0) > 0
                                 then make_interval(secs => p_retry_after_ms / 1000.0)
                                 else null end;
  v_rec public.retailer_request_governor%rowtype;
  v_will_trip boolean;
  v_was_open boolean;
  v_cooldown_until timestamptz;
  v_deadline timestamptz;
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
  v_cooldown_until := v_now + make_interval(secs => v_cooldown);

  -- Durable deadline: never shorten. Keep the furthest of the existing
  -- deadline, the (new) cooldown when tripping, and any Retry-After hint.
  v_deadline := v_rec.deadline_until;
  if v_retry_after is not null then
    v_deadline := greatest(coalesce(v_deadline, v_now), v_now + v_retry_after);
  end if;
  if v_will_trip then
    v_deadline := greatest(coalesce(v_deadline, v_now), v_cooldown_until);
  end if;

  update public.retailer_request_governor r
     set consecutive_denials = r.consecutive_denials + 1,
         last_denial_at = v_now,
         last_denial_reason = left(coalesce(p_reason, 'unknown'), 200),
         total_denials = r.total_denials + 1,
         breaker_open = case when v_will_trip then true else r.breaker_open end,
         breaker_open_until = case when v_will_trip then v_cooldown_until else r.breaker_open_until end,
         -- Advance generation on an OPENING edge (closed -> open) or when an
         -- already-open breaker is re-tripped by a failed probe, so a stale
         -- success for the prior generation can never clear this pause.
         generation = case when v_will_trip then r.generation + 1 else r.generation end,
         -- A denial invalidates any outstanding probe lease.
         probe_token = case when v_will_trip then null else r.probe_token end,
         probe_leased_until = case when v_will_trip then null else r.probe_leased_until end,
         deadline_until = v_deadline,
         total_breaker_trips = case when v_will_trip and not v_was_open then r.total_breaker_trips + 1 else r.total_breaker_trips end,
         updated_at = v_now
   where r.store = p_store
  returning r.* into v_rec;

  return query select v_rec.breaker_open, v_rec.consecutive_denials, v_rec.breaker_open_until, v_rec.deadline_until, v_rec.generation;
end;
$$;

-- Record a success. Recovery is bound to the current generation AND the active
-- probe token: a success only clears the breaker if it is the probe that was
-- leased for the CURRENT generation. A success with no token (an ordinary
-- allowed request while the breaker is closed) still resets the denial streak.
-- A stale success (old generation, or a token that no longer matches) is
-- ignored for breaker purposes so it cannot clear a newer cooldown.
create or replace function public.record_retailer_success(
  p_store text,
  p_generation bigint default null,
  p_probe_token uuid default null
)
returns table (out_breaker_open boolean, out_cleared boolean, out_generation bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_rec public.retailer_request_governor%rowtype;
  v_cleared boolean := false;
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

  if v_rec.breaker_open then
    -- Only the current-generation probe holder may close the breaker.
    if p_probe_token is not null
       and v_rec.probe_token is not null
       and p_probe_token = v_rec.probe_token
       and (p_generation is null or p_generation = v_rec.generation) then
      update public.retailer_request_governor r
         set breaker_open = false,
             breaker_open_until = null,
             deadline_until = null,
             consecutive_denials = 0,
             probe_token = null,
             probe_leased_until = null,
             last_success_at = v_now,
             updated_at = v_now
       where r.store = p_store
      returning r.* into v_rec;
      v_cleared := true;
    else
      -- Stale/unbound success while the breaker is open: record reachability
      -- but DO NOT clear the active cooldown or reset the streak.
      update public.retailer_request_governor r
         set last_success_at = v_now, updated_at = v_now
       where r.store = p_store
      returning r.* into v_rec;
    end if;
  else
    -- Breaker closed: a success just resets the denial streak.
    update public.retailer_request_governor r
       set consecutive_denials = 0,
           last_success_at = v_now,
           updated_at = v_now
     where r.store = p_store
    returning r.* into v_rec;
    v_cleared := true;
  end if;

  return query select v_rec.breaker_open, v_cleared, v_rec.generation;
end;
$$;

-- State snapshot gains the durable deadline + generation for the watchdog.
create or replace function public.retailer_governor_state()
returns table (
  store text,
  breaker_open boolean,
  breaker_open_until timestamptz,
  deadline_until timestamptz,
  generation bigint,
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
  select r.store, r.breaker_open, r.breaker_open_until, r.deadline_until, r.generation,
         r.consecutive_denials, r.last_denial_at, r.last_denial_reason, r.last_success_at,
         r.total_requests, r.total_denials, r.total_breaker_trips
  from public.retailer_request_governor r;
$$;

-- Re-grant for the new signatures (old signatures are replaced in place where
-- the argument list is unchanged; the two that changed args get fresh grants).
revoke all on function public.acquire_retailer_request_slot(text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.record_retailer_denial(text, text, integer, integer, bigint) from public, anon, authenticated;
revoke all on function public.record_retailer_success(text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.retailer_governor_state() from public, anon, authenticated;

grant execute on function public.acquire_retailer_request_slot(text, integer, integer, integer, integer) to service_role;
grant execute on function public.record_retailer_denial(text, text, integer, integer, bigint) to service_role;
grant execute on function public.record_retailer_success(text, bigint, uuid) to service_role;
grant execute on function public.retailer_governor_state() to service_role;
