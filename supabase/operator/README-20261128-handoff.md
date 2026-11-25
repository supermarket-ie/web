# Operator handoff — SuperValu review-tier attach (project `ytyzwiqnobxehdqrnzhx` only)

| # | File | What it does | Writes data? |
|---|------|--------------|--------------|
| 1 | `supabase/migrations/20261128090000_supervalu_review_attach.sql` | Adds `attach_review_supervalu_offer` (security definer, service_role only). It has the same checks as `attach_barcode_supervalu_offer`: SuperValu product URL for the SKU, SKU unowned, record has no SuperValu offer, a direct product-page capture bound to the SKU and URL within 1 day, title and brand from that capture, and a per-SKU advisory lock. The barcode requirement differs: the LATEST SuperValu observation must be a review-tier resolution of exactly this SKU from this Tesco origin, within 2 days. It also needs an AI `verified_exact` with all seven facts, the structural, wording-only and fresh-barcode checks passed, and a non-own-label brand. In ONE transaction it writes the offer, the capture, a repair row (policy `barcode-review-ai-v1`, basis `ai_review`) and the AI acceptance. | No (function only) |

Strong associations, `attach_barcode_supervalu_offer` and `barcode-exact-v1` are unchanged. Requires `20261126090000` (applied as `20261125065429`).
