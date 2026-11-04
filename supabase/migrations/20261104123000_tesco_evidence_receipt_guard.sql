-- A source acquisition run cannot become a cached price-finalisation run.
-- The fixed run prefix avoids parsing historical free-text error summaries.
create function tesco_internal.reject_evidence_price_receipt()
returns trigger language plpgsql security invoker set search_path = '' as $body$
begin
  if exists(select 1 from public.scrape_runs r where r.id=new.run_id
    and r.store='tesco' and r.run_id like 'tesco_supervised_evidence_%') then
    raise exception 'evidence_only_price_forbidden';
  end if;
  return new;
end $body$;
revoke all on function tesco_internal.reject_evidence_price_receipt() from public,anon,authenticated,service_role;
create trigger reject_tesco_evidence_price_receipt
  before insert or update on public.scrape_product_receipts
  for each row execute function tesco_internal.reject_evidence_price_receipt();
