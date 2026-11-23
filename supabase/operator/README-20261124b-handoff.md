# Operator handoff — onboarding category fix (project `ytyzwiqnobxehdqrnzhx` only)

| # | File | What it does | Writes prices? |
|---|------|--------------|----------------|
| 1 | `supabase/migrations/20261124120000_barcode_tesco_onboarding_category.sql` | Replaces `onboard_barcode_tesco_offer` with a version that takes the record category (products.category is NOT NULL; the first version failed with 23502 and wrote nothing) and accepts only the site's 24 catalogue categories. Same guards, grants and ledger. | No |

Requires `20261124090000_barcode_tesco_onboarding.sql` (history `20261123103204`).
After apply the agent runs `scripts/barcode-tesco-onboarding.ts` with `APPLY=1` and the downstream pipeline.
