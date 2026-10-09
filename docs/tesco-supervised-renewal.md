# Supervised Tesco renewal

This operator-only Node runner reuses the existing direct collector, identity
validator and `finalize_scrape_product` pipeline. It does not install a scheduler,
change production mappings, enable an egress route or modify previous prices.
The separate renewal proposal is documentation-only PR #250.

## Before a session

Use the reviewed implementation revision, Node 24 and `npm ci`. Read
`docs/retailer-execution.md` and `docs/tesco-direct-collection.md`. Verify live
coverage, unresolved attempts, the workspace gate's lease and cooldown. Do not
clear cooldowns or enable the workspace gate: its disabled state deliberately
excludes automated egress selection. Existing Work access is not evidence that
Vercel or AWS can reach Tesco.

Renewal selects resolved, previously proven mappings whose latest trusted price
is still fresh and at least four days old, oldest first. Expansion separately
selects mappings without a fresh price and prioritises three-retailer overlap.
Both exclude pending requests, attempts in the last 24 hours and identity/failure
holds newer than the current observation. Neither mode discovers new mappings.
An expired product is not silently included in renewal mode.

The first known renewal boundary is 12 October 2026 at 11:28 Irish time
(10:28 UTC); the corresponding seven-day expiry is 15 October at 11:28 Irish time.
Selection uses database time, never a command-line clock override.

## Run the SQL bridge

The process sends JSONL SQL requests on stdout. A supervising operator uses the
existing authenticated Supabase SQL connector to execute each **whole query once**,
then sends one JSONL reply on stdin. No Supabase credential is given to Node.
Use a persistent bidirectional terminal; ordinary closed stdin fails safely.
For a PTY controlled by an agent, disable terminal echo and canonical buffering:

```sh
stty -echo -icanon
exec node --use-env-proxy --import tsx scripts/tesco-supervised-collect.ts --mode renewal --dry-run
```

For every `{ "type": "sql", "id": N, "query": "..." }` event:

1. Execute the exact complete query with Supabase `execute_sql` for the verified
   project. Each mutation is an atomic PostgreSQL DO block; never split it.
2. Extract the returned result rows and send `{ "id": N, "rows": [...] }` plus a
   newline to this same process. Send `{ "id": N, "error": true }` on a known
   failure. Do not execute a query again if its acknowledgement is uncertain.
3. Continue until `type: result` or `type: error`. Keep the `starting`/`claimed`
   run ID and final reconciliation in the private operational record. SQL bridge
   replies have a 90-second deadline; lost supervision stops further requests.

The dry run performs only selection. For an authorised live session, replace
`--dry-run` with `--limit 25 --confirm-run`. The limit is bounded to 1–100; renewal
and expansion always require an explicit `--mode`. A no-due result does not
create a run or claim a lease. `npm run tesco:supervised -- ...` is an equivalent
entry point when stdin/stdout remain connected.

## Interruptions and stop conditions

Reconcile without fetching or writing:

```sh
npm run tesco:supervised -- --reconcile RUN_UUID
```

Continue only an interrupted run with no unknown requests, using its original
persisted queue and mode:

```sh
npm run tesco:supervised -- --mode renewal --resume RUN_UUID --confirm-run
```

The same SQL bridge applies to these commands. Resume does not change the queue
or retry completed URLs. A pending request means its outcome is unknown: resume
returns `unresolved_attempts` and performs no requests. Preserve that evidence
for manual investigation; do not mark it successful, finalise cached content with
a new timestamp, delete it, or automatically retry it. An interrupted claim with
no acknowledgement can be reconciled using the previously emitted run ID; wait
for the existing lease to expire before a permitted resume.

Access restrictions, Retry-After, transport/parse errors and identity anomalies
stop the batch. Known access/transport cooldown is persisted before the page
checkpoint, so a checkpoint failure cannot roll it back. A terminal stopped run
cannot be resumed. Existing resource-unavailable exceptions remain unchanged.
The runner retains the ten-second minimum spacing and ten-minute owned lease,
rechecks mapping/price snapshots before requesting and finalising, and prevents
an expired owner from releasing a successor's lease.

Accepted evidence, receipt and new trusted observation commit together. Receipt
uniqueness makes repeated finalisation a no-op. Failed renewals leave the earlier
observation intact, with its original expiry; they do not extend freshness.
Reconciliation reports reserved/completed/unresolved pages and successful trusted
receipts. Inspect private page evidence for fetch/failure outcomes; compare live coverage and expirations before
and after the session separately; successful retrieval is not trusted coverage.

## Verification and rollout

`npm test` includes isolated PostgreSQL tests executing the repository's actual
finaliser and evidence/cooldown migration. These cover due selection, append-only
renewal (including unchanged prices), failure preservation, exact identity/pack
rejection, duplicate commits, unknown requests, lost acknowledgements, atomic
rollback, cooldown persistence and stale owners. The view fixture models the
trusted seven-day contract; production selection is additionally checked using
the read-only dry run. CI runs the dedicated runner TypeScript check as well as
the normal tests, behavioural gate and build.

Review/merge is separate from production collection approval. No migration,
scheduler, application route change or deployment is necessary for this operator
CLI. At the first due window, start with a small supervised authorised batch,
verify new observation IDs and timestamps against preserved prior rows, reconcile
counts, then continue only within the approved scope and stop policy. Unattended
hosting and additional candidate validation remain separate follow-up work.
