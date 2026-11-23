# Operator handoff — barcode-led Tesco onboarding (project `ytyzwiqnobxehdqrnzhx` only)

One file, through the existing ChatGPT-connected Supabase route, unmodified:

| # | File | What it does | Writes prices? |
|---|------|--------------|----------------|
| 1 | `supabase/migrations/20261124090000_barcode_tesco_onboarding.sql` | Adds `onboard_tesco` to `catalogue_repairs.kind`; `onboard_barcode_tesco_offer` (SECURITY DEFINER, service_role only) creates the Tesco offer for a Tesco catalogue SKU not yet present, when Dunnes/SuperValu search resolved its GTIN to one strong SKU: on the one record owning those SKUs, else a new record named from Tesco's own title. Observations bound in the same transaction; append-only ledger row. | No |

Requires `20261123090000_barcode_catalogue_repairs.sql` (history `20261122181219`).

After apply the agent verifies: `rpc/onboard_barcode_tesco_offer` with an invalid SKU is refused; anon cannot execute it. Then the
first `APPLY=1` run of `scripts/barcode-tesco-onboarding.ts`, followed by SuperValu/Dunnes attach, Tesco evidence/approval/
expansion, `missing=1` SuperValu/Dunnes refresh and machine approvals.
