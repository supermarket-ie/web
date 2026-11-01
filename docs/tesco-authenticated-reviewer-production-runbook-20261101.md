# Tesco audited hold re-entry — production approval checklist

**Prepared, not executed.** PR #286 is not merged or deployed. No production
hold-review table or privileged reviewer approval exists yet. This runbook
does not authorise collecting any held Tesco mapping.

## Release prerequisites

1. Satisfy GitHub's actual required `validate` check and review/resolve
   PR #286 mergeability. The blocked local `eve build` network request to an
   untrusted Vercel AI gateway is a security boundary; do not bypass it or
   weaken the required check to obtain a green badge.
2. On a separately authorised production change, apply only the approved
   `supabase/migrations/20261101000000_tesco_hold_reentry_reviews.sql`.
   This creates three append-only review/revocation/use tables and a
   Supabase Auth-bound reviewer trigger/RLS policy. It makes **no**
   Tesco mapping, hold or price changes.
3. Configure the designated human Supabase Auth user with
   `app_metadata.tesco_reentry_reviewer=true` using the existing
   **server-side Auth administration** process. Require a fresh verified
   session token after the metadata change. This is never a user-editable
   `user_metadata` flag.
4. Verify roles and Data API exposure: normal `authenticated` principals
   without that privilege and `anon` must fail INSERT; the collector
   `service_role` must have SELECT but **not INSERT** on approvals; the
   designated JWT-authenticated human must insert an immutable review
   bound to `auth.uid()`, regardless of supplied reviewer ID. Verify
   revocation and one-time use on a non-live test transaction before
   allowing held collection.
5. Pin the exact Git-reviewed collector revision in the existing Node 24
   ChatGPT Work supervised runtime. Use the current SQL bridge, Tesco
   fetcher, leases, cooldowns, pacing, circuit breakers, six unresolved
   requests and `finalize_store_scrape_product`; do **not** use AWS
   ECR/ECS website deployment as a substitute for this or the migration.

## Ordered deployment and proof (requires separate production authorisation)

1. Merge the exact head for which the GitHub Actions **`validate`** check from
   GitHub Actions is green, after resolving all review threads. Use the
   repository's protected-main squash-merge path; record the resulting merge
   SHA. Do not substitute an older check or an obsolete Vercel deployment
   status for this required job.
2. Back up the three new audit table definitions and their access policies,
   confirm the migration has **not** already been applied, then apply
   `supabase/migrations/20261101000000_tesco_hold_reentry_reviews.sql`
   through the approved Supabase migration administration path. Verify the
   migration ledger entry, three append-only tables, trigger functions,
   RLS policies, grants and dependency references. This operation is
   separate from AWS deployment and does **not** remove holds.
3. Set only the named, MFA-protected human user's server-controlled Supabase
   `app_metadata.tesco_reentry_reviewer=true` using the existing Auth admin
   facility; have the reviewer sign in again for an up-to-date JWT. Never
   use `user_metadata` or grant the collector ability to insert approvals.
4. In a transaction that is rolled back, prove the negative authorisation
   paths (anon, ordinary authenticated, collector service role), the positive
   privileged Auth JWT insert, forced `auth.uid()` attribution, RLS SELECT
   visibility, append-only immutability, expiry and revocation/use exclusion.
   Also prove a changed mapping, page hash, peer identity or pending attempt
   invalidates the exact captured evidence. **Do not** create real approval
   records during readiness checks.
5. The website uses `.github/workflows/aws-ecr-deploy-image.yml` for a
   **manual ECR build/push only**. With separate approval, publish the merged
   revision and use the existing `infra/terraform` ECS `image_tag` procedure
   if a website image refresh is needed. PR #286's collector is a Node 24
   **ChatGPT Work supervised process**, not the ECS web process: separately
   install/pin that reviewed revision with the existing fetcher, SQL bridge
   and operator gate. No AWS action runs migrations or Tesco collection.
6. Re-fetch and individually sign the evidence snapshots from the 93-row
   evidence queue (33 dual peers first, then 60 others) with the privileged
   human JWT. Each insert is tied to one mapping UUID, page UUID, full
   contemporaneous JSONB evidence, expiry and immutable authenticated actor;
   collect only returned review UUIDs, not SKUs. Reconcile dry-run eligibility
   and inspect all lease/cooldown/unresolved safeguards. **Collection needs its
   own subsequent authorisation** and current access preflight.

## Safe rollback / forward recovery (not executed)

- Before any approved held run, revoke the human's reviewer permission using
  Auth administration, let old JWTs expire and temporarily revoke the
  `authenticated` INSERT grant on `tesco_hold_reentry_reviews` in an approved
  transaction. No mapping or price state is touched. The reviewed selector
  then receives no *new* approvals, and any existing approval can separately
  be revoked in the append-only revocation ledger.
