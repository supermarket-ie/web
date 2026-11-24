-- Pair-status cost, part 3 (24 Nov 2026), from the PRODUCTION plan: current_pair_review_status_json(now(), true) took ~6.3 s for
-- 3,118 side evaluations at ~1.98 ms each (80,041 buffer hits in the identity-response index scans, repeated Tesco page and
-- identity projections), and the wide `latest` materialisation still spilled (temp read/written 288). The evidence indexes were
-- used; the cost is re-deriving, on EVERY read, an aggregate over evidence that is append-only.
--
-- Fix: the per-side evidence aggregate is MAINTAINED incrementally.
--   * pair_review_side_cache(review_id, which): evidence_at (max usable observation time), any_other_sku and any_changed (both
--     STICKY, so they only ever turn true). Evidence tables are append-only, so max/OR folding is exact.
--   * pair_review_cache_state: ONE global watermark. refresh_pair_review_side_cache() finds the offers that have evidence RECORDED
--     since the watermark (minus a 10-minute margin for long transactions; re-folding rows is idempotent) through indexes on
--     recorded_at / created_at, and folds only those sides plus sides that have no cache row yet. It applies the SAME source
--     filters, projections and comparisons as pair_review_status_rows; the first call computes everything once.
--   * pair_review_status_rows_cached(): the same verdict logic as pair_review_status_rows, reading the cached aggregate plus the
--     approval's own evidence. It also reads a NARROW `latest` (no rationale / hashes until the final join).
--   * current_pair_review_status_json(): when p_now is within 5 minutes of now() it refreshes then reads the cache; otherwise
--     (historical evaluation) it computes exactly as before. current_pair_review_status (paged) is unchanged.
-- Rules preserved: unmonitorable, sku_changed (store SKU differs, shared SKU, or any observation under another SKU, sticky),
-- identity_changed (sticky), 14-day evidence recency, 365-day expiry, the approval's own evidence counting as evidence.
-- Conservative difference: a side flagged because an observation under another SKU was seen stays flagged (as before); the cache
-- can only be MORE sticky than a recompute in the corner case where an offer's SKU was changed and changed back between refreshes.

-- The refresh looks up evidence RECORDED since the global watermark: without these it would walk every row since each approval.
create index if not exists retailer_identity_responses_recorded on public.retailer_identity_responses (recorded_at);
create index if not exists retailer_identity_observations_recorded on public.retailer_identity_observations (recorded_at);

create table public.pair_review_side_cache (
  review_id uuid not null references public.retailer_offer_pair_reviews(id) on delete cascade,
  which text not null check (which in ('left', 'right')),
  evidence_at timestamptz,
  any_other_sku boolean not null default false,
  any_changed boolean not null default false,
  primary key (review_id, which)
);
create table public.pair_review_cache_state (
  id boolean primary key default true check (id),
  evaluated_through timestamptz not null
);
alter table public.pair_review_side_cache enable row level security;
alter table public.pair_review_cache_state enable row level security;
revoke all on public.pair_review_side_cache, public.pair_review_cache_state from public, anon, authenticated, service_role;
grant select on public.pair_review_side_cache to service_role;

