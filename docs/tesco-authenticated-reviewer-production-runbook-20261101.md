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

1. **Renew existing trusted Tesco prices first**, using the already-approved
   collector revision independently of PR #286. Reconcile each `--mode renewal`
   run before the next batch. Current renewal pressure is 303 due (57 expiring
   3 November, 246 on 4 November UTC; the 20 later renewals expire 7 November).
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
