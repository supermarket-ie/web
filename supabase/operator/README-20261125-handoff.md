# Operator handoff — pair-status single read (project `ytyzwiqnobxehdqrnzhx` only)

| # | File | What it does | Writes data? |
|---|------|--------------|--------------|
| 1 | `supabase/migrations/20261125090000_pair_status_single_read.sql` | (a) `current_pair_review_status`: the latest review per pair is chosen by sorting only key columns, then joined back by id. This removes the wide-row sort that spilled to temporary disk. Rules, return type and grants are unchanged; identical output is asserted against the previous definition. (b) New `current_pair_review_status_json` (security invoker, service_role only) returns the same rows as one jsonb array, so the app and collector read every row in ONE execution instead of one per 1,000-row page. | No |

No table changes and no locks beyond `create or replace function`. The app already falls back to the paged read until this is applied, and switches automatically afterwards.

Suggested check after apply: `explain (analyze, buffers) select public.current_pair_review_status_json(now(), true);` should run once, with no temp read/write from the review sort.
