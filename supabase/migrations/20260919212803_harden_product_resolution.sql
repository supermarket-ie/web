-- Harden the service-role resolution primitive. The application now derives
-- candidate identity from captured retailer evidence, but the database still
-- verifies the complete tuple and retailer URL before writing trusted state.
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
  v_evidence text;
begin
  if p_action not in ('exact', 'skipped') then
    raise exception 'Unsupported resolution action: retailer absence requires repeated independent evidence';
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
    if p_candidate_name like '%|%' or p_candidate_name like '%:%' then
      raise exception 'Candidate name contains unsupported evidence delimiters';
    end if;
    v_evidence := p_candidate_sku || ':' || p_candidate_name || ':€' || p_price::text;
    if strpos(coalesce(v_failure.raw_error, ''), v_evidence) = 0 then
      raise exception 'Complete candidate tuple is not present in captured retailer evidence';
    end if;
    if v_failure.store = 'dunnes' then
      if p_candidate_url not like ('https://www.dunnesstoresgrocery.com/%/' || p_candidate_sku) then
        raise exception 'Candidate URL does not match Dunnes evidence';
      end if;
    elsif p_candidate_url not like ('https://shop.supervalu.ie/%-id-' || p_candidate_sku) then
      raise exception 'Candidate URL does not match SuperValu evidence';
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
