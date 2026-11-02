# Tesco held-mapping recovery — existing operational identity

The supervised ChatGPT Work collector and its authenticated Supabase SQL bridge
are the only operational identity and database transport. No new Auth account,
password, access token, signed human product review or new infrastructure.

## Small, bounded database change

Migration `20261101220707_tesco_supervised_operational_recovery.sql`:

- Retires the unused separate-machine-Auth INSERT policy, preserving the prior
  authenticated-human policy and immutable historical review records.
- Enables `approval_kind='collector'` on the existing append-only ledger,
  with `reviewer_id` NULL and fixed database-derived
  `collector_identity='postgres:supervised_sql_bridge'`.
- Adds a `tesco_internal.record_verified_hold_reentry` **SECURITY INVOKER**
  function. `EXECUTE` and schema usage are denied to `PUBLIC`, `anon`,
  `authenticated` and `service_role`; only the existing privileged SQL
  bridge's postgres session can call it. This is not a Data API RPC or a
  general-purpose RLS bypass.
- Re-derives and locks the complete current mapping/source/peer evidence in
  the database; checks the supplied immutable snapshot, unique SKU, source
  page hash, historical success, lack of fresh/pending/recent attempts,
  exact source SKU/URL, positive AI assessment with the same IDs and hash,
  explicit barcode/brand/pack/variant contradictions, and any active prior
  review. It appends *one* 48-hour approval record, not a trusted price.
- The pre-deployment hardening rejects sized-single versus multipack changes,
  extra compound measures and a structured source quantity contradicting the
  title (including total quantities for `N x unit-size` packs). Required source
  fields and assessment constraints reject NULL rather than relying on SQL's
  nullable comparison semantics. The normal independent collector checks remain.
- The existing `tesco_hold_reentry_uses` one-use insert, lease/mapping/peer
  checks, independent fresh-live Tesco validator and guarded
  `finalize_store_scrape_product` remain unchanged.

The privileged SQL connector is an existing owner-trusted administrative
boundary. It already has postgres authority; the change deliberately grants
that authority to no other role. The connector must still execute *only* the
reviewed one-purpose function for approval, not an arbitrary review INSERT.

## Release gates

1. Review PR diff, PGlite negative/positive tests, full typecheck and GitHub
   Actions `validate`; merge only through the protected `main` ruleset.
2. Confirm the prior review and machine migrations are installed. Apply the
   new migration **once** through the protected Supabase migration workflow,
   not the website's AWS/ECR deploy. Verify its recorded migration version,
   RLS, grants, function invoker status and append-only triggers. Test negative
   roles and wrong-source/replay cases inside a rolled-back transaction.
   The protected confirmation expired without executing on 2 November; the
   migration was verified absent before correcting its SQL. Do not apply an
   older copy from PR #299, bypass the confirmation, or rewrite an installed
   migration. Apply the corrected, validated `main` file only.
3. Refresh production preflight: existing fresh/renewal/three-retailer
   coverage, 93 held unique candidates (33 dual peer first), **six historical
   pending requests plus any newly pending pages**, gate lease/cooldown, last
   network_error, competing supervisors and exact active candidate state.
   As of 2 November, a seventh pending SKU (`312236215`) exists in the
   interrupted 1 November renewal run. Do not reset a cooldown, assume that
   interrupted run is safe to resume, or retry an unresolved product.
