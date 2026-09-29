-- Private request evidence; no cookies, token-bearing headers or raw HTML.
create table public.tesco_direct_collection_pages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.scrape_runs(id) on delete cascade,
  egress_key text not null references public.tesco_egress_pool(egress_key),
  requested_url text not null,
  final_url text,
  mode text not null check (mode in ('probe', 'products', 'listings')),
  outcome text not null check (outcome in ('pending', 'ok', 'access_block', 'rate_limited', 'http_error', 'network_error', 'unsafe_redirect', 'parse_error')),
  http_status integer,
  retry_after text,
  elapsed_ms integer,
  body_sha256 text,
  parsed jsonb,
  identity_results jsonb not null default '[]'::jsonb,
  detail text,
  created_at timestamptz not null default now(),
  unique(run_id, requested_url)
);
alter table public.tesco_direct_collection_pages enable row level security;
revoke all on public.tesco_direct_collection_pages from public, anon, authenticated;
grant select, insert, update on public.tesco_direct_collection_pages to service_role;
create index tesco_direct_collection_pages_recent on public.tesco_direct_collection_pages(created_at desc, id);
create index tesco_direct_collection_pages_egress on public.tesco_direct_collection_pages(egress_key);

-- Preserve the 48-hour challenge policy; respect longer retailer instructions.
create or replace function public.pause_tesco_collection_egress(
  p_egress_key text, p_until timestamptz, p_blocked boolean default false
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.tesco_egress_pool
  set cooldown_until = greatest(cooldown_until, p_until,
        now() + case when p_blocked then interval '48 hours' else interval '15 minutes' end),
      leased_until = null,
      last_block_at = case when p_blocked then now() else last_block_at end,
      consecutive_blocks = consecutive_blocks + case when p_blocked then 1 else 0 end,
      total_blocks = total_blocks + case when p_blocked then 1 else 0 end,
      updated_at = now()
  where egress_key = p_egress_key;
  if not found then raise exception 'Unknown Tesco egress gate'; end if;
end;
$$;
revoke all on function public.pause_tesco_collection_egress(text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.pause_tesco_collection_egress(text, timestamptz, boolean) to service_role;
