# Operator handoff — barcode catalogue repairs (project `ytyzwiqnobxehdqrnzhx` only)

One file, through the existing ChatGPT-connected Supabase route, unmodified:

| # | File | What it does | Writes prices / mappings? |
|---|------|--------------|---------------------------|
| 1 | `supabase/migrations/20261123090000_barcode_catalogue_repairs.sql` | Append-only `catalogue_repairs`; `apply_barcode_regroup` (split a mixed record: barcode-proven Tesco group moves to a new record) and `attach_barcode_supervalu_offer` (create the SuperValu offer SuperValu's own search resolved, with its direct capture). Both SECURITY DEFINER, service_role only. | Creates objects only. The functions later move/create `store_products` rows; nothing is deleted. |

Requires the 21–22 Nov migrations (history `20261121213903`, `…213914`, `…213937`, `20261122090837`).

After apply the agent verifies (read-only): `GET /rest/v1/catalogue_repairs?limit=1` → 200; a probe DELETE is
refused; `rpc/apply_barcode_regroup` with a non-Tesco offer id is refused ("not a Tesco offer on a record").
Then the first `APPLY=1` run of `scripts/barcode-catalogue-repairs.ts`, followed by the Dunnes attach, machine
approval and Tesco collection runs for the repaired records.
