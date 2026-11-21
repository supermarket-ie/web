# Operator handoff — 21 November 2026 (project `ytyzwiqnobxehdqrnzhx` only)

Same protected route as before: the owner's ChatGPT-connected Supabase integration. Give it each
file **unmodified, in this order**. Do not use any other connection or credential.

Probed 21 Nov 17:20Z over REST (service role, read-only): **none of steps 1–4 is applied yet**
(`retailer_identity_observations`, `tesco_pending_page_resolutions` and
`retailer_barcode_observations` all return 404).

| # | File | What it does | Writes prices / mappings? |
|---|------|--------------|---------------------------|
| 1 | `supabase/migrations/20261118120000_durable_pair_approvals.sql` | Durable pair approvals (PR #418). Needed before ANY exact pair relationship can be approved. | No |
| 2 | `supabase/migrations/20261120090000_tesco_pending_page_resolutions.sql` | Historical pending-page ledger (PR #422). | No |
| 3 | `supabase/operator/20261120_resolve_9_historical_pending_tesco_pages.sql` | 9 named terminal dispositions, one transaction, one session. Requires 2. | No |
| 4 | `supabase/migrations/20261121090000_retailer_barcode_observations.sql` | Append-only barcode-search evidence (PR #426): `retailer_barcode_observations`, `retailer_barcode_association_reviews`, view `current_barcode_associations`. Creates objects only; touches no existing table. | No |

Steps 1–3 are unchanged from `README-20261120-handoff.md`. Step 4 is independent of 1–3 and
should be applied only after PR #426 is approved (squash-merged), so production matches `main`.

## Step 4: what the migration guarantees

- Each row is one retailer search response for one GTIN query form. The Tesco origin of the
  GTIN (`gtin_origin_*`, evidence must name table, field, Tesco name and brand) is stored apart
  from the Dunnes/SuperValu evidence. `evidence_kind` separates "SKU found by GTIN search" from
  "GTIN returned by retailer" (the latter requires `retailer_returned_gtin`).
- The raw response body is stored and must hash to `response_sha256` (CHECK), so every stored
  observation can be re-verified later without CloudWatch (14-day retention).
- `http_status = 200`, the endpoint is pinned to the store's search gateway, the query must be the
  GTIN or `0`+GTIN, the tier must agree with its reasons, `recorded_at` is DB-stamped.
- Append-only: update, delete and truncate are refused by trigger. service_role gets
  SELECT + INSERT only (all default privileges are revoked first).
- A barcode observation is discovery evidence. It is NOT a comparison approval and does not
  change `store_products`, prices or pair reviews.

## After step 4 the agent verifies (read-only, then append-only)

1. `GET /rest/v1/retailer_barcode_observations?limit=1` → 200 and
   `GET /rest/v1/current_barcode_associations?limit=1` → 200.
2. Probe `DELETE ...retailer_barcode_observations?id=eq.00000000-0000-0000-0000-000000000000`
   is refused (no DELETE privilege).
3. Then, and only then, the agent inserts the re-captured strong observations (raw bodies
   included, rule version `barcode-v5`) through the service role. No review rows are written by
   the agent; `retailer_barcode_association_reviews` is for human decisions only.
