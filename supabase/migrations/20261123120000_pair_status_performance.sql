-- Performance hotfix for current_pair_review_status (22 Nov 2026): the product-detail page path measured 5.35 s and
-- ~1.47 M shared-buffer hits for 350 active reviews.
-- Causes:
--   1. retailer_identity_responses had no index on store_product_id: every side scanned the whole table.
--   2. The function materialised ONE global "observed" set and then filtered it with correlated subqueries per side
--      (three times per side), which is quadratic in the number of observations.
-- Fix: the missing indexes, and the SAME rules evaluated per side in one LATERAL aggregate over that side's own
-- index-backed evidence. Semantics are unchanged (identical CASE order, stickiness, 14-day and 365-day rules,
-- Dunnes captured_product_api, observations, Tesco pages by exact product URL); the return type and grants are
-- unchanged. Verified by the existing durable / machine approval test suites, which load this migration.

create index if not exists retailer_identity_responses_offer
  on public.retailer_identity_responses (store_product_id, retrieved_at desc);
create index if not exists store_products_store_sku on public.store_products (store, store_sku);

create or replace function public.current_pair_review_status(p_now timestamptz default now(), p_active_only boolean default false)
returns table (
  left_offer_id uuid, right_offer_id uuid, classification text,
  left_source_hash text, right_source_hash text,
  left_evidence_at timestamptz, right_evidence_at timestamptz,
  reviewed_at timestamptz, rationale text, reviewer text,
  status text
)
language sql stable security invoker set search_path = '' as $$
  with latest as (
    select distinct on (r.left_offer_id, r.right_offer_id) r.*
    from public.retailer_offer_pair_reviews r
    where r.reviewed_at <= p_now
    order by r.left_offer_id, r.right_offer_id, r.reviewed_at desc, r.created_at desc, r.id desc
  ),
  sides as (
    select l.left_offer_id as l_id, l.right_offer_id as r_id, s.which, s.offer_id, s.sku, s.approved, s.src_at
    from latest l
    cross join lateral (values
      ('left', l.left_offer_id, l.left_sku, l.left_identity, l.left_captured_at),
      ('right', l.right_offer_id, l.right_sku, l.right_identity, l.right_captured_at)
    ) as s(which, offer_id, sku, approved, src_at)
    where l.classification in ('exact_product', 'comparable_alternative')
  ),
  per_side as (
    select x.l_id, x.r_id, x.which, ev.evidence_at,
      case
        when x.sku is null or x.approved is null then 'suspended_unmonitorable'
        when sp.store_sku is distinct from x.sku
          or (select count(*) from public.store_products d where d.store = sp.store and d.store_sku = sp.store_sku) <> 1
          -- STICKY: an observation under a different SKU since approval (reassigned, even if reverted)
          or ev.any_other_sku then 'suspended_sku_changed'
        -- STICKY: any title-bearing observation since approval that contradicts a stated attribute
        when ev.any_changed then 'suspended_identity_changed'
        when coalesce(ev.evidence_at, '-infinity') < p_now - interval '14 days' then 'suspended_no_recent_evidence'
        else 'active'
      end as side_status
    from sides x
    left join public.store_products sp on sp.id = x.offer_id
    -- Every usable observation of THIS side since its approval evidence (the approval's own evidence included),
    -- each source read through its own index.
    cross join lateral (
      select max(o.at) filter (where o.sku = x.sku and public.identity_usable(o.projection)) as evidence_at,
        coalesce(bool_or(o.sku is distinct from x.sku), false) as any_other_sku,
        coalesce(bool_or(public.identity_changed(x.approved, o.projection)), false) as any_changed
      from (
        select x.src_at as at, x.approved as projection, x.sku as sku
        where sp.id is not null
        union all
        select p.created_at, public.tesco_page_projection(p.parsed, sp.store_sku), sp.store_sku
        from public.tesco_direct_collection_pages p
        where sp.store = 'tesco' and p.requested_url = 'https://www.tesco.ie/shop/en-IE/products/' || sp.store_sku
          and p.created_at >= x.src_at and p.created_at <= p_now
          and p.outcome = 'ok' and p.http_status = 200 and p.body_sha256 is not null
        union all
        select e.retrieved_at, public.retailer_identity_projection(e.identity), e.sku
        from public.retailer_identity_responses e
        where e.store_product_id = sp.id
          and e.retrieved_at >= x.src_at and e.retrieved_at <= p_now
          and (e.source_kind = 'captured_product' or (sp.store = 'dunnes' and e.source_kind = 'captured_product_api'))
        union all
        select o.observed_at, o.identity_projection, o.sku
        from public.retailer_identity_observations o
        where o.store_product_id = sp.id and o.observed_at >= x.src_at and o.observed_at <= p_now
      ) o
      where o.projection ? 'title'
    ) ev
  ),
  result as (
    select l.left_offer_id, l.right_offer_id, l.classification, l.left_source_hash, l.right_source_hash,
      max(s.evidence_at) filter (where s.which = 'left') as left_evidence_at,
      max(s.evidence_at) filter (where s.which = 'right') as right_evidence_at,
      l.reviewed_at, l.rationale, l.reviewer,
      case
        when l.reviewed_at < p_now - interval '365 days' then 'expired_needs_review'
        when count(s.*) <> 2 then 'suspended_unmonitorable'
        when bool_or(s.side_status = 'suspended_sku_changed') then 'suspended_sku_changed'
        when bool_or(s.side_status = 'suspended_unmonitorable') then 'suspended_unmonitorable'
        when bool_or(s.side_status = 'suspended_identity_changed') then 'suspended_identity_changed'
        when bool_or(s.side_status = 'suspended_no_recent_evidence') then 'suspended_no_recent_evidence'
        else 'active'
      end as status
    from latest l
    left join per_side s on s.l_id = l.left_offer_id and s.r_id = l.right_offer_id
    where l.classification in ('exact_product', 'comparable_alternative')
    group by l.left_offer_id, l.right_offer_id, l.classification, l.left_source_hash, l.right_source_hash,
      l.reviewed_at, l.rationale, l.reviewer
  )
  select * from result where not p_active_only or status = 'active'
  order by left_offer_id, right_offer_id
$$;
revoke all on function public.current_pair_review_status(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.current_pair_review_status(timestamptz, boolean) to service_role;
