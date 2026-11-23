# Operator handoff — onboarding category fix + legacy Tesco mismatch detach (project `ytyzwiqnobxehdqrnzhx` only)

Apply in this order. Neither writes prices.

| # | File | What it does | Writes prices? |
|---|------|--------------|----------------|
| 1 | `supabase/migrations/20261124120000_barcode_tesco_onboarding_category.sql` | (From #442, still unapplied.) Replaces `onboard_barcode_tesco_offer` with a version that takes the record category (products.category is NOT NULL; the first version failed with 23502 and wrote nothing). Accepts only the site's 24 catalogue categories. | No |
| 2 | `supabase/migrations/20261124130000_tesco_mismatch_detach.sql` | Adds repair kind `detach_tesco` and `detach_tesco_offer` (SECURITY DEFINER, service_role only). It moves ONE Tesco offer off a record its own retained Tesco page contradicts, onto a new record named from that page (name, brand, GTIN). It refuses own-label offers, unbound or >30-day-old evidence, incomplete identity, an offer already alone on its record, and any offer in a positive pair decision. Append-only ledger row in `catalogue_repairs`. | No |

Requires `20261124090000_barcode_tesco_onboarding.sql` (history `20261123103204`).
After apply the agent runs `scripts/barcode-tesco-onboarding.ts` and `scripts/tesco-mismatch-detach.ts` with `APPLY=1`, then the downstream pipeline.
