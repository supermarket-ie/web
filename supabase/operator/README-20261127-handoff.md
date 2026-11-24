# Operator handoff — pair-status maintained side cache (project `ytyzwiqnobxehdqrnzhx` only)

| # | File | What it does | Writes data? |
|---|------|--------------|--------------|
| 1 | `supabase/migrations/20261127090000_pair_status_side_cache.sql` | Adds `pair_review_side_cache` and `pair_review_cache_state` (service_role cannot write either; only the security-definer refresh does), two `recorded_at` indexes, `refresh_pair_review_side_cache()`, `pair_review_status_rows_cached()`, and replaces `current_pair_review_status_json`: within 5 minutes of now() it refreshes the cache incrementally then reads it; otherwise it computes exactly as before. `current_pair_review_status` (paged) is unchanged. | Cache rows only |

Why: the production plan (24 Nov) showed 3,118 side evaluations at ~1.98 ms each. That cost was re-deriving, on every read, an aggregate over APPEND-ONLY evidence. The cache folds only evidence recorded since a global watermark (minus a 10-minute margin) into sticky OR flags and a max timestamp, so the result is exact.
Rules preserved, with an identical-output test at every step: unmonitorable, SKU changed (store SKU, shared SKU, sticky other-SKU observation), sticky identity change, 14-day recency, 365-day expiry, superseding reviews, late-arriving evidence, the approval's own evidence. Mutation checks: breaking either sticky fold or the watermark fails the test.

After apply, the FIRST call computes everything once (about today's cost). Please benchmark the SECOND call:
`explain (analyze, buffers) select public.current_pair_review_status_json(now(), true);` run twice.
