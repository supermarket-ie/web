# Operator handoff — pair-status pre-aggregation (project `ytyzwiqnobxehdqrnzhx` only)

| # | File | What it does | Writes data? |
|---|------|--------------|--------------|
| 1 | `supabase/migrations/20261125120000_pair_status_pre_aggregate.sql` | Moves the status computation into `pair_review_status_rows` (unordered, security invoker, service_role only). The side verdicts are reduced to one narrow row per pair BEFORE joining the wide review columns: the old GROUP BY sorted rows carrying the rationale and hashes, and spilled to temp. `current_pair_review_status` keeps its exact contract (same rows, same ORDER BY). `current_pair_review_status_json` aggregates the unordered rows, so the single read sorts nothing wide. | No |

Requires `20261125090000_pair_status_single_read.sql` (history `20261124073812`). No table changes.
Local benchmark (PGlite, 600 pairs): the group sort's memory drops from 1,247 kB to 229 kB (about 5x narrower) with identical output. The per-side evidence evaluation (about 0.5 ms per side) is unchanged; it is the floor without stored projections.
Check after apply: `explain (analyze, buffers) select public.current_pair_review_status_json(now(), true);` should show no temp read/written.
