# Operator handoff — AI-accepted review-tier barcode associations (project `ytyzwiqnobxehdqrnzhx` only)

| # | File | What it does | Writes data? |
|---|------|--------------|--------------|
| 1 | `supabase/migrations/20261126090000_barcode_review_acceptances.sql` | Adds `retailer_barcode_review_acceptances` (append-only, service_role select only), `accept_barcode_review_association` (security definer, service_role only), views `current_barcode_review_acceptances` and `current_machine_associations` (strong active + AI-accepted, with a `basis` column), the `barcode-review-ai-v1` pair policy, and replaces `record_machine_pair_approval` so it reads `current_machine_associations`. | No (policy row only) |

Guarantees:
- A review-tier observation is never converted into a strong association; `current_barcode_associations` is unchanged.
- `barcode-exact-v1` accepts basis `strong` only, exactly as before.
- `barcode-review-ai-v1` needs at least one ACTIVE AI-accepted side; its ledger rows carry reviewer `machine:barcode-review-ai-v1` and `association_basis: ai_review`.
- Acceptance requires: the LATEST observation for the (gtin, store) is a review-tier resolution of this SKU from this Tesco origin; the offer is on the same catalogue record with an unshared SKU; a recent SKU-bound retailer capture of that offer with a stated, non-own-label brand; an AI verdict of `verified_exact` with all seven material facts true; and structural, wording-only and fresh-barcode checks recorded as `pass`.
- An acceptance suspends automatically when a newer observation differs, the offer moves SKU or record, or the observation is older than 30 days.

Requires `20261122090000_machine_pair_approvals.sql` and `20261121090000_retailer_barcode_observations.sql` (applied). Independent of `20261125120000` (applied as `20261124161443`).
After apply the agent runs `scripts/barcode-review-accept.ts` (81 Dunnes acceptances) and the machine pair run.
