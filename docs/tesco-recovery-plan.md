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

Within the original 341 cohort: **325 eligible, 16 held** (a tracked subset of
the 765, not the ordering key — see §4). Renewal mode selects nothing (0 fresh
trusted prices). Recovery is **expansion mode** only. Holds are protective and
MUST NOT be removed or bypassed.

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

## 4. Recovery priority — three-retailer comparisons first

Commercial priority: **restore three-retailer (Tesco + Dunnes + SuperValu)
comparisons first, then broaden Tesco coverage.** The existing expansion selector
already encodes exactly this: it orders by `overlap desc`, where `overlap` counts
distinct fresh Dunnes/SuperValu peers for the product's canonical. So the first
products it selects are those with fresh peers at both other retailers.

Important: the selector prioritises OVERLAP, **not** the original 341 cohort. The
341 is NOT the ordering key and is NOT a filter. Verified: of the first 25
eligible results, all 25 have both peers; only 13 are from the original cohort.
That is expected and acceptable — the original cohort is a natural (tracked)
SUBSET of the overlap-first ordering, not the target. Of the 765 eligible, 325
happen to be original-cohort; they will be recovered as they surface in overlap
order, with no special-casing.

So recovery proceeds in overlap order across the full 765 eligible:
1. Highest three-retailer value first (both peers fresh), which the selector does
   by default — no override needed. Track, for reporting, how many accepted
   prices restore a full three-retailer triple and how many are original-cohort,
   but do not reorder around the cohort.
2. Bounded batches of 25; protect existing fresh prices (renewal) ahead of
   expansion once any trusted prices exist again.
3. The 16 held original-cohort products (and all 745 holds) stay held until their
   evidence is reviewed — do not touch them.

## 5. Work-session execution runbook (self-contained)

Run on the permitted ChatGPT Work egress using the existing SQL bridge and the
unchanged collector. Nothing here modifies the collector, matching, holds, or any
AWS Tesco schedule.

### Preconditions
- Use the reviewed revision, Node 24, `npm ci`. Read `docs/tesco-direct-collection.md`
  and `docs/retailer-execution.md`.
- Read-only preflight (DB clock, never a wall clock): current fresh Tesco count,
  the §1 eligibility counts, the egress gate `workspace-supervised-20260929`
  (must be `enabled=false`, no active lease, cooldown clear), and that there are
  no NEW pending pages beyond the known 6 (§2).
- Do NOT clear cooldowns, enable the gate, or alter holds. Existing Work access is
  not evidence AWS/Vercel can reach Tesco.

### SQL bridge
The Node process holds NO database credential. It emits `{ "type":"sql","id":N,
"query":"..." }` on stdout; the operator runs each WHOLE query once via the
authenticated Supabase `execute_sql` connector and returns `{ "id":N,"rows":[...] }`
(or `{ "id":N,"error":true }`) on stdin. Each mutation is one atomic DO block —
never split it. A 90-second reply deadline applies; lost supervision stops further
requests. Use a persistent bidirectional PTY with `stty -echo -icanon`.

### Commands
Dry run (selection only; no run, no lease, no request):
```
exec node --use-env-proxy --import tsx scripts/tesco-supervised-collect.ts \
  --mode expansion --dry-run
```
Authorised bounded live batch (overlap-ordered expansion):
```
node --use-env-proxy --import tsx scripts/tesco-supervised-collect.ts \
  --mode expansion --limit 25 --confirm-run
```
Reconcile a run (REPORT ONLY — does not resolve/close anything):
```
node --use-env-proxy --import tsx scripts/tesco-supervised-collect.ts --reconcile RUN_UUID
```
Resume ONLY an interrupted run with no pending pages (same mode/queue):
```
node --use-env-proxy --import tsx scripts/tesco-supervised-collect.ts \
  --mode expansion --resume RUN_UUID --confirm-run
```
`--limit` is bounded 1–100; `--mode` is mandatory. A no-due result creates no run
and claims no lease.

### Eligibility rules (what a batch may collect)
Expansion selects: `store='tesco'`, `url_status='resolved'`, canonical URL shape
`https://www.tesco.ie/shop/en-IE/products/<sku>`, `proven` (a prior success
receipt), `observed_at IS NULL` (no fresh price), and NOT `held`. `held` =
a pending page OR an attempt in the last 24h OR a post-observation page that was
`outcome<>'ok'` OR carried identity-result reasons. Ordering is `overlap desc`
then id. Neither mode discovers new mappings. Holds are protective; never bypass.

### Safety checks (enforced by the runner — do not weaken)
- Exact identity before any accepted price: SKU match, live title/brand/pack/
  formulation via `validateTescoCollectedIdentity` + `classifyTescoReplacement`/
  `classifyTescoMapping`; raw-ingredient-vs-prepared-meal guard; duplicate-canonical
  guard. Mapping snapshot re-asserted under lock before request AND before finalise
  (`mapping_changed` aborts).
- Egress: single plain fetch (honest UA, manual redirects, 20s timeout), NO
  retries, cookies, proxy rotation, challenge solving, or search fallback.
- Pacing 10s min between requests; 10-min owned lease; owner guard stops an
  expired owner from releasing a successor's lease.

### Stop conditions (halt the batch; do not route around)
- HTTP 401/403 or an Akamai/challenge page → access_block → 48h cooldown.
- HTTP 429 → rate_limited → ≥15-min pause, honour `Retry-After` (longer wins).
- unsafe_redirect / network_error / parse_error / identity anomaly → stop.
- A block is persisted BEFORE the page checkpoint so a later DB error can't roll
  it back. On any terminal stop: reconcile before a new bounded run. Do NOT retry
  a held product, restart a terminal run, shorten cooldowns, switch egress, or use
  cached evidence to extend freshness.

### Verify new trusted observations (after each batch)
- Reconcile the run ID; confirm reserved = completed, and no new unresolved
  (pending) pages beyond the known 6.
- For each accepted product: a NEW `price_observations` row with `tesco_direct`
  provenance and a fresh `observed_at`; exact mapping identity; prior observation
  rows unchanged (renewals are append-only; a failed renewal keeps the old row and
  its original expiry).
- Count SUCCESS receipts (incl. unchanged-price) rather than `scrape_runs.inserted`
  alone. Record renewed / newly-fresh / expired separately so flat coverage can't
  hide a successful renewal.
- Compare fresh-coverage and three-retailer-triple counts before vs after.
  Successful retrieval is NOT trusted coverage — only accepted+finalised prices are.
- Expect accepted << fetched (identity gates reject most). Re-measure yield each
  session; do not assume a historical rate or raise `--limit` to chase a target.

## 6. Scope boundary

AWS-native autonomous collection is a SEPARATE investigation: it is blocked at the
network layer (403 from AWS datacenter egress) and is NOT required for this
recovery. This plan runs the proven supervised path where egress is permitted and
fixes the continuity gap. The egress/data-source decision is tracked separately in
PROJECT_STATE and does not gate §2–§5.