- Stop launching held runs; reconcile any in-flight pending pages and existing
  owner leases normally (never clear the six historical unresolved requests,
  force a cooldown, or take a successor's lease). Pin the previous approved
  ordinary supervised collector revision for continued trusted renewals.
  If the AWS site image was changed, roll the ECS `image_tag` back through the
  normal Terraform procedure independently.
- **Retain audit tables with any review/use history.** Reverting application
  code or permissions is the safe database rollback: deleting append-only
  approvals or their usage records would destroy evidence and weaken
  idempotence. Only if the migration is *completely unused*, and after a
  separately approved checked backup, is a reverse DDL migration eligible;
  never silently drop review, revocation or use records.
- Once a failed release is corrected, redeploy the revised collector, restore
  grants only after Auth/RLS verification, re-snapshot stale candidates, and
  create **new** individual reviews; never recycle consumed or revoked IDs.
  Trusted price receipts already finalised remain trusted unless the normal
  identity-quality audit establishes a specific erroneous observation.

## Evidence and one accountable review

The unsigned queue is
`docs/tesco-hold-reentry-production-queue-20261101.jsonl`
(**33** priority dual-peer, then **56** independently evidence-supported
one-/zero-peer mappings). The separate inference addendum
`docs/tesco-hold-reentry-inference-addendum-20261101.jsonl`
records **four more** barcode-supported products, giving **93 total**
(33 dual-peer and 60 other), pending the same safeguards.
These are **preparatory evidence**, not signed approvals or guaranteed prices.

For **each** reviewed candidate, just before signing:

1. Confirm canonical ID, mapping UUID, exact Tesco SKU/URL, source page UUID,
   hashed page body, prior successful receipt, EAN/GTIN where available,
   quantity, pack count, formulation and variant. Compare any fresh Dunnes
   and SuperValu product identity; genuine peer mismatch stays excluded.
2. Fetch the **current** read-only immutable snapshot through the existing
   SQL bridge:
   `node --import tsx scripts/tesco-hold-reentry-assess.ts --evidence STORE_PRODUCT_UUID SOURCE_PAGE_UUID`
   (the operator executes the emitted SELECT through the approved connector).
3. The designated human independently checks the exact identity and enters
   an individual rationale of at least 30 characters. Submit the exact
   fetched `evidence_snapshot`, `store_product_id`, `source_page_id`,
   `independent_reason`, and `expires_at` (within 14 days) to
   `public.tesco_hold_reentry_reviews` **through the Supabase Auth-verified
   Data API** using that human's JWT. Do not submit approvals through
   the privileged SQL bridge, service-role key, or arbitrary reviewer strings.
   The database sets `reviewer_id` and `approved_at`.
4. Record the returned **review UUID** against the candidate/mapping;
   it is the collector input. Never treat a product SKU or AI verdict as an
   approval. A stale mapping/page/peer snapshot, new attempt, new hold,
   pending request, or revoked/used/expired approval must fail closed.

One authenticated reviewer session may perform the 93 individual reviewed
decisions in sequence. No second fake reviewer, per-item deployment,
unbounded bulk override, or new infrastructure is needed. A manual
independent product judgment remains mandatory for each product.

## Supervised production sequence — separate collection authorisation

1. **Existing trusted Tesco renewals are a separate campaign**, using the
   earlier approved collector revision independently of PR #286. The durable
   1 November reconciliation recorded 113 completed renewals and 187 further
   eligible candidates; the run stopped at its network access safeguard.
   The release-preparation work must neither restart nor reset that campaign.
2. After deploying the audited mechanism and obtaining its signed review UUIDs,
   refresh preflight and select the **33 dual-peer** reviewed mappings first,
   followed by the remaining **60**. Use
   `node --import tsx scripts/tesco-supervised-collect.ts --mode expansion --limit 100 --reviewed-candidates REVIEW_UUIDS --dry-run`
   for the existing safety checks, then only after explicit collection
   authorisation use `--confirm-run`. Batches are sequential, at most 100,
   respecting 10-second pacing and leases. Never select held product SKUs
   through the ordinary expansion mode or create unverified-price rows.
3. The new **live** Tesco page and original source must pass the independent
   exact-identity gate; the unchanged deterministic validator still runs,
   and only its two allowlisted canonical-*evidence gap* reasons may be
   resolved by an approved review. Material variant/pack/brand conflicts,
   unavailability and all other reasons remain a no-price disposition.
4. Recheck immutable mapping, source, latest peer snapshots, review,
   revocation, one-use state, lease owner and gate in the **same guarded
   checkpoint/finalisation transactions**. The old hold is not deleted.
5. After each batch, reconcile reserved/completed/pending/receipts, compare
   net additional fresh trusted prices with the pre-run baseline and verify
   **genuine** three-retailer comparisons independently. Do not call a
   successful page retrieval, preparatory review or unpriced product a
   recovered trusted price. Stop on a real access/gate/safety blocker.

Approved held mappings normally return to ordinary supervised renewal after
the new trusted observation overtakes the historical hold. Every routine
renewal still fetches and validates its current Tesco page; a new human
hold-reentry signature is not required for unchanged trusted identities.
