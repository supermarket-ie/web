-- Lightweight stateless shopping-agent PoC: safeguard tables + atomic RPCs.
--
-- All state for the PoC lives here (no in-process/session state), so the same
-- limits are enforced across multiple ECS tasks with no sticky routing. Every
-- RPC is SECURITY DEFINER, atomic (row-locking via UPDATE ... RETURNING or
-- SELECT ... FOR UPDATE), and returns a clear boolean + reason so the caller
-- can FAIL CLOSED on any error.
--
-- No raw prompt text is ever stored — only token counts, costs and outcomes.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.agent_conversations (
  id uuid primary key default gen_random_uuid(),
  guest_key text not null,
  subscriber_id text,
  created_at timestamptz not null default now(),
  message_count integer not null default 0,
  last_active timestamptz not null default now()
);
create index if not exists agent_conversations_guest_key_idx
  on public.agent_conversations (guest_key, last_active desc);

create table if not exists public.agent_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations (id) on delete cascade,
  guest_key text not null,
  subscriber_id text,
  role text not null default 'assistant',
  created_at timestamptz not null default now(),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  est_cost_cents numeric(12, 4) not null default 0,
  outcome text not null,
  model text
  -- Intentionally NO prompt/message text columns: token counts + outcomes only.
);
create index if not exists agent_turns_created_at_idx on public.agent_turns (created_at);
create index if not exists agent_turns_conversation_idx on public.agent_turns (conversation_id);

