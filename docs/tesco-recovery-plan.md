# Tesco trusted-coverage recovery & renewal-continuity plan

Last updated: 25 October 2026. Operational plan only — no Tesco requests, no
hold changes, no pending-record closure, no schedules, no infrastructure.

## 0. Why coverage lapsed (confirmed, uncapped evidence)

Renewals DID run 12–13 Oct (234 + 54 = 288 products). The last Tesco observation
was 13 Oct 15:23:53Z and **no supervised run started after 13 Oct**. The egress
gate was healthy (0 lifetime blocks; a routine 15-min post-http_error cooldown
only). The 288 refreshed to a ~19–20 Oct expiry and lapsed because **the next
renewal session was never run** — an operational-continuity failure of a
human-operated process, not an access block. Preventing recurrence (§3) is the
primary fix.

## 1. Current eligibility (exact selector, uncapped)

| Gate | Count |
|---|---|
| Tesco mappings | 2,461 |
| resolved + canonical URL | 2,380 |
| + previously proven (success receipt) | 1,510 |
| − held (failure / identity / pending / <24h) | 745 |
| **= expansion-eligible now** | **765** |

Within the original 341 cohort: **325 eligible, 16 held.** Renewal mode selects
nothing (0 fresh trusted prices). Recovery is **expansion mode** only.
Holds are protective and MUST NOT be removed or bypassed.

## 2. Read-only reconciliation runbook (6 pending + orphaned run)

These are UNKNOWN-OUTCOME records. `--reconcile RUN_UUID` only REPORTS state; it
does NOT resolve or close them. Preserve all of them until an independently
reviewed reconciliation procedure exists. Do NOT re-request, finalise, delete, or
mark success.

Pending requests (requested_url — run_id — first seen):
- 285859740 — 8b22ab1e — 29 Sep
- 308853589 — f4bb77d4 — 30 Sep
- 314109029 — 21443f41 — 8 Oct
- 317854748 — a502af52 — 9 Oct  (owned by the orphaned expansion run below)
- Glenisk listing (search?query=Glenisk) — 0e60076d — 10 Oct
- 311944507 — 0d7fca1f — 12 Oct  (from the `interrupted` 12 Oct renewal run)

Orphaned run:
- `tesco_supervised_expansion_a502af52-98bf-4e2b-9c06-79e371ba051d` — status
  `running` since 9 Oct, `activeSupervisor=null`. (4 ancient `pepesto_tesco_eval`
  runs stuck `running` since 20–21 Aug are unrelated legacy evals.)

Read-only steps (on the permitted Work SQL bridge; SELECT/report only):
1. For each pending run_id: `npm run tesco:supervised -- --reconcile RUN_UUID`.
   Record reserved/completed/unresolved pages and any success receipts. Expect
   `unresolved_attempts` where a pending page remains; that is the preservation
   signal, not an error.
2. Inspect each pending page's evidence (outcome, http_status, body_sha256,
   identity_results, detail) read-only to classify the likely true outcome
   WITHOUT a new request. Do not change the row.
3. For the orphaned `a502af52` run: reconcile-report only. Its lease is long
   expired; a future reviewed procedure may formally close the run, but that is a
   separate approved change — not part of this plan.
4. Produce a short written reconciliation record (per run: state + recommended
   disposition) for review. No mutation.

A reviewed closure procedure (future, separately approved) is required before any
pending row is resolved; this runbook deliberately stops at reporting.

## 3. Renewal-continuity design (the fix that prevents another lapse)

Goal: never again silently miss a renewal window. Deterministic, additive, and
it does not weaken any safeguard or enable automated Tesco egress.

Timing contract (already in code): trusted window = 7 days; a price becomes
renewal-DUE at 4 days old → a **3-day renewal window** per product.

Components (design; implement later under separate approval):
1. **Durable execution tracking.** A small read-only daily report over
   `latest_prices`/`price_observations` that, per store, lists: fresh count,
   count due (≥4d), count expiring within 24h/48h, and the next expiry timestamp.
   Source of truth is the DB clock, never a wall clock. (Analogous to the
   existing scrape-health view; no new write path.)
2. **Interruption detection.** Flag any `scrape_runs` row `status='running'` with
   `activeSupervisor=null` OR `started_at` older than the lease window → a
   stalled/orphaned run needing reconcile. Flag any `tesco_direct_collection_pages`
   `outcome='pending'` older than N hours → an unresolved attempt.
3. **Missed-run alert.** If `count(due) > 0` and no successful supervised run in
   the last 24h (or `expiring_within_24h > 0` and none today) → alert the
   operator. Alert carries: due count, soonest expiry, eligible count,
   stalled-run/pending flags. Delivery via the existing notification path
   (Resend/Telegram as already configured) — no new infra.
4. **Ownership & recovery (already enforced in the runner; surface it).** The
   `owned()` guard prevents an expired owner from checkpointing/releasing a
   successor's lease; resume replays only non-completed URLs; pending pages block
   a resume with `unresolved_attempts`. The alert should link the exact
   `--reconcile` / `--resume` commands for the flagged run.
5. **Separate accounting.** Record renewed vs newly-fresh vs expired per session
   so flat coverage can't hide a successful renewal (or a silent lapse).

Cadence: run a bounded supervised renewal session whenever the report shows due
products, comfortably inside the 3-day window (target: act on day-4 due, never
wait past day-6). Protecting existing fresh prices takes priority over expansion.

## 4. Prioritised recovery of the 325 original-cohort products

Supervised EXPANSION on the permitted (Work) egress — NOT AWS (403). Keep every
safeguard: exact SKU + title/brand/pack identity, mapping-snapshot re-assert,
10s spacing, lease/cooldown, idempotent finalise, one-attempt stop rules.

1. Start with the 325 eligible original-cohort products, **overlap-ordered**:
   those with FRESH Dunnes AND SuperValu peers first (maximises three-retailer
   comparison value per accepted price). The selector already orders expansion by
   `overlap desc`.
2. Bounded batches: `--mode expansion --limit 25 --confirm-run` via the documented
   SQL bridge. Dry-run first each session to inspect selection, gate and holds.
3. After each batch: reconcile the run ID; verify new observation IDs,
   `tesco_direct` provenance, exact identity, unchanged prior rows; count success
   receipts (incl. unchanged-price). Expect accepted << fetched (identity gates);
   re-measure yield rather than assuming a rate.
4. Do NOT touch the 16 held products in the cohort; they remain held until their
   evidence is reviewed. Do NOT raise `--limit` to chase a target or relax
   matching.
5. Then extend to the wider 765 eligible, still overlap-first, in continued
   bounded sessions, driven by the §3 report.

## 5. Scope boundary

AWS-native autonomous collection is a SEPARATE investigation: it is blocked at the
network layer (403 from AWS datacenter egress) and is NOT required for this
recovery. This plan runs the proven supervised path where egress is permitted and
fixes the continuity gap. The egress/data-source decision is tracked separately in
PROJECT_STATE and does not gate §2–§4.
