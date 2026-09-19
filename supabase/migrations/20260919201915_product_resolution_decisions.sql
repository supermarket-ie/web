create table public.product_resolution_decisions (
  id uuid primary key default gen_random_uuid(),
  failure_id uuid not null references public.scrape_failures(id) on delete cascade,
  store_product_id uuid not null references public.store_products(id) on delete cascade,
  store text not null check (store in ('supervalu', 'dunnes')),
  action text not null check (action in ('exact', 'unavailable', 'skipped')),
  candidate_store_sku text,
  candidate_store_product_name text,
  candidate_store_url text,
  observed_price numeric check (observed_price is null or observed_price > 0),
  note text,
  decided_at timestamptz not null default now(),
  unique (failure_id)
);

alter table public.product_resolution_decisions enable row level security;
revoke all on public.product_resolution_decisions from public, anon, authenticated;
grant select, insert on public.product_resolution_decisions to service_role;

create index product_resolution_decisions_store_decided
  on public.product_resolution_decisions (store, decided_at desc);
create index product_resolution_decisions_store_product
  on public.product_resolution_decisions (store_product_id);

create or replace view public.product_resolution_queue
with (security_invoker = true)
as
with latest_targeted as (
  select distinct on (store) id, store
  from public.scrape_runs
  where store in ('supervalu', 'dunnes')
    and run_scope = 'targeted_validation'
    and status <> 'running'
  order by store, started_at desc
),
demand as (
  select
    p.id as product_id,
    sum(greatest(coalesce(li.quantity, 1), 1))::integer as demand_units,
    row_number() over (
      order by sum(greatest(coalesce(li.quantity, 1), 1)) desc, p.id
    )::integer as demand_rank
  from public.list_items li
  join public.products p on lower(btrim(p.canonical_name)) = lower(btrim(li.canonical_name))
  group by p.id
)
select
  f.id as failure_id,
  f.run_id,
  f.store,
  f.store_product_id,
  sp.product_id,
  f.canonical_name,
  sp.store_product_name,
  sp.store_sku,
  sp.store_url,
  f.failure_reason,
  f.raw_error,
  f.created_at,
  coalesce(d.demand_units, 0) as demand_units,
  d.demand_rank
from latest_targeted lr
join public.scrape_failures f on f.run_id = lr.id and f.store = lr.store
join public.store_products sp on sp.id = f.store_product_id
left join demand d on d.product_id = sp.product_id
left join public.product_resolution_decisions decision on decision.failure_id = f.id
where decision.id is null
  and f.failure_reason in ('no_confident_remap', 'empty_product_state', 'direct_name_mismatch', 'no_confident_match', 'no_search_results');

revoke all on public.product_resolution_queue from public, anon, authenticated;
grant select on public.product_resolution_queue to service_role;

create or replace function public.resolve_product_resolution(
  p_failure_id uuid,
  p_action text,
  p_candidate_sku text default null,
  p_candidate_name text default null,
  p_candidate_url text default null,
  p_price numeric default null,
  p_note text default null
) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_failure public.scrape_failures%rowtype;
  v_store_product public.store_products%rowtype;
begin
  if p_action not in ('exact', 'unavailable', 'skipped') then
    raise exception 'Unsupported resolution action';
  end if;

  select * into v_failure from public.scrape_failures where id = p_failure_id for update;
  if not found or v_failure.store not in ('supervalu', 'dunnes') or v_failure.store_product_id is null then
    raise exception 'Resolution failure row is not eligible';
  end if;
  select * into v_store_product from public.store_products where id = v_failure.store_product_id for update;

  if p_action = 'exact' then
    if p_candidate_sku is null or btrim(p_candidate_sku) = ''
      or p_candidate_name is null or btrim(p_candidate_name) = ''
      or p_candidate_url is null or btrim(p_candidate_url) = ''
      or p_price is null or p_price <= 0 then
      raise exception 'Exact resolution requires SKU, name, URL and positive price';
    end if;
    if coalesce(v_failure.raw_error, '') not like '%' || p_candidate_sku || ':%' then
      raise exception 'Candidate SKU is not present in the captured retailer evidence';
    end if;

    update public.store_products set
      store_product_name = p_candidate_name,
      store_sku = p_candidate_sku,
      store_url = p_candidate_url,
      url_status = 'resolved',
      url_last_checked_at = now(),
      url_last_error = null
    where id = v_store_product.id;

    insert into public.price_observations (store_product_id, price, observed_at, source)
    values (v_store_product.id, p_price, now(), case when v_failure.store = 'dunnes' then 'dunnes_direct' else 'supervalu_direct' end);
  elsif p_action = 'unavailable' then
    update public.store_products set
      url_status = 'unresolved',
      url_last_checked_at = now(),
      url_last_error = 'admin_marked_unavailable'
    where id = v_store_product.id;
  end if;

  insert into public.product_resolution_decisions (
    failure_id, store_product_id, store, action, candidate_store_sku,
    candidate_store_product_name, candidate_store_url, observed_price, note
  ) values (
    p_failure_id, v_store_product.id, v_failure.store, p_action, p_candidate_sku,
    p_candidate_name, p_candidate_url, p_price, nullif(btrim(p_note), '')
  );
  return true;
end;
$$;

revoke all on function public.resolve_product_resolution(uuid,text,text,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.resolve_product_resolution(uuid,text,text,text,text,numeric,text) to service_role;