4. With the existing Node 24 SQL bridge, use:

   ```sh
   node --import tsx scripts/tesco-machine-approve.ts --dry-run --limit 33
   node --import tsx scripts/tesco-machine-approve.ts --confirm-approve --limit 33 --result-file tesco-operational-decisions.jsonl
   node --import tsx scripts/tesco-machine-approve.ts --dry-run --offset 33 --limit 60
   node --import tsx scripts/tesco-machine-approve.ts --confirm-approve --offset 33 --limit 60 --result-file tesco-operational-decisions.jsonl
   ```

   The script independently revalidates each old AI-reviewed candidate and
   calls the restricted SQL function only for exact identities. Keep the
   returned review UUIDs as append-only receipts. A missing SQL acknowledgement
   is an interruption requiring ledger reconciliation, **not** a retry.

   For further catalogue expansion, use `--candidate-file-only PATH` with a
   newly independently assessed JSONL manifest, preserving its source IDs,
   hashes and rationales. Advance through a fixed manifest using `next_offset`
   from each completed summary; `--limit` is always at most 100. An offset is
   only a candidate-list position, never authority to retry a pending request
   or consumed decision. Do not reorder/change a manifest between its batches
   or assume appended priority candidates sort after the original 93. The
   additive `--candidate-file` option remains available but cannot be combined
   with `--candidate-file-only`.

5. After normal access safeguards permit, run `tesco-supervised-collect.ts`
   in **expansion** mode with those review UUIDs, batches ≤100 and explicit
   `--confirm-run`. Reconcile every run. Stop at the ordinary network/identity
   circuit breakers, no new fetch transport or alternate egress. Continue
   through the other 60 held opportunities, then ordinary non-held candidates
   and further independently corroborated AI evidence, within the owner's
   1,000-request ceiling. Renew existing trusted prices as separately due.
6. Report **new trusted Tesco**, **new genuine three-retailer comparisons**,
   **renewals**, **decisions recorded**, **held/rejected/uncertain** and
   **network/access stops** as distinct measurements. Never call a review a
   recovered price or a retailer peer an exact match without verification.

## Rollback

Stop new approval calls, preserve every immutable decision/use/source record,
and append revocations where necessary. If a rollout fails, pin the prior
collector and restore the earlier human-only INSERT policy through a reviewed
migration; do not delete ledgers, clear historical holds or reset the egress
gate. Existing trusted observations and their regular renewal lifecycle remain
untouched. No AWS site deploy is required for the supervised SQL-bridge script.

## Verified production recovery checkpoint — 2 November 2026

- Protected migration was applied as Supabase migration `20261102135210_tesco_supervised_operational_recovery`.
  The private SECURITY INVOKER operation grants no API role EXECUTE or schema usage.
- Reviewed all 93 evidence-backed mappings: 46 immutable collector decisions recorded,
  47 held/rejected (including a genuine structured pack conflict rejected by the DB).
- Four successful guarded expansion runs consumed all 46 decisions once and completed
  46 Tesco requests: **42 new trusted offers**, **13 new genuine three-retailer comparisons**,
  zero renewals, and four live identity/redirect/availability holds.
  Trusted Tesco offers increased 324 → 366; three-retailer comparisons 170 → 183.
  Seven preexisting pending requests remained untouched. No active collection lease remains.
- The supervised SQL connector truncated the serialized state of a 30-candidate run
  before its first reservation. That run had **zero pages and zero consumed decisions**;
  it was conditionally closed as degraded, its original malformed state retained inside
  the reconciliation record, and only its own lease released. Keep subsequent
  SQL-bridge batches to **10 candidates** so the atomic run-state SQL stays below
  the connector payload limit. Do not retry the already-consumed decisions.
- The unreviewed ordinary-expansion dry run surfaced shared-SKU canonical groups.
  Continue ordinary expansion only with the existing internal
  `excludeSharedSku` selector exposed by the supervised CLI flag
  `--exclude-shared-sku`. The pre-selection filter excludes those groups without
  fetching a Tesco page, changing mappings or disabling the runtime conflict guard.

```sh
node --use-env-proxy --import tsx scripts/tesco-supervised-collect.ts --mode expansion --dry-run --limit 10 --exclude-shared-sku
node --use-env-proxy --import tsx scripts/tesco-supervised-collect.ts --mode expansion --confirm-run --limit 10 --exclude-shared-sku
```

Observe the existing lease, pacing, circuit breakers and 24-hour per-URL retry
exclusions after each batch. Expand from held evidence only after a fresh,
independent exact-identity assessment and a new narrowly bound one-use decision.