create table if not exists public.agent_guest_limits (
  guest_key text primary key,
  hour_window timestamptz not null default date_trunc('hour', now()),
  hour_count integer not null default 0,
  day_window date not null default (now() at time zone 'utc')::date,
  day_count integer not null default 0,
  active_requests integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_bedrock_spend_ledger (
  utc_day date primary key,
  reserved_cents numeric(14, 4) not null default 0,
  settled_cents numeric(14, 4) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_bedrock_spend_reservations (
  id uuid primary key default gen_random_uuid(),
  utc_day date not null,
  estimate_cents numeric(12, 4) not null,
  settled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists agent_bedrock_spend_reservations_day_idx
  on public.agent_bedrock_spend_reservations (utc_day);

-- ---------------------------------------------------------------------------
-- Limits (tunable constants, inlined in the RPCs below)
--   hourly messages per guest:        10
--   daily messages per guest:         30
--   concurrent active per guest:       1
--   messages per conversation:        15
--   concurrent-lock staleness window:  5 minutes (auto-release of a crashed turn)
--   daily Bedrock spend ceiling:    1000 cents ($10)
-- ---------------------------------------------------------------------------

-- Atomic rate check. Rolls the hour/day windows forward, enforces the hourly,
-- daily, conversation and concurrency caps, and (on success) claims ONE active
-- request. Returns (allowed, reason). Row-locked via INSERT ... ON CONFLICT ...
-- plus a FOR UPDATE re-read so two tasks cannot both pass the concurrency gate.
create or replace function public.agent_guest_rate_check(
  p_guest_key text,
  p_conversation_id uuid
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_hour timestamptz := date_trunc('hour', v_now);
  v_day date := (v_now at time zone 'utc')::date;
  v_stale timestamptz := v_now - interval '5 minutes';
  v_row public.agent_guest_limits%rowtype;
  v_conv_count integer;
begin
  -- Conversation length cap (15 messages/conversation). A missing conversation
  -- is allowed here (the ensure RPC creates it); only an over-cap existing
  -- conversation is rejected.
  if p_conversation_id is not null then
    select message_count into v_conv_count
      from public.agent_conversations
      where id = p_conversation_id;
    if found and v_conv_count >= 15 then
      return query select false, 'conversation_limit';
      return;
    end if;
  end if;

  -- Ensure a limits row exists, then lock it.
  insert into public.agent_guest_limits (guest_key, hour_window, hour_count, day_window, day_count, active_requests, updated_at)
    values (p_guest_key, v_hour, 0, v_day, 0, 0, v_now)
    on conflict (guest_key) do nothing;

  select * into v_row from public.agent_guest_limits
    where guest_key = p_guest_key
    for update;

  -- Roll windows forward.
  if v_row.hour_window < v_hour then
    v_row.hour_window := v_hour;
    v_row.hour_count := 0;
  end if;
  if v_row.day_window < v_day then
    v_row.day_window := v_day;
    v_row.day_count := 0;
  end if;

  -- Auto-release a stale concurrent lock (crashed/abandoned turn).
  if v_row.active_requests > 0 and v_row.updated_at < v_stale then
    v_row.active_requests := 0;
  end if;

  if v_row.hour_count >= 10 then
    update public.agent_guest_limits
      set hour_window = v_row.hour_window, hour_count = v_row.hour_count,
          day_window = v_row.day_window, day_count = v_row.day_count, updated_at = v_now
      where guest_key = p_guest_key;
    return query select false, 'hour_limit';
    return;
  end if;
  if v_row.day_count >= 30 then
    update public.agent_guest_limits
      set hour_window = v_row.hour_window, hour_count = v_row.hour_count,
          day_window = v_row.day_window, day_count = v_row.day_count, updated_at = v_now
      where guest_key = p_guest_key;
    return query select false, 'day_limit';
    return;
  end if;
  if v_row.active_requests >= 1 then
    update public.agent_guest_limits
      set active_requests = v_row.active_requests, updated_at = v_now
      where guest_key = p_guest_key;
    return query select false, 'concurrent_limit';
    return;
  end if;

  -- Allowed: count the message and claim the active-request lock atomically.
  update public.agent_guest_limits
    set hour_window = v_row.hour_window,
        hour_count = v_row.hour_count + 1,
        day_window = v_row.day_window,
        day_count = v_row.day_count + 1,
        active_requests = v_row.active_requests + 1,
        updated_at = v_now
    where guest_key = p_guest_key;

  return query select true, 'ok';
end;
$$;

-- Release one active-request lock (called on finish/timeout).
create or replace function public.agent_guest_release(p_guest_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.agent_guest_limits
    set active_requests = greatest(0, active_requests - 1), updated_at = now()
    where guest_key = p_guest_key;
end;
$$;

-- Ensure/lookup a conversation row, enforcing the ≤15 messages/conversation cap.
-- Creates the row when p_conversation_id is null or unknown. Returns
-- (allowed, reason, conversation_id, message_count).
create or replace function public.agent_conversation_ensure(
  p_conversation_id uuid,
  p_guest_key text,
  p_subscriber_id text
)
returns table (allowed boolean, reason text, conversation_id uuid, message_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer;
begin
  if p_conversation_id is not null then
    select id, message_count into v_id, v_count
      from public.agent_conversations
      where id = p_conversation_id
      for update;
    if found then
      if v_count >= 15 then
        return query select false, 'conversation_limit', v_id, v_count;
        return;
      end if;
      return query select true, 'ok', v_id, v_count;
      return;
    end if;
  end if;

  insert into public.agent_conversations (id, guest_key, subscriber_id)
    values (coalesce(p_conversation_id, gen_random_uuid()), p_guest_key, p_subscriber_id)
    returning id, message_count into v_id, v_count;
  return query select true, 'ok', v_id, v_count;
end;
$$;

-- Reserve estimated spend BEFORE the model call, keyed by UTC day with a
-- $10/day ceiling. Atomic: locks the ledger row, checks reserved+settled, and
-- only inserts a reservation if it stays under the ceiling. Returns
-- (ok, reservation_id).
create or replace function public.agent_bedrock_spend_reserve(p_estimate_cents numeric)
returns table (ok boolean, reservation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_ceiling numeric := 1000;  -- $10/day in cents
  v_reserved numeric;
  v_settled numeric;
  v_res_id uuid;
begin
  insert into public.agent_bedrock_spend_ledger (utc_day) values (v_day)
    on conflict (utc_day) do nothing;

  select reserved_cents, settled_cents into v_reserved, v_settled
    from public.agent_bedrock_spend_ledger
    where utc_day = v_day
    for update;

  -- Count both outstanding reservations and settled spend against the ceiling.
  if greatest(v_reserved, v_settled) + p_estimate_cents > v_ceiling then
    return query select false, null::uuid;
    return;
  end if;

  insert into public.agent_bedrock_spend_reservations (utc_day, estimate_cents)
    values (v_day, p_estimate_cents)
    returning id into v_res_id;

  update public.agent_bedrock_spend_ledger
    set reserved_cents = reserved_cents + p_estimate_cents, updated_at = now()
    where utc_day = v_day;

  return query select true, v_res_id;
end;
$$;

-- Reconcile a reservation to actual spend. Atomic: marks the reservation
-- settled (idempotent) and adjusts the ledger so reserved reflects the estimate
-- being retired and settled reflects the real cost.
create or replace function public.agent_bedrock_spend_settle(
  p_reservation_id uuid,
  p_actual_cents numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_estimate numeric;
  v_already boolean;
begin
  select utc_day, estimate_cents, settled into v_day, v_estimate, v_already
    from public.agent_bedrock_spend_reservations
    where id = p_reservation_id
    for update;
  if not found or v_already then
    return;  -- unknown or already settled: idempotent no-op
  end if;

  update public.agent_bedrock_spend_reservations
    set settled = true where id = p_reservation_id;

  update public.agent_bedrock_spend_ledger
    set reserved_cents = greatest(0, reserved_cents - v_estimate),
        settled_cents = settled_cents + greatest(0, p_actual_cents),
        updated_at = now()
    where utc_day = v_day;
end;
$$;

-- Record a completed turn: write the token/cost/outcome row (NO prompt text),
-- bump the conversation counters and release the active-request lock. One
-- atomic server call keeps the stateless route simple.
create or replace function public.agent_turn_record(
  p_conversation_id uuid,
  p_guest_key text,
  p_subscriber_id text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_est_cost_cents numeric,
  p_outcome text,
  p_model text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.agent_turns (
    conversation_id, guest_key, subscriber_id, role,
    input_tokens, output_tokens, est_cost_cents, outcome, model
  ) values (
    p_conversation_id, p_guest_key, p_subscriber_id, 'assistant',
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
    coalesce(p_est_cost_cents, 0), p_outcome, p_model
  );

  update public.agent_conversations
    set message_count = message_count + 1, last_active = now()
    where id = p_conversation_id;

  update public.agent_guest_limits
    set active_requests = greatest(0, active_requests - 1), updated_at = now()
    where guest_key = p_guest_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily usage observability view
-- ---------------------------------------------------------------------------
create or replace view public.agent_usage_daily as
select
  (t.created_at at time zone 'utc')::date                               as utc_day,
  count(*)                                                              as requests,
  round(sum(t.est_cost_cents), 4)                                       as est_spend_cents,
  sum(t.input_tokens)                                                   as input_tokens,
  sum(t.output_tokens)                                                  as output_tokens,
  count(*) filter (where t.outcome in ('hour_limit', 'day_limit', 'concurrent_limit', 'conversation_limit'))
                                                                        as rate_limit_rejections,
  count(*) filter (where t.outcome = 'spend_blocked')                   as breaker_blocks,
  count(*) filter (where t.outcome = 'model_error')                     as model_errors,
  count(*) filter (where t.subscriber_id is null)                       as guest_requests,
  count(*) filter (where t.subscriber_id is not null)                   as authenticated_requests
from public.agent_turns t
group by (t.created_at at time zone 'utc')::date
order by utc_day desc;

-- ---------------------------------------------------------------------------
-- Grants: service_role only (the PoC uses the service key; no anon/authenticated).
-- ---------------------------------------------------------------------------
revoke all on function public.agent_guest_rate_check(text, uuid) from public, anon, authenticated;
revoke all on function public.agent_guest_release(text) from public, anon, authenticated;
revoke all on function public.agent_conversation_ensure(uuid, text, text) from public, anon, authenticated;
revoke all on function public.agent_bedrock_spend_reserve(numeric) from public, anon, authenticated;
revoke all on function public.agent_bedrock_spend_settle(uuid, numeric) from public, anon, authenticated;
revoke all on function public.agent_turn_record(uuid, text, text, integer, integer, numeric, text, text) from public, anon, authenticated;

grant execute on function public.agent_guest_rate_check(text, uuid) to service_role;
grant execute on function public.agent_guest_release(text) to service_role;
grant execute on function public.agent_conversation_ensure(uuid, text, text) to service_role;
grant execute on function public.agent_bedrock_spend_reserve(numeric) to service_role;
grant execute on function public.agent_bedrock_spend_settle(uuid, numeric) to service_role;
grant execute on function public.agent_turn_record(uuid, text, text, integer, integer, numeric, text, text) to service_role;