create function public.refresh_pair_review_side_cache() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare n integer; w timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('pair_review_side_cache'));
  select st.evaluated_through - interval '10 minutes' into w from public.pair_review_cache_state st where st.id;
  with latest_ids as (
    select distinct on (r.left_offer_id, r.right_offer_id) r.id
    from public.retailer_offer_pair_reviews r
    where r.reviewed_at <= now()
    order by r.left_offer_id, r.right_offer_id, r.reviewed_at desc, r.created_at desc, r.id desc
  ),
  sides as (
    select r.id as review_id, s.which, s.offer_id, s.sku, s.approved, s.src_at, (c.review_id is null) as is_new
    from latest_ids k
    join public.retailer_offer_pair_reviews r on r.id = k.id and r.classification in ('exact_product', 'comparable_alternative')
    cross join lateral (values
      ('left', r.left_offer_id, r.left_sku, r.left_identity, r.left_captured_at),
      ('right', r.right_offer_id, r.right_sku, r.right_identity, r.right_captured_at)
    ) as s(which, offer_id, sku, approved, src_at)
    left join public.pair_review_side_cache c on c.review_id = r.id and c.which = s.which
    where s.sku is not null and s.approved is not null
  ),
  -- Offers with evidence recorded since the watermark (each source through its own time index). No watermark: everything.
  touched as (
    select e.store_product_id as offer_id from public.retailer_identity_responses e where w is not null and e.recorded_at >= w
    union
    select o.store_product_id from public.retailer_identity_observations o where w is not null and o.recorded_at >= w
    union
    select sp.id from public.store_products sp
      join (select distinct p.requested_url from public.tesco_direct_collection_pages p where w is not null and p.created_at >= w) u
        on u.requested_url = 'https://www.tesco.ie/shop/en-IE/products/' || sp.store_sku
      where sp.store = 'tesco'
  ),
  todo as (
    select x.*, case when x.is_new or w is null then '-infinity'::timestamptz else w end as lb
    from sides x
    where x.is_new or w is null or x.offer_id in (select t.offer_id from touched t)
  ),
  folded as (
    select x.review_id, x.which, ev.evidence_at, ev.any_other_sku, ev.any_changed
    from todo x
    left join public.store_products sp on sp.id = x.offer_id
    cross join lateral (
      select max(o.at) filter (where o.sku = x.sku and public.identity_usable(o.projection)) as evidence_at,
        coalesce(bool_or(o.sku is distinct from x.sku), false) as any_other_sku,
        coalesce(bool_or(public.identity_changed(x.approved, o.projection)), false) as any_changed
      from (
        select p.created_at as at, public.tesco_page_projection(p.parsed, sp.store_sku) as projection, sp.store_sku as sku
        from public.tesco_direct_collection_pages p
        where sp.store = 'tesco' and p.requested_url = 'https://www.tesco.ie/shop/en-IE/products/' || sp.store_sku
          and p.created_at >= x.src_at and p.created_at <= now() and p.created_at >= x.lb
          and p.outcome = 'ok' and p.http_status = 200 and p.body_sha256 is not null
        union all
        select e.retrieved_at, public.retailer_identity_projection(e.identity), e.sku
        from public.retailer_identity_responses e
        where e.store_product_id = sp.id
          and e.retrieved_at >= x.src_at and e.retrieved_at <= now() and e.recorded_at >= x.lb
          and (e.source_kind = 'captured_product' or (sp.store = 'dunnes' and e.source_kind = 'captured_product_api'))
        union all
        select o.observed_at, o.identity_projection, o.sku
        from public.retailer_identity_observations o
        where o.store_product_id = sp.id and o.observed_at >= x.src_at and o.observed_at <= now() and o.recorded_at >= x.lb
      ) o
      where o.projection ? 'title'
    ) ev
  )
  insert into public.pair_review_side_cache as c (review_id, which, evidence_at, any_other_sku, any_changed)
  select f.review_id, f.which, f.evidence_at, f.any_other_sku, f.any_changed from folded f
  on conflict (review_id, which) do update set
    evidence_at = greatest(c.evidence_at, excluded.evidence_at),
    any_other_sku = c.any_other_sku or excluded.any_other_sku,
    any_changed = c.any_changed or excluded.any_changed;
  get diagnostics n = row_count;
  insert into public.pair_review_cache_state(id, evaluated_through) values (true, now())
    on conflict (id) do update set evaluated_through = excluded.evaluated_through;
  return n;
end $$;
revoke all on function public.refresh_pair_review_side_cache() from public, anon, authenticated;
grant execute on function public.refresh_pair_review_side_cache() to service_role;

