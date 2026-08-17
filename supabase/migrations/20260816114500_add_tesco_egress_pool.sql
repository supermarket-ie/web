create table if not exists public.tesco_egress_pool (
  egress_key text primary key,
  label text not null,
  enabled boolean not null default true,
  priority integer not null default 100,
  cooldown_until timestamptz,
  leased_until timestamptz,
  last_success_at timestamptz,
  last_block_at timestamptz,
  consecutive_blocks integer not null default 0,
  total_successes bigint not null default 0,
  total_blocks bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tesco_egress_pool enable row level security;

create index if not exists tesco_egress_pool_available_idx
  on public.tesco_egress_pool (enabled, cooldown_until, leased_until, priority);

create or replace function public.claim_tesco_egress(p_lease_seconds integer default 900)
returns table (egress_key text, label text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_key text;
begin
  select p.egress_key
    into v_key
  from public.tesco_egress_pool p
  where p.enabled = true
    and (p.cooldown_until is null or p.cooldown_until <= now())
    and (p.leased_until is null or p.leased_until <= now())
  order by p.priority asc, p.last_success_at desc nulls last, p.egress_key asc
  for update skip locked
  limit 1;

  if v_key is null then
    return;
  end if;

  update public.tesco_egress_pool p
     set leased_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600))),
         updated_at = now()
   where p.egress_key = v_key;

  return query
  select p.egress_key, p.label
  from public.tesco_egress_pool p
  where p.egress_key = v_key;
end;
$$;

create or replace function public.mark_tesco_egress_success(p_egress_key text)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.tesco_egress_pool
     set leased_until = null,
         cooldown_until = null,
         last_success_at = now(),
         consecutive_blocks = 0,
         total_successes = total_successes + 1,
         updated_at = now()
   where egress_key = p_egress_key;
$$;

create or replace function public.mark_tesco_egress_blocked(
  p_egress_key text,
  p_cooldown_hours integer default 48
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.tesco_egress_pool
     set leased_until = null,
         cooldown_until = now() + make_interval(hours => greatest(24, least(coalesce(p_cooldown_hours, 48), 96))),
         last_block_at = now(),
         consecutive_blocks = consecutive_blocks + 1,
         total_blocks = total_blocks + 1,
         updated_at = now()
   where egress_key = p_egress_key;
$$;

create or replace function public.release_tesco_egress(p_egress_key text)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.tesco_egress_pool
     set leased_until = null,
         updated_at = now()
   where egress_key = p_egress_key;
$$;

revoke all on public.tesco_egress_pool from anon, authenticated;
revoke all on function public.claim_tesco_egress(integer) from public, anon, authenticated;
revoke all on function public.mark_tesco_egress_success(text) from public, anon, authenticated;
revoke all on function public.mark_tesco_egress_blocked(text, integer) from public, anon, authenticated;
revoke all on function public.release_tesco_egress(text) from public, anon, authenticated;

grant select, insert, update on public.tesco_egress_pool to service_role;
grant execute on function public.claim_tesco_egress(integer) to service_role;
grant execute on function public.mark_tesco_egress_success(text) to service_role;
grant execute on function public.mark_tesco_egress_blocked(text, integer) to service_role;
grant execute on function public.release_tesco_egress(text) to service_role;
