-- Keep planner statistics current for the append-heavy trusted-price path.
--
-- Production investigation on 2026-09-14 found the latest_prices plan estimating
-- 74 trusted rows where 3,456 rows actually qualified before DISTINCT. The
-- underlying observations change in scrape-sized batches, so the default
-- auto-analyze threshold can leave recent/source selectivity materially stale.

alter table public.price_observations
  alter column observed_at set statistics 500;

alter table public.price_observations
  alter column source set statistics 500;

alter table public.price_observations set (
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 500
);

create statistics if not exists price_observations_source_observed_at_stats
  (dependencies, mcv)
  on source, observed_at
  from public.price_observations;

analyze public.price_observations;
analyze public.products;
