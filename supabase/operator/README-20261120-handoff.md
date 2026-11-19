# Operator handoff — 20 November 2026 (project `ytyzwiqnobxehdqrnzhx` only)

These run through the owner's existing ChatGPT-connected Supabase route. Nothing here needs
SQL written by hand: give the route each file **in this order**, unmodified. Each file is
transactional and idempotent where stated. Do not use any other connection or credential.

| # | File | What it does | Writes prices? |
|---|------|--------------|----------------|
| 1 | `supabase/migrations/20261118120000_durable_pair_approvals.sql` | Durable pair approvals (PR #418, merged, 3 reviews). Adds identity stamping + `current_pair_review_status`. The deployed app already falls back safely without it. | No |
| 2 | `supabase/migrations/20261120090000_tesco_pending_page_resolutions.sql` | Append-only ledger + postgres-bridge-only resolver for HISTORICAL pending Tesco pages; reserve RPC re-created with one predicate change (a resolved pending page no longer blocks). Page rows are never modified. | No |
| 3 | `supabase/operator/20261120_resolve_9_historical_pending_tesco_pages.sql` | Records 9 explicitly named terminal dispositions (`abandoned_unknown_outcome`) in one transaction; verifies 9 / 9 / 0 before COMMIT. | No |

Order matters: 3 requires 2. 1 is independent.

## After each step the agent verifies (read-only, service role over REST)

1. `GET /rest/v1/rpc/current_pair_review_status` exists (and the app reads ACTIVE rows), and
   `retailer_identity_observations` responds 200.
2. `GET /rest/v1/tesco_pending_page_resolutions?limit=1` → 200 (table present), and a probe
   `DELETE ...tesco_pending_page_resolutions?page_id=eq.00000000-0000-0000-0000-000000000000`
   is refused (service_role has SELECT only).
3. Exactly 9 rows in `tesco_pending_page_resolutions`; the 9 pages still `outcome = 'pending'`
   and unchanged; no new price rows. Then a targeted Tesco run (`APIFY_TARGET_IDS` = the 9
   mappings) on the fixed collector image re-fetches them under every normal gate.

## What is NOT done by these files
No price, receipt, mapping, lease, cooldown, budget or approval is changed. The supervised
collector still treats these URLs as held (unchanged, conservative). The tenth pending page
(SKU 253094431, Glade) is deliberately excluded: its SuperValu and Dunnes offers are different
products, so a Tesco price would not create an accurate comparison.