create function public.pair_review_status_rows_cached(p_now timestamptz default now(), p_active_only boolean default false)
returns table (
  left_offer_id uuid, right_offer_id uuid, classification text,
  left_source_hash text, right_source_hash text,
  left_evidence_at timestamptz, right_evidence_at timestamptz,
  reviewed_at timestamptz, rationale text, reviewer text,
  status text
)
language sql stable security invoker set search_path = '' as $$
  with latest_ids as (
    select distinct on (r.left_offer_id, r.right_offer_id) r.id
    from public.retailer_offer_pair_reviews r
    where r.reviewed_at <= p_now
    order by r.left_offer_id, r.right_offer_id, r.reviewed_at desc, r.created_at desc, r.id desc
  ),
  -- NARROW latest: only what the side verdicts need; rationale / hashes / reviewer are joined at the very end.
  latest as (
    select r.id, r.left_offer_id, r.right_offer_id, r.classification, r.reviewed_at, r.left_sku, r.right_sku,
      r.left_identity, r.right_identity, r.left_captured_at, r.right_captured_at
    from latest_ids k join public.retailer_offer_pair_reviews r on r.id = k.id
    where r.classification in ('exact_product', 'comparable_alternative')
  ),
  sides as (
    select l.id as review_id, s.which, s.offer_id, s.sku, s.approved, s.src_at
    from latest l
    cross join lateral (values
      ('left', l.left_offer_id, l.left_sku, l.left_identity, l.left_captured_at),
      ('right', l.right_offer_id, l.right_sku, l.right_identity, l.right_captured_at)
    ) as s(which, offer_id, sku, approved, src_at)
  ),
  per_side as (
    select x.review_id, x.which,
      -- The approval's own evidence counts as an observation (as in pair_review_status_rows).
      greatest(c.evidence_at, case when sp.id is not null and x.approved ? 'title' and public.identity_usable(x.approved) then x.src_at end) as evidence_at,
      case
        when x.sku is null or x.approved is null then 'suspended_unmonitorable'
        when sp.store_sku is distinct from x.sku
          or (select count(*) from public.store_products d where d.store = sp.store and d.store_sku = sp.store_sku) <> 1
          or coalesce(c.any_other_sku, false) then 'suspended_sku_changed'
        when coalesce(c.any_changed, false) then 'suspended_identity_changed'
        when coalesce(greatest(c.evidence_at, case when sp.id is not null and x.approved ? 'title' and public.identity_usable(x.approved) then x.src_at end), '-infinity')
             < p_now - interval '14 days' then 'suspended_no_recent_evidence'
        else 'active'
      end as side_status
    from sides x
    left join public.store_products sp on sp.id = x.offer_id
    left join public.pair_review_side_cache c on c.review_id = x.review_id and c.which = x.which
  ),
  per_pair as (
    select s.review_id, count(*) as sides,
      max(s.evidence_at) filter (where s.which = 'left') as left_evidence_at,
      max(s.evidence_at) filter (where s.which = 'right') as right_evidence_at,
      bool_or(s.side_status = 'suspended_sku_changed') as any_sku_changed,
      bool_or(s.side_status = 'suspended_unmonitorable') as any_unmonitorable,
      bool_or(s.side_status = 'suspended_identity_changed') as any_identity_changed,
      bool_or(s.side_status = 'suspended_no_recent_evidence') as any_no_recent
    from per_side s
    group by s.review_id
  ),
  result as (
    select l.left_offer_id, l.right_offer_id, l.classification, w.left_source_hash, w.right_source_hash,
      pp.left_evidence_at, pp.right_evidence_at, l.reviewed_at, w.rationale, w.reviewer,
      case
        when l.reviewed_at < p_now - interval '365 days' then 'expired_needs_review'
        when coalesce(pp.sides, 0) <> 2 then 'suspended_unmonitorable'
        when pp.any_sku_changed then 'suspended_sku_changed'
        when pp.any_unmonitorable then 'suspended_unmonitorable'
        when pp.any_identity_changed then 'suspended_identity_changed'
        when pp.any_no_recent then 'suspended_no_recent_evidence'
        else 'active'
      end as status
    from latest l
    left join per_pair pp on pp.review_id = l.id
    join public.retailer_offer_pair_reviews w on w.id = l.id
  )
  select * from result where not p_active_only or status = 'active'
$$;
revoke all on function public.pair_review_status_rows_cached(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.pair_review_status_rows_cached(timestamptz, boolean) to service_role;

-- Dispatcher for the single read. Near-now evaluation uses the maintained cache; any other evaluation time (history, tests)
-- is computed from the evidence exactly as before.
create or replace function public.current_pair_review_status_json(p_now timestamptz default now(), p_active_only boolean default false)
returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
begin
  if abs(extract(epoch from (p_now - now()))) <= 300 then
    perform public.refresh_pair_review_side_cache();
    return (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.pair_review_status_rows_cached(p_now, p_active_only) s);
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.pair_review_status_rows(p_now, p_active_only) s);
end $$;
revoke all on function public.current_pair_review_status_json(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.current_pair_review_status_json(timestamptz, boolean) to service_role;
