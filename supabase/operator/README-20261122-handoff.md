# Operator handoff — 22 November 2026 (project `ytyzwiqnobxehdqrnzhx` only)

One file, through the existing ChatGPT-connected Supabase route, unmodified:

| # | File | What it does | Writes prices / mappings / reviews? |
|---|------|--------------|-------------------------------------|
| 1 | `supabase/migrations/20261122090000_machine_pair_approvals.sql` | Machine pair approvals (PR: machine approval policy). Policy registry, explicit machine identity on the review ledger, `record_machine_pair_approval` (service_role only), append-only `machine_pair_decisions`, Dunnes SKU-bound product API as a direct source. | No (creates objects; replaces `validate_offer_pair_review` and `current_pair_review_status` with the Dunnes API branch only) |

Requires the three migrations applied on 21 Nov (history `20261121213903`, `…213914`, `…213937`).

## After apply the agent verifies (read-only), then activates

1. `GET /rest/v1/pair_approval_policies?policy_version=eq.barcode-exact-v1` → one row.
2. `POST /rest/v1/rpc/record_machine_pair_approval` with an unknown policy → refused
   (`unknown machine policy`), proving the function exists and is callable by service_role only.
3. `GET /rest/v1/machine_pair_decisions?limit=1` → 200; a probe DELETE is refused.
4. Existing human reviews (if any) read back as `decision_kind = 'human'`.
5. Then: Dunnes API captures + the first `APPLY=1` run of `scripts/machine-pair-approvals.ts`, and
   `tofu apply` of the daily schedule.
