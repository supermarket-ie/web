-- Forward-only production reconciliation checkpoint.
--
-- Historical Supabase migration timestamps predate consistent repository
-- tracking and are intentionally not rewritten. This checkpoint asserts the
-- production objects that were verified on 2026-09-03 and establishes the
-- exact shared migration version from which future changes must proceed.

do $$
begin
  if to_regclass('public.trusted_retailer_offers') is null then
    raise exception 'trusted_retailer_offers is missing';
  end if;
  if to_regclass('public.latest_prices') is null then
    raise exception 'latest_prices is missing';
  end if;
  if to_regclass('public.agent_tasks') is null then
    raise exception 'agent_tasks is missing';
  end if;
  if to_regclass('public.product_search_embeddings') is null then
    raise exception 'product_search_embeddings is missing';
  end if;
  if to_regclass('public.product_embedding_jobs') is null then
    raise exception 'product_embedding_jobs is missing';
  end if;
  if to_regclass('public.ops_manual_dispatches') is null then
    raise exception 'ops_manual_dispatches is missing';
  end if;
  if to_regclass('public.store_product_alternative_candidates') is null then
    raise exception 'store_product_alternative_candidates is missing';
  end if;
  if to_regclass('public.pepesto_tesco_sessions') is null then
    raise exception 'pepesto_tesco_sessions is missing';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'agent_tasks',
        'product_search_embeddings',
        'product_embedding_jobs',
        'ops_manual_dispatches',
        'store_product_alternative_candidates',
        'pepesto_tesco_sessions'
      )
      and not c.relrowsecurity
  ) then
    raise exception 'one or more protected reconciliation tables has RLS disabled';
  end if;
end
$$;

comment on schema public is 'Production schema reconciled against repository checkpoint on 2026-09-03; historical migration timestamp drift is preserved and future changes are forward-only.';
