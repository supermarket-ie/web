# Supermarket.ie — Canonical Project State

## PILOT (approved; discovery-only code + runner + 50-product report) — Tesco mapping recovery — 30 October 2026

Approved 50-product discovery + identity-verification pilot. Built the
discovery-ONLY code (no mapping/price/hold changes), addressing the three review
improvements. Report: `docs/tesco-mapping-recovery-pilot-report.md`. No production
data changed; no live discovery launched here.

IMPROVEMENT 1 — REPRESENTATIVE sampling (was alphabetical): `pilotCohortSql` now
returns the FULL both-peer held set; `selectRepresentativeSample` round-robins
across every identity-failure defect category and prioritises likely recoveries
(recoverability high>medium>low, then both-peers) within each — so the 50 cover
all failure modes, not 50 of the biggest bucket.

IMPROVEMENT 2 — TWO-TIER verification: `classifySearchCandidates` →
`search_matched_unverified` (a Pepesto-search proposal); `verifyAgainstLivePage` →
`exact_verified` ONLY after a FRESH Tesco product-page corroboration via
`validateTescoCollectedIdentity` (live SKU/brand/quantity/pack/variant/
formulation). Search-only matches are never "fully verified" and never a price.

IMPROVEMENT 3 — COMPLETE runner: `runDiscoveryPilot` (DI, unit-tested) does per
product search→classify→persist evidence→optional tier-2 live check→cost tracking→
per-product report; stops on access/execution failure (no relaxed matching); has
NO finalise/price-write hook by construction (structural guarantee).

COHORT (read-only prod validation): 476 qualify (139 both-peers / 337 one-peer);
pilot samples 50 across defect categories, all both-peers → up to 50 potential NEW
three-retailer comparisons. Live evidence: most are the Tesco SKU resolving to a
genuinely different SIZE/VARIANT (needs rediscovery, NOT a canonical rename); a few
(Broccoli, Cucumber) are correct-mapping/generic-name.

OPERABILITY: Pepesto discovery path works (prior runs classified 48 candidates:
26 material_mismatch / 12 ambiguous / 10 exact; ~12c/product → ≈€6 for 50). Prior
run-level 'failed' = coverage threshold, not access failure.

PENDING: authoritative 6 pending = the 6 historical unresolved; the cohort
excludes all 6; never retries/closes them.

BOUNDARY (unchanged): `finalize_tesco_candidate_discovery` must NOT be generalised
to apply corrections+trusted-prices as-is. A correction-ONLY pathway (apply
approved SKU/URL with audit trail, NO price) + fresh live re-verification is a
SEPARATE later release, gated on the live pilot's yield. No canonical overwrite,
no cleared holds, no retried unknowns, no price without exact identity
verification, no AWS direct Tesco assumption.

RENEWALS (separate + urgent): the 323 trusted prices renew via the proven ChatGPT
Work supervised renewal path ONLY, kept fully separate from discovery. Status
(read-only, 29 Oct ~21:46 UTC): 323 fresh; 7 now due (≥4d); 0 expiring <24h;
soonest expiry 2026-11-01 ~20:00 UTC. Run a supervised renewal session as the
window opens to protect the 323.

GATE: 733 tests (+15 across pilot+runner), lint 0 errors/22 warnings, typecheck
clean (new files in tsconfig.tesco-supervised), behavioural 16, build OK.

## INVESTIGATION: Tesco expansion campaign post-mortem + renewal readiness — 28 October 2026

Read-only investigation (SELECT-only against prod Supabase via the service key
from Secrets Manager; no mutation, no collection, no schedule change, no mapping
edit). Figures from uncapped, paginated reads.

CAMPAIGN (5 expansion runs, 28 Oct 07:07–09:41 UTC): 421 requests, 246 trusted
prices recovered (success receipts 51+70+62+60+3). Runs 1–4 completed 100 each;
run 5 `5394fe7b-1b75-41dd-9891-fb3c4d27eade` stopped after 21 on
`identity_quarantine_rate_exceeded` (13/21 = 62% quarantine, >60% after ≥20). All
five runs reconcile clean: reserved=completed, **0 pending**, activeSupervisor
null, leases expired. No new unresolved requests created; the 6 historical pending
+ orphaned `a502af52` run from the §2 runbook are untouched and preserved. A later
`6fef1810` run (28 Oct 19:36) stopped on `identity_hold_rate_exceeded` (7 holds /
17) — same tail-of-cohort pattern, not in the 421 campaign.

RELIABILITY TREND (accept% / quarantine%): run1 51/15, run2 70/14, run3 62/6,
run4 60/24, run5 14/62. Acceptance is STABLE across runs 1–4 (no monotonic
decline); run 5 is a LOCALISED low-quality cluster at the overlap-poor tail, not
gradual degradation. The breaker worked as intended.

RUN-5 QUARANTINES (13, all reason `candidate does not establish full exact
canonical identity`; all product-confined: clean ok page, requested SKU found,
unique SKU, no price written — none indicate access/systemic problems). Root
cause is mostly STORED-CANONICAL-METADATA deficiency, not a live mismatch:
- Canonical too generic / missing brand / typo / extra word (mapping likely
  correct, name can't PROVE identity): 250220748 Clonakilty "Chubb"→"Chub";
  250830769 "Strong White Bread Flour"→Odlums 2Kg; 252408242 extra "Chunky";
  252681688 "Regular"→"In Tomato Sauce"; 253225519 Dentastix phrasing;
  283197863 missing "John West"; 305432039 Jumbone phrasing; 320559610 "Floor".
- Genuine product mismatch (mapping suspect): 304126185 "Beer Battered Chips"→
  live Donegal Catch Beer Battered COD; 315955603 "Green Sliced Jalapeños"→live
  Green Isle Sliced GREEN BEANS; 318184067 Colgate "Bluey 3+Years"→live "Total
  Active Prevention 7-12 Years"; and measure/pack mismatches 277662327 (7 pack
  Thickcut vs 10 Cap Unsmoked), 313599590 (12 pack vs 40x85g). The quarantine
  (durable hold, no price) is the correct outcome for all 13.

ELIGIBILITY (uncapped, mirrors selectSupervisedCandidates gates): 2,461 tesco
mappings. Expansion universe (resolved+proven+canonical URL+no fresh price) =
1,077 unique URLs, of which: **71 non-shared ELIGIBLE now**, 92 shared-SKU
deferred, 40 pending/historical-failure held, 874 identity-flagged held (durable
holds from prior rejections/quarantines — correctly protected). The <24h cooldown
is NOT the limiter (durable view = 71). CRUCIALLY all 71 remaining eligible have
**overlap=0** (no Dunnes/SuperValu peer) — the overlap-desc ordering already
consumed every high-overlap candidate, so further expansion adds Tesco-ONLY
coverage, not new three-retailer triples.

COMMERCIAL OUTCOME: current fresh Tesco = 323; **170 genuine three-retailer
triples** (tesco+supervalu+dunnes), 147 tesco+1, 6 tesco-only. The campaign
materially grew triples.

RENEWAL (7-day trusted window; DUE at ≥4 days old): renewalDue right now = **0**
(all 323 fresh prices are <4 days old — recovered today). Soonest expiry
2026-11-01T~20:00Z, latest 2026-11-04T~09:40Z. So the renewal window opens
~1 Nov; the first meaningful renewal tranche is ~1–4 Nov. Renewing is
append-only and idempotent: `--mode renewal` selects `observed_at ≤ now-4d`,
orders oldest-first, re-asserts the fresh-observation `duePredicate` under lock
at finalisation (a price refreshed since selection raises `observation_changed`),
and honours all historical holds via the same `held` predicate — so renewing the
246 just-recovered prices is safe and will not double-write or regress holds.
Renewal shares the identical safeguards (exact identity, snapshot assertion,
pacing, lease/cooldown, idempotency, circuit breakers).

RECOMMENDATIONS (evidence-based; NOT auto-applied; breakers NOT changed):
1. Fix the stored CANONICAL NAMES for the ~8 metadata-deficient quarantines
   (add brand/size, remove stray words) — a data-quality edit, reviewed
   separately; would convert several future quarantines into accepts WITHOUT
   weakening validation. The ~5 genuine mismatches need mapping review, not a
   name fix.
2. Expansion is near exhaustion for triple-building: the 71 remaining are all
   overlap=0. Prioritise RENEWAL from ~1 Nov to RETAIN the 170 triples +246
   prices over chasing low-value expansion. Consider an optional
   overlap-threshold filter so expansion batches skip overlap=0 candidates when
   the commercial goal is triples (selection-only, no mapping/validation change).
3. Implement the §3 renewal-continuity report/alert so the ~1 Nov window is not
   missed (the original lapse cause).
## DIAGNOSIS: Dunnes schedule DISABLED → triples collapsed to 0; SuperValu degraded is catalogue-drift — 29 October 2026

Read-only investigation (EventBridge/ECS/SQS/CloudWatch + prod Supabase SELECTs;
no config change, no collection, no mutation). Confirms the Mon/Thu automation
runs on AWS, isolates two issues, and flags identifier/monitoring hygiene.

EXECUTION PATH (verified on AWS, NOT Vercel): EventBridge Scheduler
`smie-prod-{supervalu,dunnes}-scrape-trigger` → `smie-prod-scheduled` ECS Fargate
task (`scheduled-runner.ts`, CRON_JOB override) → calls the in-app
`/api/workers/<store>-scrape-trigger` route → enqueues SQS batches →
`smie-prod-sqs-consumer` processes them. Proven by the scheduled-runner log
(stream d5b8a52e invoking supervalu-scrape-trigger → run
vercel_supervalu_20261029052100) and the AWS scrape-watchdog flagging both
stores. SQS queues + DLQs all EMPTY (no stuck/dead-lettered work).

IDENTIFIER HYGIENE (requirement 7 — the labels are MISLEADING but harmless):
the `vercel_<store>_<ts>` run_id prefix is HARDCODED in the trigger routes
(`{dunnes,supervalu}-scrape-trigger/route.ts`, `store-scrape-trigger/route.ts`)
and `retrieval_method='vercel_direct_product_page'` /
`'vercel_queue_dunnes_api_resolved_first'` are hardcoded in
`supervalu-direct-worker-base.ts` and matched verbatim in
`branded-intersection.ts` + the `trusted_retailer_offers` provenance view. So a
run labelled `vercel_*` TODAY still executes on AWS. These legacy labels are load-
bearing in the provenance SQL (source mapping dunnes_direct/supervalu_direct), so
they CANNOT be blindly renamed — a rename needs a coordinated code+view change.
Recommend documenting this and, later, decoupling the provenance tag from the
"vercel" wording.

ISSUE 1 — DUNNES: no Monday 26 Oct run because the AWS schedule
`smie-prod-dunnes-scrape-trigger` is **DISABLED** (created 25 Oct 00:05, disabled
25 Oct 08:34; SuperValu enabled 25 Oct 08:55). This matches the 25 Oct decision
to hold Dunnes pending a matching-confidence fix after its canary returned
`no_confident_match`. The 22 Oct Dunnes run (`vercel_dunnes_20261022051036`,
281 inserted) predates the AWS schedules → it was the LAST legacy Vercel-cron run.
No Dunnes run has happened since. CRITICAL CONSEQUENCE: the 859 dunnes_direct
observations' newest is 22 Oct 05:20 — as of ~29 Oct 10:14 UTC they crossed the
7-day `trusted_retailer_offers` freshness cutoff, so **Dunnes trusted/live
coverage = 0** and **three-retailer triples dropped from 170 (28 Oct) to 0**
(latest_prices: tesco 323 / supervalu 1,252 / dunnes 0; 284 tesco+supervalu-only,
39 tesco-only, 0 triples). NOTE: "dunnes 859" is the RAW observation count; the
TRUSTED+fresh count is 0. No Dunnes matching fix has landed since (git log clean
on dunnes/store-refresh paths), so re-enabling or a catch-up reproduces the same
`no_confident_remap` rejections.

ISSUE 2 — SUPERVALU degraded (NOT an AWS regression): every scheduled_full
finishes `degraded` at ~73–75% coverage vs an 85% threshold, back to September on
Vercel too. Latest run (vercel_supervalu_20261029052100) 266 failures =
142 `parsing|empty_product_state` (delisted/empty live pages) + 124
`matching|no_confident_remap` (can't confidently remap the fetched candidate),
both retryable=false. Low inserts (10 on Mon 26) are mostly because prices were
UNCHANGED (729), not failures. This is catalogue drift + matching strictness, not
infra — trusted-price protection correctly refuses low-confidence writes (0 bad
writes). Supervalu trusted coverage is healthy (1,252).

THURSDAY 29 OCT: SuperValu already RAN today (degraded, as above). Dunnes did NOT
and will NOT until its schedule is enabled. Trigger path verified working.

CATCH-UP (requirement 6 — appropriate but GATED, not initiated): a Dunnes
scheduled_full is the single highest-leverage action to restore triples (now 0).
But it is blocked by the same unfixed matching issue that disabled the schedule;
running it today would insert only the high-confidence subset (the 22 Oct run
inserted 281/1000 at 85.9% coverage, i.e. it DID write a large fresh set) and
would at minimum restore Dunnes freshness for those. Recommend: (a) land the
Dunnes matching-confidence fix first for best yield, OR (b) authorise a one-off
Dunnes scheduled_full now to re-establish freshness for the confidently-matched
cohort and restore triples, accepting reduced coverage. EITHER needs explicit
authorisation — NOT done here. No schedule config changed.

MONITORING GAP: no CloudWatch alarm for scrape staleness/degradation; detection
relies solely on the in-app `scrape-watchdog` cron (which DID flag both). Consider
an alarm or alert wired to watchdog output so a disabled/failing retailer surfaces
without manual inspection.
## OPERATION: authorised one-off Dunnes catch-up refresh — triples restored 0 → 162 — 29 October 2026

Authorised, supervised, manual one-off Dunnes `scheduled_full` refresh (≤1000) to
recover the trusted coverage lost when the EventBridge schedule stayed DISABLED
and the 22 Oct observations aged out of the 7-day window. Ran on the EXISTING AWS
path (no Vercel, no new method); the permanent schedule was NOT re-enabled or
changed.

EXECUTION (identical to the 22 Oct scheduled run): one-off `aws ecs run-task` of
the SAME `smie-prod-scheduled:3` task definition the EventBridge schedule uses,
with container override `CRON_JOB=dunnes-scrape-trigger`, same cluster
`smie-prod-cluster`, same subnets/SG/public-IP as the SuperValu schedule. The
task's `scheduled-runner` called `/api/workers/dunnes-scrape-trigger?limit=1000&
scope=scheduled_full` → enqueued 200 SQS batches of 5 to `dunnes-scrape-batches`
→ the `smie-prod-sqs-consumer` processed them. Task 5eef47ff, exit 0.

PREFLIGHT (all clear): task env DUNNES_VERCEL_WORKER_ENABLED=true,
DISABLE_RETAILER_COLLECTION=false, SUPABASE_READ_ONLY=false, QUEUE_BACKEND=sqs,
APP_ENV=production (Tesco flag false → untouched; SuperValu untouched). Consumer
ACTIVE 1/1 polling dunnes-scrape-batches; main+DLQ empty. No active Dunnes SCRAPE
run (one stale 22 Aug `discovery`-scope run holds no lock — selection is the
stateless `select_store_products_for_refresh` RPC — and its queue is empty, so no
conflict).

SAFEGUARDS (unchanged, verified in code): direct exact SKU/URL match else
`matchCandidate` with hard gates (size compat, no type/variant conflict) + score
≥0.55, canonical coverage ≥0.6, candidate coverage ≥0.5; below threshold →
`no_confident_match` FAILURE with no price write and NO remap; price + `dunnes_
direct` provenance + receipt written only on verified success via
`finalize_store_scrape_product`; idempotent via `scrape_product_receipts`
(`alreadyFinalized` skip). No unverified acceptance, no automatic remap.

OUTCOME (run `vercel_dunnes_20261029102250` /
7c667559-54cb-4590-a783-36ab6ffc98a7, status SUCCESS): attempted 1000, extracted/
verified 857, inserted 27 (genuine price changes), unchanged 830 (re-verified
fresh), failed 143, coverage 85.7% (threshold 75%, not breached). Failures =
96 `matching|no_confident_match` + 47 `parsing|no_search_results`, all
retryable=false → held, zero bad writes. RESTORED: Dunnes trusted/fresh coverage
0 → 857; **three-retailer triples 0 → 162**. latest_prices now dunnes 857 /
supervalu 1,252 / tesco 323. (The low insert count vs 22 Oct's 281 is expected —
most prices unchanged over the shorter gap; 857 were re-verified fresh.)

STILL OPEN (per authorisation — NOT done here): the permanent Mon/Thu Dunnes
EventBridge schedule remains DISABLED pending understanding the underlying
matching blocker (the ~96 no_confident_match per run is the long-standing ~14%
tail, not a new fault). A staleness ALERT so a disabled schedule can't silently
zero a retailer's coverage is proposed separately (see PR #279 diagnosis).

## OPERATION: durable schedule config + retailer-refresh alerting — 30 October 2026

Two operational hardening changes after the Dunnes re-enable; no scraper,
matching-confidence, rejection or provenance change.

TERRAFORM DRIFT RESOLVED (authoritative, no secrets committed): `enabled_schedules`
is now governed by the version-controlled DEFAULT of `var.enabled_schedules` in
`infra/terraform/variables.tf` (7 low-risk jobs + supervalu-scrape-trigger +
dunnes-scrape-trigger; Tesco pepesto-tesco-retrieve intentionally omitted). The
override was REMOVED from the gitignored `terraform.tfvars` so the committed
default governs — a future `terraform apply` from any tfvars keeps Dunnes +
SuperValu enabled and cannot silently disable a retailer (the 29-Oct failure
mode). `terraform.tfvars` holds no secrets (ARNs/config only) but is gitignored;
the schedule intent now lives in git regardless. VERIFIED: `tofu plan` shows NO
schedule changes and NO State flips from this (live state already matches); full
plan was drift-neutral before the alerting wiring was added.

RETAILER-REFRESH ALERTING IMPLEMENTED (reuses scrape-watchdog + Resend):
- `src/lib/retailer-health-alerts.ts` (pure, 14 unit tests) — typed issues with
  high/medium severity for: (1) MISSED scheduled run (no scheduled_full for the
  previous Mon/Thu 05:10 UTC slot within 26h grace, actively-scheduled stores
  only), (2) DEGRADED/FAILED STREAK (last 3 scheduled_full unhealthy) plus the
  existing stuck/failed/single-degraded checks, (3) COVERAGE low / expiring-24h /
  regression (from retailer_coverage_current + snapshots), (4) three-retailer
  COMPARISON low floor AND significant decline (≥10pp or ≥30% vs baseline). Tesco
  excluded from "missed" via SCHEDULED_RETAILERS.
- `src/app/api/cron/scrape-watchdog/route.ts` rewired to the pure function; now
  DELIVERS via Resend and returns channelConfigured + deliveryError so an
  unconfigured channel is explicit (never a silent no-send). Stale "Vercel logs"
  wording replaced with the AWS path.
- Terraform: SCRAPE_ALERT_EMAIL (`scrape_alert_email`) + SCHEDULED_RETAILERS
  (`scheduled_retailers`) wired into the worker task env; delivery uses the
  existing RESEND_API_KEY secret.

GATE: 704 tests (was 690; +14), lint 0 errors/22 warnings, behavioural 16, build
OK, tofu fmt/validate clean.

DELIVERY GAP FOUND: in prod the scheduled task has RESEND_API_KEY but
SCRAPE_ALERT_EMAIL was UNSET, so the watchdog's email branch was silently skipped
(log-only). The code now surfaces this as channelConfigured=false; full delivery
requires an OPERATOR to (a) set scrape_alert_email in the apply-time tfvars to the
ops recipient, and (b) deploy a new image containing this watchdog code, then
`terraform apply -var image_tag=<new>` (the plan replaces the scheduled +
sqs-consumer task defs to add the env vars and rolls every schedule's
task_definition_arn to the new revision — NO schedule State change). Not applied
here: the current worker image (df9f0c1-prod) predates this code, so an env-only
apply would deploy vars onto old code.

## OPERATION: Dunnes Mon/Thu EventBridge schedule RE-ENABLED — 29 October 2026

Authorised re-enable of `smie-prod-dunnes-scrape-trigger` after the one-off
catch-up succeeded on the identical AWS path. Only the schedule's STATE changed
(DISABLED → ENABLED); no scraper, matching, provenance, task def, networking or
SQS routing change.

VERIFIED IDENTICAL to the successful one-off run before enabling: task def
`smie-prod-scheduled:3` (FARGATE), cluster `smie-prod-cluster`, role
`smie-prod-scheduler`, subnets subnet-0ff02da22ebe91794 + subnet-07c3dc58ad255b5bc,
SG sg-0f382e9d266cbb4dc, AssignPublicIp ENABLED, container override
`CRON_JOB=dunnes-scrape-trigger`. Env on the task (DUNNES_VERCEL_WORKER_ENABLED=
true, DISABLE_RETAILER_COLLECTION=false, SUPABASE_READ_ONLY=false, QUEUE_BACKEND=
sqs, APP_ENV=production) and the SQS consumer polling `dunnes-scrape-batches` are
unchanged. Preflight: no active Dunnes scrape run (the lone 22-Aug
`discovery`-scope running row holds no lock), Dunnes queue+DLQ empty.

RESULT (verified): state ENABLED (LastModified 2026-10-29T10:38:06Z), cron
`cron(10 5 ? * MON,THU *)` UTC → **next run Mon 2 Nov 2026 05:10 UTC**, then Thu
5 Nov, continuing Mon/Thu. SuperValu schedule still ENABLED, Tesco
(`pepesto-tesco-retrieve`) still DISABLED — both UNAFFECTED. Continuity: the one-off
catch-up's 857 fresh Dunnes prices expire ~5 Nov; the 2 Nov run precedes that, so
coverage stays continuous.

IaC / DRIFT NOTE (action for whoever runs terraform): the schedule state is
Terraform-managed via `state = contains(var.enabled_schedules, key) ? ENABLED :
worker_schedule_state(DISABLED)`. `infra/terraform/terraform.tfvars` is
GITIGNORED (not version-controlled), so enablement state does not live in the
repo. I updated the LOCAL tfvars to add `dunnes-scrape-trigger` to
`enabled_schedules`, and set the LIVE state to ENABLED via
`aws scheduler update-schedule` so it is active now. A future `terraform apply`
run from any tfvars that does NOT include `dunnes-scrape-trigger` in
`enabled_schedules` would REVERT the schedule to DISABLED. The canonical tfvars
used for applies must include it to keep live state and IaC consistent.

The permanent re-enable does NOT resolve the underlying ~14% `no_confident_match`
matching tail (investigated separately); matching thresholds are unchanged.

## HOUSEKEEPING: Vercel decommissioned from CI/CD + repo; AWS is authoritative — 28 October 2026

Infrastructure/CI housekeeping (separate from Tesco collector work). No
production deploy or service restart; read-only AWS + GitHub verification only.

PRODUCTION ARCHITECTURE (verified live, read-only): AWS eu-west-1 account
611622961299. Website+Eve on ECS Fargate `smie-prod-svc` (2/2) on cluster
`smie-prod-cluster` behind ALB `smie-prod-alb` (active); SQS consumer
`smie-prod-sqs-consumer` (1/1); ECR repo `smie-prod`; `QUEUE_BACKEND=sqs` on both
services. `www.supermarket.ie` → ALB (HTTP/2 200, x-powered-by Next.js), apex →
301 via awselb/2.0; apex static IPs 166.117.14.195 / 166.117.236.132 (Global
Accelerator). No Vercel on the customer path or DNS. Authoritative reference now
in `docs/aws-production.md`.

RELEASE GATE (verified): the only required check on `main` is the GitHub Actions
**`validate`** job, enforced by the repository RULESET "Protect main" (id
22401766, active): squash-only merges, review-thread resolution, `validate`
required (integration_id 15368 = GitHub Actions), non-fast-forward + deletion
protection. Vercel is NOT a required check — the `vercel[bot]` "Account is
blocked" commit status is cosmetic and never gated merges. The ruleset was left
UNCHANGED (not weakened) — confirming this was an explicit task constraint.

REMOVED from the repo (demonstrably unused; no AWS/build impact): `vercel.json`
(Vercel-only deploy directives — `dub1` region + per-route maxDuration; not read
by the Docker/standalone build, irrelevant on ECS) and `public/vercel.svg`
(unused Next template asset). Stale "Vercel" comment in next.config.ts corrected;
`docs/vercel-independence.md` banner-marked HISTORICAL/superseded.

RETAINED (still wired — removal would be a behavioural change, not housekeeping):
`@vercel/queue` dependency + the `vercel` branch of the queue facade
(src/lib/queue/index.ts). Inert in production (only `await import()`-ed when
QUEUE_BACKEND=vercel; prod is sqs), kept as a code-level fallback. Flagged for
optional future removal with that branch.

AGENTS.md UPDATED: added an explicit "Production platform: AWS (Vercel is
decommissioned)" section; the old instruction to "verify Vercel production" now
says verify the AWS ECS/ALB services, and tells future sessions to ignore any
`vercel[bot]` status and treat `validate` as the sole production gate.

ACCOUNT-LEVEL CLEANUP STILL REQUIRED (manual — NOT possible from the repo or the
CI token): the `vercel[bot]` GitHub commit statuses + Deployment objects come
from the Vercel GitHub App integration still linked to this repo at the
`supermarket-ie` ACCOUNT level (the repo has NO webhooks; this is the App, not a
workflow). Stop it by EITHER (a) Vercel dashboard → project → Settings → Git →
Disconnect the GitHub repo (and optionally delete/pause the project), OR (b)
GitHub account Settings → Applications → Installed GitHub Apps → Vercel → remove
access to supermarket-ie/web. Until then the Vercel status is expected/harmless.
Neither CI nor the current token has the app-management / Vercel-dashboard access
to do this automatically.

VERIFICATION: neither AWS deploy workflow auto-deploys — `aws-ecr-deploy-image.yml`
is workflow_dispatch-only (gated on the `aws-prod` environment) and only pushes an
ECR image (ECS rollout is a separate manual `terraform apply`);
`aws-preview-build.yml` is build/validate-only. So this cleanup cannot trigger an
AWS deployment. Full CI gate re-run green after the changes (see this PR).

## TUNING: ordinary-hold consecutive breaker raised 3 → 5 — 17 October 2026

Supervised campaign f3df7f34-2484-472c-b9a1-925bbfeb892b stopped after 19 requests
on `identity_hold_consecutive_exceeded` (8 accepted trusted prices, 7 ordinary
holds, 4 quarantines, 0 new unresolved; the three final holds were ordinary
formulation / brand-own-label / formulation conflicts). The preceding 71-request
run stopped on the SAME three-consecutive threshold despite accepting 49 trusted
prices. Ordinary attribute holds cluster naturally in the catalogue, so a limit of
3 was throttling otherwise-safe throughput. Fresh Tesco coverage is 77; 509
unique-SKU candidates remain eligible.

CHANGE (focused, one constant): `MAX_CONSECUTIVE_HOLDS` 3 → 5 in
tesco-identity-disposition.ts. Everything else UNCHANGED:
- Ordinary-hold RATE breaker retained: >40% after >=10 attempts
  (`identity_hold_rate_exceeded`).
- Separate quarantine breakers retained: 8 consecutive / >60% after 20 attempts
  (`identity_quarantine_consecutive_exceeded`/`_rate_exceeded`), own axis.
- All identity acceptance checks, mapping-snapshot assertion (pre-request AND at
  checkpoint, incl. the quarantine_continue re-assert), shared-SKU exclusions,
  durable holds (no price for a held product), pacing, cooldowns, leases,
  idempotency and systemic hard-stops preserved. No rejected product is converted
  to an accepted observation. Identity verification is NOT weakened; only the
  tolerance for short isolated clusters of ordinary holds increases.

Counters (consecutiveHolds/totalHolds/attempts) remain persisted in
scrape_runs.error_summary and re-seeded on resume, so interruption/resume cannot
reset or bypass the breaker; an acceptance still resets the consecutive counter.

TESTS 690 pass (65 files; +4 net): disposition unit breaker now proves 3 and 4
consecutive CONTINUE and 5 STOPS, consecutive-takes-precedence and
quarantine-independence updated to the new threshold; supervised PGlite tests add
"tolerates 3 consecutive" + "tolerates 4 consecutive" (complete), "trips after 5
holds" (stops at the 5th), rate breaker still trips, resume keeps counters durable;
campaign tests add a CONSECUTIVE-threshold stop and a RATE-threshold stop each
reported distinctly (stoppedSystemic=true, quarantinedProducts=0), distinct from an
identity_validation_anomaly or quarantine stop. typecheck:tesco-supervised/
discovery/branded clean; lint 0 errors/22 warnings; behavioural 16; Next build
(CI=true) OK. docs/tesco-recovery-plan.md updated (new breaker section + date). No
live Tesco collection run; no AWS Tesco schedule enabled.

MERGED: PR #276, squash-merged to main as
**815355cbb53cb418c3a2db26e972b1627c7e10b9** — green CI (validate) + verified no
active supervised session (0 of 5 running tesco runs with activeSupervisor; 0
active egress leases). Post-merge CI on main green. The production-approved
collector now uses MAX_CONSECUTIVE_HOLDS=5; all other protections unchanged.

## FIX: quarantine_continue re-asserts mapping/acquisition snapshot at checkpoint — 17 October 2026

Narrow correction to the merged quarantine-and-continue (PR #273). BUG: in
tesco-supervised-collection.ts the final checkpoint re-asserted the mapping +
acquisition snapshot only when `accepted` —
`accepted ? assertSnapshot(target) + assertAcquisition(target, runId) : ''`. For a
`quarantine_continue` disposition this skipped the independent re-check, so the
underlying mapping or acquisition evidence could change AFTER reservation but
BEFORE checkpoint without being detected; a quarantine decision could be committed
against stale evidence.

FIX (one line, reuses the proven accept-path guard): the checkpoint condition is
now `accepted || isQuarantine ?`. If the mapping/acquisition snapshot changed since
reservation, assertSnapshot/assertAcquisition raise
`mapping_changed`/`acquisition_or_peer_changed`, abort the atomic checkpoint DO
block, and leave the reservation row `pending` → the request is INTERRUPTED and
fully reconcilable, never continued on stale state. No new quarantine-specific
assertion was needed. Behaviour preserved exactly for accepted prices (already
asserted), ordinary holds, transport stops and lost acknowledgements (still not
asserted, as before). `isQuarantine` is in scope well before the checkpoint.

TESTS 686 pass (65 files; +1): new PGlite integration test "STOPS (reconcilable)
if the mapping snapshot changes after reservation, before a quarantine checkpoint"
— seeds a SINGLE Heinz-type quarantine candidate, mutates store_product_name
mid-fetch, and asserts result=interrupted, the Heinz page row stays `pending`, the
Heinz URL is in `unresolved`, 0 tesco_direct observations, and resume returns
`unresolved_attempts`. typecheck:tesco-supervised/discovery/branded clean; lint 0
errors/22 warnings (baseline); behavioural 16 pass; Next build (CI=true) OK.

MERGED: PR #274 squash-merged after green CI (validate) and a verified no-active-
supervised-session check (0 of 5 running tesco runs have activeSupervisor; 0 active
egress leases on gate workspace-supervised-20260929). New main SHA
**98454ec8dd70b55f67086026a06a5b6dabac25a8**; post-merge CI on main green. Vercel
commit-status shows "Account is blocked" — expected/known post-migration state
(production serves from AWS ECS Fargate; Vercel no longer gates), NOT a regression
from this change. No live Tesco collection run; no AWS Tesco schedule enabled.

FOLLOW-UP (PR #275): the new integration test as first merged seeded TWO products;
with both expansion-eligible and no peers the batch ordering was a UUID-`id` tie,
so when the clean product sorted first it was accepted (1 observation) BEFORE the
Heinz checkpoint interrupted — a latent flake that failed `validate` on #275. Fixed
by seeding ONLY the Heinz candidate so the batch is deterministic (the interrupt
path is unchanged; the second product proved nothing). Verified stable over
repeated runs. The code fix itself was always correct; only the test was
non-deterministic.

## FEATURE: product quarantine-and-continue (Heinz case) — 26 October 2026

A 1000-request campaign terminated after 6 requests on one product: Tesco SKU
264880549, canonical "Heinz By Nature Chicken Dinner 7+ Months 200g" vs live
"Heinz Sunday Chicken Dinner Baby Food Jar 200g" → reason "candidate does not
establish full exact canonical identity". Investigation (read-only, prod) confirmed
PRODUCT-CONFINED: outcome=ok, http 200, final_url==requested (no redirect), body
hash present (clean parse), identity SKU==requested SKU (found+corroborated), SKU
group size=1 (not shared), single ambiguous reason, NO new tesco_direct observation
(hold worked). A genuinely different product, correctly rejected — but it should
not kill the campaign.

Narrow quarantine-and-continue: new disposition `quarantine_continue`
(tesco-identity-disposition.ts) returned ONLY when productFound && no
materialDuplicateConflict && EVERY effective reason is in the narrow
QUARANTINE_REASONS set (currently just the ambiguous-canonical reason; disjoint
from CONTINUE and STOP). NOT a blanket allow-list: mixed/systemic/unknown reasons,
product-not-found, or a material duplicate-canonical conflict all remain
fail-closed STOP. The quarantined product is durably checkpointed/held (outcome=ok,
identity_results reasons, detail.quarantined=true) with NO price observation; the
batch continues.

SEPARATE quarantine breaker (req 5): own axis
(consecutiveQuarantines/totalQuarantines, persisted in run state, reset on accept);
thresholds 8 consecutive / >60% after 20 attempts — more tolerant than the ordinary
hold breaker (3 / >40% after 10) but bounded; trips →
identity_quarantine_consecutive_exceeded/_rate_exceeded. Independent of the hold
breaker.

Campaign report upgraded (req 6): per-run inserted/held/quarantined + totals
acceptedPrices/ordinaryHolds/quarantinedProducts/excludedSharedSkuGroups(+mappings)/
stoppedSystemic/ACTUAL remainingEligible via new countEligibleCandidates() (not
capped at 100)/unresolvedRequests.

Preserved unchanged: exact acceptance (accept iff found && reasons.length==0), all
historical holds, leases, cooldowns, pacing, idempotency, lost-ack→interrupted
(continue only after a durably-acknowledged checkpoint), access-block/429 stops,
URL uniqueness, shared-SKU pre-filter, material duplicate-canonical hard stop.

TESTS 685 pass (65 files; +14): classifier quarantine + disjoint + separate breaker
units; Heinz integration (durably held, never accepted, next requested); quarantine
breaker (8) distinct from hold breaker; systemic+ambiguous still hard-stops;
campaign quarantines Heinz without terminating + reports separately; stoppedSystemic
flagged. typecheck/lint 0 err/behavioural/build green. Focused PR; merge on green CI
+ no active Work session.

## FEATURE: large-tranche Tesco recovery campaign — 26 October 2026

Enables a ChatGPT Work supervised campaign to process the full eligible Tesco
cohort (hundreds of products) without stopping for known catalogue conflicts or
re-approval per batch. No live Tesco collection run as part of this work; no AWS
Tesco schedule enabled.

Pieces (all additive; collection semantics unchanged):
- selectSupervisedCandidates gains `excludeSharedSku` — defers any product whose
  SKU is mapped by >1 canonical product (incl. synonyms), applied in the eligible
  CTE BEFORE the limit (+ JS belt-and-braces). Preserves overlap/oldest-first
  ordering and the pre-LIMIT URL dedup from #271. The runtime duplicate-canonical
  hard stop remains an independent safeguard.
- listExcludedSharedSkuGroups() — read-only enumeration of deferred shared-SKU
  groups (sku, member canonical names, store_product_ids, reason) for the report.
  Touches no mappings/holds/observations.
- src/lib/tesco-campaign.ts (runTescoRecoveryCampaign): loops bounded runs (<=100)
  up to a request budget (<=1000), re-selecting fresh eligibility each iteration;
  CONTINUES only on result 'complete'; STOPS + reports on anything else
  (access_block/429/identity_validation_anomaly/parse/network/redirect/
  identity_hold_*/interrupted/unresolved_attempts/terminal_run/no_more_eligible/
  budget_exhausted). Never resumes terminal/interrupted runs or retries unknowns.
  Reconciles each completed run; the next claim re-checks lease/cooldown/ownership
  inside collectTescoSupervised (lost gate → non-complete → stop). Emits a single
  consolidated CampaignReport.
- scripts/tesco-recovery-campaign.ts — Work CLI (same JSONL SQL bridge, 90s
  deadline), `--mode --request-budget --max-per-run --dry-run|--confirm-run`.

Safety preserved (unchanged): exact identity, hold-and-continue for ordinary
mismatches, no-price rejection, pacing, circuit breakers (3 consecutive / >40%
after 10), Akamai/429 stops, leases/cooldowns, idempotent finalisation, durable
holds, URL uniqueness. Unexpected structural conflicts still hard-stop.

TESTS 671 pass (65 files; +7 campaign integration): shared-SKU excluded + never
requested + reported; selection before LIMIT; sequential bounded batches (>1 run,
no re-approval); budget respected; hold-and-continue across campaign; systemic/
terminal run stops the campaign (no continue); interruption stops + reports
unresolved (no retry); consolidated report has all sections. typecheck (incl.
campaign files added to tsconfig.tesco-supervised) / lint 0 err / behavioural /
build green. Focused PR; merge on green CI + no active Work session.

## FIX: batch selection enforces one request per URL/SKU — 26 October 2026

selectSupervisedCandidates is per-mapping, so two canonical mappings sharing one
Tesco SKU (hence one store_url), incl. equivalent synonyms, could BOTH be
selected. At runtime the second reservation raised attempt_already_recorded and
interrupted the batch (the avoidable interruption seen in the 5-request session).

FIX (defense-in-depth, independent of the shared-SKU pre-filter): the selector now
collapses to ONE row per requested URL BEFORE the limit — an added `url_unique`
CTE with row_number() over (partition by store_url order by id), take rn=1 — then
applies the existing batch ordering (expansion overlap desc / renewal observed_at
asc) + limit. So dedup happens pre-LIMIT and the batch is still filled with
distinct eligible URLs; overlap/oldest-first prioritisation preserved; peers still
carry the full same-SKU group for the runtime duplicate-canonical hard stop. A
belt-and-braces JS Set also guarantees URL uniqueness in the returned array.
No change to acceptance/identity/access rules, mappings, observations or holds.

TESTS (664 pass): new selectSupervisedCandidates URL-uniqueness suite — 3 mappings
on one SKU return exactly one candidate for that URL; dedup BEFORE limit fills the
batch with distinct URLs; renewal oldest-first ordering preserved through the
dedup CTE; a full live run over a shared-SKU group makes ONE request per URL with
NO attempt_already_recorded interruption. typecheck/lint(0 err)/behavioural/build
green. Focused PR; merge on green CI + no active Work session.

NOTE: this is the URL-uniqueness safeguard within the larger "large-tranche Tesco
recovery" objective (shared-SKU PRE-FILTER with consolidated exception reporting
and bulk consecutive runs). That broader campaign work is tracked separately; this
PR lands the per-URL uniqueness guarantee it depends on.

## FIX: duplicate-canonical masking in hold-and-continue — 25 October 2026

Narrow safety correction to the merged hold-and-continue (PR #269). BUG:
validateTescoCollectedIdentity returns an ordinary attribute conflict
(measure/variant/brand/pack) via classifyTescoReplacement BEFORE reaching its
duplicate-canonical (classifyTescoMapping) check, so a MATERIAL duplicate-SKU
conflict was masked and hold-and-continue proceeded when it should hard-stop.
Real examples: SKU 308828886 (Yogurt / Mixed Berry Yogurt / Sweet Chilli rice
cakes share one SKU) and SKU 306647106 (Lenor Spring Awakening / Summer Breeze
dryer sheets share one SKU) — verified in production (distinct canonical names,
non-equivalent term-sets).

FIX (narrow): new pure helper hasMaterialDuplicateCanonicalConflict() in
tesco-mapping-audit.ts independently inspects the product's SAME-SKU canonical
GROUP (mirrors the duplicate branch of classifyTescoMapping, isolated from the
attribute-conflict ordering). The collector computes it from target.peers and
passes it to classifyIdentityOutcome(reasons, productFound, materialDuplicate),
which now forces 'stop' when set — BEFORE accept/skip/hold — regardless of any
ordinary reason returned first. Genuine synonyms (equivalent canonical term-sets
across the whole group) are NOT flagged → preserved as hold-eligible. NO change
to acceptance rules, validator, mapping records, historical observations, or
existing holds.

TESTS: full suite 660 pass (64 files). New: tesco-material-duplicate.test.ts
(6 — both real SKU examples flagged, synonyms + unique not flagged, incomplete
group flagged); classifier tests for the materialDuplicate flag; PGlite
integration tests reproducing BOTH real SKUs end-to-end (stop, 0 observations);
strengthened breaker tests (interrupt after >=2 acknowledged holds → resume →
counters cumulative/consecutive NOT reset; lost hold-checkpoint ack → interrupted,
no further fetch, 0 observations). typecheck:tesco-supervised/discovery/branded
clean; lint 0 errors/22 warnings; behavioural 16; build OK. Delivered via a
focused follow-up PR; merge only on green CI + no active Work session.

## IMPLEMENTED: hold-and-continue on ordinary Tesco identity mismatch — 25 October 2026

Approved from PR #268 with refinements; implemented on branch
feat/tesco-batch-continuation (separate production-change PR; #268 kept as the
review record). NOT merged until verified + CI green + no active Work session.

COLLECTOR BEHAVIOUR CHANGE (exact): previously ANY identity rejection set
pageStop and `break` (ended the batch). Now, per product on a clean HTTP 200,
`classifyIdentityOutcome(reasons, productFound)` returns:
- accept (productFound && reasons.length===0) → finalise (unchanged).
- skip_no_price (only benign unavailable_or_no_regular_price) → non-accepting,
  non-terminal; move to next product.
- hold_continue (EVERY effective reason is an ordinary product-level mismatch:
  measure/pack/brand/variant/formulation/freshFrozen/productType/ownLabel
  conflicts + raw-vs-prepared) → the product is checkpointed+held (NO observation)
  and the batch CONTINUES to the next eligible product.
- stop (ambiguous-generic, different_sku/urlSku, missing_exact_product,
  duplicate-canonical, acquisition snapshot disagreement, OR any unknown reason —
  fail-closed) → end the batch (`identity_validation_anomaly`), unchanged.
All non-identity stops UNCHANGED: access_block(401/403)/429/http/network/
unsafe_redirect/parse, lease/ownership loss, lost-ack interrupted, pacing,
mapping/acquisition snapshot change.

CIRCUIT BREAKER (new): stop after 3 CONSECUTIVE holds
(identity_hold_consecutive_exceeded) OR when hold RATE >40% after ≥10 attempts
(identity_hold_rate_exceeded). Counters (consecutiveHolds/totalHolds/attempts)
persisted in scrape_runs.error_summary and re-seeded on resume → cannot be reset
or bypassed by interruption/resume. Continue only AFTER the rejection checkpoint
`execute()` resolves (acknowledgement confirmed); a lost ack → caught →
interrupted → stop (never continue on an unacknowledged checkpoint). NEVER-ACCEPT
invariant unchanged: a price is finalised only for accept.

SAFETY INVARIANTS VERIFIED: never accept failed identity; SKU/brand/variant/
quantity/mapping validation untouched; full rejected-product evidence + hold
preserved (page row outcome + identity_results, no price); restarts cannot
duplicate requests or bypass holds (held page row + `held` predicate +
completedUrls replay); pacing/lease/idempotent finalise preserved.

TEST RESULTS: full suite 646 pass (63 files; +53 vs prior 593) incl. 46 classifier
unit tests + 7 new PGlite integration tests (interspersed accept/hold, no-write
for held, 3-consecutive breaker, consecutive reset on accept, 40% rate breaker,
systemic missing_exact_product stop, breaker persistence across resume) + updated
pack-mismatch test (now hold-and-continue). typecheck:tesco-supervised/discovery/
branded clean; lint 0 errors/22 warnings (baseline); behavioural gate 16 pass;
Next build (CI=true) OK. No active supervised Tesco run (5 running rows are known
orphans, activeSupervisor null; gate no active lease; no recent pending) → safe to
merge. No Tesco request initiated; no AWS Tesco schedule enabled.

## PROPOSAL: hold-and-continue on ordinary identity mismatch (review only) — 25 October 2026

First supervised recovery batch succeeded: 2 trusted prices + 2 new 3-retailer
comparisons; the 3rd product was correctly HELD (stored canonical 1kg vs Tesco
700g = measure mismatch) and the batch stopped. Investigating a scalability
improvement so one ordinary, well-classified mismatch no longer terminates the
whole batch. PROPOSAL ONLY — production collector behaviour NOT changed.

Current behaviour: tesco-supervised-collection.ts sets identityStop on ANY reason
!= 'unavailable_or_no_regular_price' → pageStop → break (ends batch). Key fact:
the per-product rejection is ALREADY durably checkpointed (page row outcome +
identity_results + detail; no price finalised) BEFORE the break — so only the
break-vs-continue decision changes; the hold/evidence mechanism is untouched.

Proposed policy (docs/tesco-batch-continuation-proposal.md): after the durable
rejection checkpoint commits, CONTINUE (hold this product, skip to next) only when
EVERY effective reason is an ordinary product-level mismatch (measure/pack/brand/
variant/formulation/freshFrozen/productType/ownLabel conflicts, raw-vs-prepared,
ambiguous-generic). STOP (as today) on systemic/mapping-integrity signals
(different_sku/urlSku, missing_exact_product, duplicate-canonical, acquisition
snapshot disagreement) and ANY unknown reason (fail-closed). Hard stops unchanged
(access_block/429/http/network/redirect/parse, lease/owner loss, lost ack, pacing,
snapshot change). NEW circuit breaker: ≥5 consecutive holds → stop
(identity_hold_rate_exceeded); an accept resets the counter. NEVER-ACCEPT
invariant unchanged (accept iff reasons.length==0 && product found). Restarts can't
duplicate/bypass: the held page row + `held` predicate + completedUrls replay
already prevent re-request; continue only after a durably-acknowledged checkpoint
(lost ack → interrupted → stop).

Test evidence (DELIVERED, review-only, NOT wired in): pure classifier
src/lib/tesco-identity-disposition.ts + src/lib/__tests__/tesco-identity-
disposition.test.ts — 40 tests PASS (every CONTINUE/STOP reason token, mixed
reasons, product-not-found, fail-closed default, disjoint sets, never-accept).
Lint 0 / tsc clean. Full PGlite batch regression plan (interspersed holds+accepts,
durability ordering, systemic-stop, circuit breaker, transport-stop, lost-ack
interruption, restart-no-bypass, never-accept) specified in the doc, to be ADDED
with the implementation PR. No collector/matching/schedule change until reviewed +
approved.


## Tesco collection ROOT-CAUSE — CORRECTED with uncapped SQL — 25 October 2026

Supersedes the earlier same-day entry, which was WRONG because queries hit the
PostgREST 1000-row cap and I reasoned from truncated data. All figures below are
from UNCAPPED .range()-paginated read-only queries. No live Tesco request, no
schedule, no deploy, no matching change.

CORRECTIONS to the prior entry:
- Pages are 1,909 total with 1,861 `ok` (NOT 961). Only 1 access_block ever, 30
  unsafe_redirect, 6 http_error, 5 network_error, 6 pending.
- Renewals DID run 12–13 Oct. tesco price_observations per day:
  1 Oct=22, 8 Oct=285, 9 Oct=56, 12 Oct=234, 13 Oct=54 (all distinct products).
  So 234+54 = 288 products renewed on 12–13 Oct (your figure, confirmed). The
  288 refreshed to ~19–20 Oct expiry, NOT 15 Oct.
- Work's network classification is UNKNOWN — do NOT call it non-datacenter.
  Evidence only shows the `workspace-supervised` gate succeeded (0 blocks / 2
  successes) while the `vercel-dub1-canary` datacenter gate blocked (2 blocks / 0
  successes) and the 25 Oct AWS probe got 403. That shows datacenter egress is
  blocked and Work's egress worked; it does NOT establish WHY.

ACTUAL FAILURE SEQUENCE (uncapped evidence):
- 14 supervised Tesco runs 12–13 Oct (all run_scope=manual, renewal): 10
  success/complete (24–25 unchanged each), 3 degraded stop=http_error
  (0af44937, e1b55a0c, 7478987b), 1 degraded stop=interrupted (0d7fca1f). Bounded
  25-product batches; the http_error/interrupted ones stopped a batch early so
  the operator re-ran — explaining why 288 (not the full ~341) renewed.
- LAST Tesco observation = 2026-10-13T15:23:53Z. ZERO Tesco runs started after
  13 Oct. Collection simply CEASED after that session.
- The `workspace-supervised` gate went into a normal 15-min cooldown to
  13 Oct 15:39:25 (post-http_error pause), 0 blocks total — it was NOT an access
  block. The gate was healthy and was simply never operated again.
- Therefore the 288 (and the un-renewed remainder) expired ~19–20 Oct because NO
  renewal session was run in the 16–19 Oct window. This is an OPERATIONAL-
  CONTINUITY failure of a HUMAN-OPERATED process (no durable schedule/alert to
  prompt the next session), NOT a new block and NOT a code fault.

RECONCILE (read-only; do NOT re-request unknowns):
- 6 pending (unknown-outcome) pages, never resolved:
  285859740 (29 Sep), 308853589 (30 Sep), 314109029 (8 Oct), 317854748 (9 Oct),
  Glenisk listing (10 Oct), 311944507 (12 Oct). Preserve as evidence; reconcile
  via `--reconcile RUN_UUID`, never mark success or retry.
- 1 stalled supervised run: tesco_supervised_expansion_a502af52 RUNNING since
  9 Oct with activeSupervisor=null (orphaned; its pending page is 317854748).
  Plus 4 ancient pepesto_tesco_eval runs stuck 'running' since 20–21 Aug
  (unrelated legacy evals). These need reconcile-only closure.

IDENTITY vs RETRIEVAL (uncapped, still the yield cap for EXPANSION growth):
retrieval overwhelmingly succeeds (1,861 ok); identity rejection is the main
reason a fetched product is not accepted — on ok pages: 853 "no full exact
canonical identity", 237 measureExactnessFailed, 236 measureConflict, 203
brandConflict, etc. Accepted trusted observations are the per-day counts above.
These are the safeguards working as designed; do NOT weaken them.

RECOVERY eligibility (CORRECTED — exact selectSupervisedCandidates held
predicate, uncapped; user-verified): 2,461 tesco mappings → 2,380
resolved+canonical → 1,510 proven → 745 HELD → **765 EXPANSION-ELIGIBLE**.
My earlier 1,506 was WRONG: it applied only the pending/24h part of `held` and
OMITTED clause 3 (historical failure / identity holds — any post-observation
page with outcome<>'ok' OR non-empty identity_results reasons for that product).
With observed_at NULL (all expired), coalesce(observed_at,'-infinity') makes
clause 3 evaluate every historical failed/identity-flagged page as a hold → 745.
Within the ORIGINAL 341 cohort: 325 eligible, 16 held (user-verified). DO NOT
remove or bypass holds. NOTE: `--reconcile RUN_UUID` only REPORTS run state; it
does NOT close/resolve pending requests — the 6 pending + orphaned run stay
preserved until an independently reviewed reconciliation procedure. Recovery is
supervised EXPANSION on the permitted (Work) egress, ordered by OVERLAP (fresh
Dunnes + SuperValu peers first) — commercial priority is three-retailer
comparisons, then broader Tesco coverage. The selector orders by overlap, NOT the
341 cohort (verified: first 25 eligible all have both peers; only 13 are
original-cohort). The 325 original-cohort-eligible are a tracked subset recovered
as they surface in overlap order, not special-cased. Full Work-session runbook
(command, eligibility, reconciliation, safety, stop conditions, verification) in
docs/tesco-recovery-plan.md.

FEASIBILITY: AWS-native autonomous collection remains NOT viable on current
datacenter egress (403). But the PRIMARY lesson is that the proven supervised
path STOPPED because the manual renewal cadence was not sustained — fixable with
DURABLE EXECUTION TRACKING + TIMELY EXPIRY ALERTS, independent of the egress
question. Tesco schedule stays DISABLED. Policy: no IP rotation/proxy/cooldown
weakening.

## AWS-native Tesco collection — FEASIBILITY ASSESSMENT (no build) — 25 October 2026

Assessment only; nothing built; Tesco schedule left DISABLED and
TESCO_VERCEL_WORKER_ENABLED=false (verified unchanged).

Runner (reviewed): entry scripts/tesco-supervised-collect.ts; core
src/lib/tesco-supervised-collection.ts; fetch/parse/identity/stop in
src/lib/tesco-direct-collection-core.ts. "Supervised" = human-in-the-loop at the
DATABASE TRANSPORT layer: the Node process holds NO DB credential and emits each
SQL query as JSONL on stdout; a human runs it via the authenticated Supabase SQL
connector and returns rows on stdin ("SQL bridge"). Transport to Tesco is a
single plain fetch (honest UA, manual redirects, 20s timeout) — NO ScrapingBee,
NO proxy, NO retries. Safeguards intact: exact SKU + title/brand/pack identity
(validateTescoCollectedIdentity + classifyTescoReplacement/Mapping), mapping-
snapshot re-assert under lock, egress lease on gate `workspace-supervised-
20260929` (must be enabled=false), 10s pacing, idempotent finalise via
finalize_store_scrape_product + scrape_product_receipts, checkpoint rows in
tesco_direct_collection_pages. Stop conditions: 401/403/Akamai challenge →
access_block (48h cooldown); 429 → rate_limited (15m/Retry-After); unsafe_redirect
/network_error stop the whole batch; one attempt only.

KEY NETWORK FINDING (access risk): ECS tasks run in PUBLIC subnets with
assignPublicIp=ENABLED and there is NO NAT gateway, so task egress uses a RANDOM
ephemeral AWS eu-west-1 public IP that changes every launch. The 2 Elastic IPs
(52.212.195.119 / 54.155.23.179) are bound to the ALB, NOT task egress. Random
AWS datacenter IPs are the exact profile Akamai (Tesco's protection) tends to
block — so Tesco access from AWS is UNLIKELY by default and must NOT be assumed
from the ChatGPT-Work success (different network identity). Private subnets have
no egress at all (no NAT).

SQL-BRIDGE replacement: autonomy needs a real ExecuteSql adapter. The Supabase
SERVICE key is an HTTP/PostgREST key, NOT a Postgres password — but the runner's
DO-blocks are raw PL/pgSQL, so they need a direct least-privileged Postgres
connection (TLS) to the pooler, scoped to the specific tables/RPCs. This can
preserve collection/finalisation semantics byte-for-byte (same SQL), only
swapping the transport from stdin/stdout to a pg client.

ELIGIBILITY (read-only, no mutation): current trusted Tesco prices in
latest_prices = 0 (the 341 fully expired). RENEWAL mode selects nothing (needs a
latest_prices row). EXPANSION mode (observed_at IS NULL + proven + resolved +
canonical URL + not held) is the ONLY path to the expired cohort. Sampled reads
(capped by PostgREST 1000-row limit) confirmed the direction: proven+canonical
tesco mappings with no fresh price are expansion-eligible; exact count pending an
uncapped query. `held` (failed attempt/identity flag in last 24h) may trim a few.

SMALLEST AWS FOOTPRINT (if later approved): one manually-triggered ECS run-task
on the EXISTING cluster (reuse the `scheduled` task def pattern, command =
node --conditions=react-server --import tsx scripts/…), bounded --limit, no new
service, no scheduler — plus the ExecuteSql pg-adapter and a fixed-egress
decision. Cost ≈ a few cents per bounded run (Fargate 0.5vCPU/1GB for minutes);
the real cost driver is the egress arrangement, not compute.

CONNECTIVITY TEST RESULT (25 Oct, user-authorised, ONE request): Tesco BLOCKED
the AWS egress. Single GET via the existing fetchTescoCollectedPage transport to
https://www.tesco.ie/shop/en-IE/products/306943101 (a previously-'ok' product)
from a bounded one-off ECS task in a public subnet → **HTTP 403, outcome
access_block**, 311 ms, body 411 bytes (challenge page, not product JSON),
expected product NOT accessible, same-origin (no redirect). Egress was a random
AWS eu-west-1 public IP (observed 18.201.73.122 on an earlier aborted attempt;
the model is confirmed). The transport's stop rule fired correctly: one attempt,
no retry/route-switch. NO Supabase writes (probe never touches the DB; task had
no DB secrets). The probe lives at src/workers/tesco-connectivity-probe.ts;
throwaway probe task defs deregistered. (Two earlier task attempts failed to
start / ERR_MODULE_NOT_FOUND and made ZERO Tesco requests — the 403 was the first
and only request.)

CONCLUSION: the existing supervised collector CANNOT run from the current AWS
egress — Akamai blocks AWS datacenter IPs (the risk we flagged, now evidenced).
Per policy: do NOT rotate IPs/proxies/shorten cooldowns. Realistic authorised
options to report (NOT implemented): (a) a fixed-egress NAT+EIP — but a single
AWS EIP is still an AWS datacenter IP and likely still blocked, so low-confidence;
(b) a licensed/approved product-data source or an explicitly sanctioned
fixed-egress arrangement with a non-datacenter reputation. The supervised runner
itself remains viable wherever egress is permitted; the blocker is purely
network identity. Tesco schedule stays DISABLED.

## Retailer canaries — SuperValu LIVE, Dunnes blocked on matching — 25 October 2026

Added per-retailer control: new `enabled_retailers` var gates the per-store
*_WORKER_ENABLED flags (ecs.tf + workers.tf), so retailers activate one at a time.
Set enable_retailer_workers_on_aws=true (DISABLE_RETAILER_COLLECTION=false) and
enabled_retailers=["dunnes","supervalu"] (Tesco stays OFF).

Canary results (manual limit=3 triggers via the website route + CRON_SECRET; SQS
→ consumer rev 3 pipeline):
- **SuperValu: PASS** — run vercel_supervalu_20261025084738: 3 fetched, 3
  extracted, 0 failed, 100% coverage, inserted 0 / unchanged 3 (prices current;
  correctly no redundant writes). direct_product_page transport, no Akamai block.
  → supervalu-scrape-trigger schedule ENABLED.
- **Dunnes: pipeline OK, collection FAILS** — run vercel_dunnes_20261025083752: 3
  attempted, 8 fetched, 0 extracted, 3 failed (no_confident_match at the matching
  stage, is_retryable=false), 0 inserted. The AWS pipeline works end-to-end and
  reached Dunnes (real candidates+prices returned), but exact-identity matching
  rejected all 3 — e.g. Carrots: stored SKU 100807381 present in candidates yet
  rejected. This is a PRE-EXISTING matching-strictness issue (same code ran on
  Vercel), NOT an AWS/access/migration regression, and crucially 0 bad writes —
  trusted-price protection held. → dunnes-scrape-trigger schedule stays DISABLED
  pending a matching-confidence fix (separate work).

Schedules now: 7 low-risk + supervalu-scrape-trigger ENABLED; dunnes-scrape-
trigger + pepesto-tesco-retrieve DISABLED. Consumer 1/1 on rev 3 (collection
env). No duplicate execution (Vercel crons off; Vercel queue triggers removed in
merged vercel.json).

NEXT: (a) investigate/fix Dunnes matching confidence, then canary + enable its
schedule; (b) Tesco recovery (pepesto-tesco-retrieve) handled separately with
egress lease/cooldown/Akamai stop conditions. Work continues on branch
ops/post-merge-retailers (PR to follow; infra changes already applied to prod).

## PR #265 MERGED to main — single source of truth — 25 October 2026

PR #265 (AWS migration) merged to `main` via SQUASH (merge commits disallowed on
the repo) as commit `0cce714`. `main` is now the single source of truth.

- Conflict resolved: `.github/workflows/aws-ecr-deploy-image.yml` (add/add vs
  #266) — kept the branch's SEO build args (BUILD_APP_ENV / BUILD_SUPABASE_READ_
  ONLY); resolution is a strict superset of main's version.
- CI on the PR and on main post-merge: PASS (lint 0 errors, 593 tests,
  typechecks, behavioural gate, Next build, Docker validation, Terraform
  validate). Local build reproduced CI with CI=true (the earlier local build
  "failure" was only the missing CI=true escape hatch hitting the placeholder
  Supabase URL — not a regression).
- Vercel production deploy for the merge commit: SUCCESS. Merged vercel.json has
  NO crons and NO queue triggers (verified), so the Vercel redeploy introduces no
  background execution; queue routes kept as plain functions for rollback.
- AWS post-merge: website 2/2 healthy (rollout complete), SQS consumer 1/1, live
  www 200 / apex 301. `tofu plan` = No changes (zero drift; deployed infra matches
  merged Terraform).

NEXT: retailer canaries — Dunnes + SuperValu first, then Tesco recovery.

## Vercel Cron/Queue migration — crons + queues on AWS; retailers next — 24 October 2026

SCHEDULED JOBS: Vercel crons disabled (dashboard). 7 low-risk AWS schedules
ENABLED (weekly-digest, check-alerts, agent-tasks, price-watchdog +thursday,
product-embeddings, scrape-watchdog) via new `enabled_schedules` allowlist; the 3
retailer-scrape triggers (dunnes/supervalu/pepesto-tesco-retrieve) stay DISABLED.
Canary: ran scrape-watchdog via the scheduled task → exit 0, route HTTP 200
against prod Supabase (reported real coverage; emailSent:false). Single execution
path confirmed.

QUEUES: SQS consumer running (worker_desired_count=1), long-polling all 6 topics;
website flipped to QUEUE_BACKEND=sqs (web 2/2 healthy, rollout complete). Safe
because the only live queue producer (agent-events → agent-product-changes) fires
during scrapes, which are paused; retailer scrape-trigger producers are disabled.
No in-flight messages (reconciliation). vercel.json queue triggers + crons REMOVED
on the branch (commit ccf0aef) so a Vercel redeploy can't resume duplicates —
NEEDS the user to deploy to main (queue routes kept as plain functions for
rollback).

tfvars now: enable_workers=true, worker_desired_count=1,
website_queue_backend=sqs, worker_schedule_state=DISABLED,
enabled_schedules=[7 low-risk], enable_retailer_workers_on_aws=false,
image_tag(+worker)=df9f0c1-prod.

NEXT — RETAILERS (staged canary): enable_retailer_workers_on_aws=true flips
DISABLE_RETAILER_COLLECTION→false and the per-store *_WORKER_ENABLED flags.
Then enable the retailer schedules one retailer at a time via enabled_schedules
(dunnes + supervalu first via canary, Tesco separately), preserving exact-identity
validation, trusted-price protection, request limits, egress lease/cooldown,
Akamai stop conditions. Watch ScrapingBee cost + coverage. Vercel retained for
rollback; project NOT paused.

WORKER FIX HISTORY (this session): (1) entrypoint execs worker command; (2)
website_queue_backend decouples producer routing from provisioning (+ website
task-role SQS SendMessage, AWS_REGION env); (3) workers run with
--conditions=react-server to neutralise server-only. Prod image df9f0c1-prod.
Full details in the prior dated entry below.

## Vercel Cron/Queue migration — PREPARATION done, worker bugs fixed — 24 October 2026

Two activation blockers (user-identified) FIXED + proven:
1. Worker startup: docker-entrypoint.sh ignored the ECS `command` override (always
   ran web+Eve). Now execs the command when given; web task (no command) still
   runs web+Eve. Required a prod image rebuild → `df9f0c1-prod`.
2. Queue routing coupling: website QUEUE_BACKEND was tied to enable_workers. New
   `website_queue_backend` var (default "vercel") decouples producer routing from
   provisioning. Added website task-role SQS SendMessage policy (gated on worker
   stack) + AWS_REGION env.
3. (Found during canary) workers import route modules pulling in `server-only`,
   which throws outside Next. Fixed by running worker tasks with
   `--conditions=react-server` (resolves server-only to its no-op). CANARY PROVED
   the consumer starts and long-polls all 6 topics (region eu-west-1), healthy.

PREPARATION STAGE APPLIED (inert): 6 SQS topic queues + 6 DLQs, SQS consumer
service (desired=0), 10 EventBridge schedules (ALL DISABLED), worker/scheduler
IAM. Website on `df9f0c1-prod`, 2/2 healthy, STILL routing QUEUE_BACKEND=vercel,
DISABLE_RETAILER_COLLECTION=true. Vercel continues ALL processing. Nothing runs
twice.

Reconciliation (read-only SELECT on prod Supabase): NO in-flight work to drain —
`recent_runs_24h` empty; the 6 `scrape_runs` stuck 'running' are stale (newest
Oct 9, rest August = orphaned). Tesco egress pool: no lease held (leased_until
null on both keys); canary key in expired cooldown, other disabled. Safe window.

tfvars now: enable_workers=true, worker_desired_count=0,
worker_schedule_state=DISABLED, website_queue_backend=vercel,
enable_retailer_workers_on_aws=false, image_tag(+worker)=df9f0c1-prod.

NEXT (scheduled-jobs stage): user disables Vercel crons (Project Settings → Cron
Jobs); then enable low-risk AWS schedules (weekly-digest, check-alerts,
agent-tasks, price-watchdog(+thursday), product-embeddings, scrape-watchdog),
keeping the 3 retailer-scrape triggers DISABLED until per-retailer canary. Then
queue stage (consumer up + website_queue_backend=sqs + remove 6 Vercel queue
triggers), then retailers (Dunnes/SuperValu canary, Tesco separate).
Vercel retained for rollback; project NOT paused/deleted.

---

## MIGRATION COMPLETE: www + apex serving from AWS — 24 October 2026

Both production domains now serve from AWS ECS Fargate (via ALB; apex via Global
Accelerator). Customer-facing migration DONE.

- apex `supermarket.ie` A → GA IPs 166.117.14.195 + 166.117.236.132 (propagated
  to all tested resolvers incl. Google). Over real DNS: apex → 301 →
  https://www.supermarket.ie (full chain → 200), apex cert = Amazon ACM
  `supermarket.ie` (verify=0). GA endpoint HEALTHY.
- www `www.supermarket.ie` → ALB, 200, Let's Encrypt cert (verify=0),
  indexable, canonical=www.
- ECS 2/2 healthy; CloudWatch clean (no errors, no read-only write-blocks).

apex CAA: NONE present (user added the two A records; CAA records not added).
NOT a blocker — CAA governs issuance, not serving; both certs already issued; apex
was always unrestricted (no regression). The recommended CAA (`amazonaws.com` +
`letsencrypt.org`) is OPTIONAL hardening for future renewals; add when convenient.

Vercel remains live during residual propagation (apex/www caches expiring on the
old long TTLs) and as rollback. Rollback: www CNAME →
e2ae0df6f59fc39f.vercel-dns-017.com; apex A → 216.198.79.1.

REMAINING FOR FULL VERCEL INDEPENDENCE (next priorities, NOT done):
1. Vercel Cron — scheduled jobs (retailer collection triggers, price
   finalisation, scheduled notifications). AWS replacement in-branch (EventBridge
   Scheduler → ECS tasks) provisioned DISABLED. Enable AWS + disable Vercel in ONE
   controlled change to avoid duplicate execution.
2. Vercel Queues — background job delivery. AWS replacement (SQS + consumer
   service) provisioned with desired_count=0, enable_workers=false,
   QUEUE_BACKEND=vercel. Flip to SQS consumer + QUEUE_BACKEND=sqs in the same
   controlled change.
3. Replace imported Let's Encrypt www cert with ACM-managed (DNS-validated now
   that www is on the ALB) for auto-renew; LE expires 2027-01-20.
Until (1)+(2) are done, Vercel still runs the background/scheduled workload, so
the platform is NOT yet fully independent. PR #265 still DRAFT (do not merge as
part of this).

---

## www CUT OVER to AWS (apex pending) — 24 October 2026

The user updated the `www.supermarket.ie` CNAME at Register365 →
`smie-prod-alb-48303444.eu-west-1.elb.amazonaws.com`. Propagating on existing TTL
(~9.4h): authoritative Register365 NS + Cloudflare + Quad9 already return the
ALB; Google still cached on Vercel (coexistence window, expected + safe). VERIFIED
on AWS via a switched resolver: TLS = Let's Encrypt www cert (valid); /,/shop,
/terms,/api/products,/eve/v1/info = 200; NO x-robots-tag (indexable); canonical=
www; revalidate 401 / subscribe(no-email) 400 (write path live, no data created);
Eve /v1/info full payload; products API real data. ECS 2/2 healthy, rollout
COMPLETED, both targets healthy, ALB receiving real requests, CloudWatch clean
(no errors, no PreviewReadOnly write-blocks). Vercel still live for the resolvers
that haven't switched + as rollback.

NEXT: once www has largely propagated + stayed healthy, user adds apex records
(CAA amazonaws.com + letsencrypt.org; A → 166.117.14.195 + 166.117.236.132). Then
post-cutover: swap LE www cert for ACM-managed (auto-renew; LE expires
2027-01-20), migrate Vercel Cron + Queues.

Rollback (still available): www CNAME → e2ae0df6f59fc39f.vercel-dns-017.com.

---

## Cutover READY: GA live, production posture live, SEO blocker fixed — 24 October 2026

All pre-DNS readiness checks PASS. (www now cut over — see entry above.)

Global Accelerator (PROVISIONED, DEPLOYED, approved ~$25/mo): accelerator
`d829ace4...`, status DEPLOYED, ALB endpoint HEALTHY. **Two static anycast IPs
for the apex A records: 166.117.14.195 and 166.117.236.132.** DNS name
`ac36b1ed45ae4a060.awsglobalaccelerator.com`. 443 + 80 listeners; endpoint
groups in eu-west-1 fronting the ALB with client-IP preservation. Fix applied:
endpoint groups needed explicit `endpoint_group_region=eu-west-1` (they first
failed because the us-west-2 control-plane provider alias made them default to
us-west-2). Verified via BOTH GA IPs: apex 301→https://www.supermarket.ie (TLS
ok), www 200 (TLS ok), http:80→301.

Production posture (LIVE on task def rev 9, image dcacbae-prod, 2/2 healthy):
APP_ENV=production, SUPABASE_READ_ONLY=false (writes on), DISABLE_OUTBOUND_EMAIL
=false (transactional email on), NEXT_PUBLIC_SITE_URL=https://www.supermarket.ie.
Secrets wired: MAGIC_LINK_SECRET (cross-validates Vercel sessions),
RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY. Retailer collection + workers + queue
consumers stay DISABLED (DISABLE_RETAILER_COLLECTION=true, enable_workers=false,
QUEUE_BACKEND=vercel) — Vercel keeps them.

CRITICAL SEO BLOCKER FOUND + FIXED (caught during step-3 verification): next.
config.ts computes the X-Robots-Tag `noindex` header from isNoIndexEnv() at BUILD
time, not runtime. Image 14d960e-prod was built with APP_ENV=preview, so it baked
`noindex,nofollow` permanently on all responses — would have deindexed the site
at launch. Fix: Dockerfile + aws-ecr-deploy-image.yml now build the prod image
with BUILD_APP_ENV=production (and BUILD_SUPABASE_READ_ONLY=true so the prerender
stays SELECT-only). Rebuilt as dcacbae-prod and deployed. VERIFIED: no
x-robots-tag header, robots.txt now `Allow: /` with sitemap. Commit dcacbae.

Verification summary (via GA IP, no DNS change): routes /,/shop,/terms,
/api/products,/eve/v1/info = 200; /api/agent/briefing + /api/revalidate(no
secret) = 401; /api/subscribe (no email) = 400 "Email is required" (write path
live, no row written); canonical=www; HTTPS valid on www + apex; CloudWatch clean
(no errors in last 15m). HA: 2 tasks across 2 AZs, autoscaling 2–6.

NEXT = user performs the DNS cutover at Register365 (exact records below /in
docs/aws-cutover-runbook.md), www first then apex. TTLs NOT lowered (account
can't) → coexistence window on existing TTLs, safe via shared Supabase + magic-
link secret. Vercel retained for rollback. Post-cutover: replace imported LE www
cert with ACM-managed (auto-renew; LE expires 2027-01-20); then migrate Vercel
Cron + Queues.

FINAL CUTOVER DNS (Register365; TTLs unchanged):
  1. www.supermarket.ie  CNAME -> smie-prod-alb-48303444.eu-west-1.elb.amazonaws.com
     (replaces e2ae0df6f59fc39f.vercel-dns-017.com)
  2. after www healthy — apex:
     supermarket.ie  CAA  0 issue "amazonaws.com"
     supermarket.ie  CAA  0 issue "letsencrypt.org"
     supermarket.ie  A    166.117.14.195    (replaces 216.198.79.1)
     supermarket.ie  A    166.117.236.132
Rollback: www CNAME -> vercel-dns target; apex A -> 216.198.79.1.

## TTL-lowering dropped; www-first coexistence cutover — 22 October 2026

Register365 account cannot change DNS TTLs, so TTL lowering is REMOVED as a
prerequisite. Cutover proceeds on EXISTING TTLs (apex A 86400 / www CNAME
~34000). This creates a COEXISTENCE WINDOW during propagation (up to ~24h apex /
~9.4h www) where some visitors hit Vercel and others hit AWS — SAFE because both
share one backend + compatible auth:
  - Same production Supabase (identical NEXT_PUBLIC_SUPABASE_URL +
    SUPABASE_SERVICE_ROLE_KEY) → same data for reads/writes.
  - Same MAGIC_LINK_SECRET + VENDOR_MAGIC_LINK_SECRET (byte-exact Vercel→AWS) →
    sessions/magic links issued by either environment validate on the other.
  (Re-confirmed the AWS secrets exist/match; values not echoed.)
A single user action is served by a single host, so no double-send of
transactional email in the window. Scheduled email stays Vercel-only (AWS has no
cron/queue trigger).

Plan now: www FIRST (CNAME → ALB), verify + monitor AWS through propagation, then
apex (A → Global Accelerator static IPs) once www is confirmed healthy. Vercel
stays fully live throughout as rollback. Rollback is bounded by the existing TTLs
(up to ~9.4h/~24h to fully drain) — accepted, since Vercel is never taken down.
Runbook (docs/aws-cutover-runbook.md) sections 5–6 rewritten accordingly; the
pre-cutover production-posture config + GA provisioning/verification still happen
BEFORE any DNS change. GA still gated on explicit cost approval; no production DNS
until the user approves the final records.

## Cutover sequence corrected + Global Accelerator prepared — 22 October 2026

Two correctness bugs in the cutover plan were found (by the user) and fixed:

1. **Sequence bug** — the earlier runbook moved `www` DNS to AWS BEFORE setting
   `test_mode=false`, which would have sent live customers to a READ-ONLY app
   (failed sign-ins/registrations). Corrected order: configure full production
   posture on AWS and verify via `--resolve` FIRST, then provision/verify Global
   Accelerator, lower TTLs, and only then flip DNS.
2. **Email-disabled-in-production bug** — `DISABLE_OUTBOUND_EMAIL` is a GLOBAL
   switch in `src/lib/resend.ts`: when true it short-circuits ALL Resend sends,
   including TRANSACTIONAL magic-link + registration-verification email, not just
   scheduled notifications. The Terraform set `email_blocked = test_mode ||
   !enable_outbound_email_on_aws`, so launching with
   `enable_outbound_email_on_aws=false` would silently suppress all auth email.
   Fix: at cutover set `enable_outbound_email_on_aws=true`. No duplicate-email
   risk — transactional mail is triggered by whichever host serves the user (and
   Vercel stops serving www post-cutover); scheduled mail is never *triggered* on
   AWS (no cron runner, consumers off), independent of this flag. Tightened the
   variable's doc comment in variables.tf to state this.

Apex mechanism chosen: **Option A — AWS Global Accelerator** (keeps Register365
as DNS host; no nameserver migration). Terraform prepared in
`infra/terraform/global-accelerator.tf`: accelerator + 443/80 listeners + two
endpoint groups forwarding to the existing ALB, with client-IP preservation.
Gated behind `enable_global_accelerator` (DEFAULT FALSE). Uses an aliased
us-west-2 provider (GA control-plane region). `tofu validate` passes; a plan with
the toggle on shows **5 to add, 0 change, 0 destroy**. NOT APPLIED — awaiting the
user's explicit cost approval (BILLABLE).

Global Accelerator cost (billable while provisioned): fixed $0.025/hr (~$18/mo) +
2 static IPv4 at $0.005/IP/hr (~$7.30/mo) + small DT-Premium per-GB ≈ **~$25/mo
fixed** + a few $ data. Outputs `global_accelerator_static_ips` (the two apex A
targets) and `global_accelerator_dns_name`.

Production-posture plan verified as a diff (not applied): `test_mode=false` →
`APP_ENV=production` + `SUPABASE_READ_ONLY=false`; `enable_outbound_email_on_aws
=true` → `DISABLE_OUTBOUND_EMAIL=false`; `public_base_url` → www. Workers /
retailer collection / scheduled jobs stay disabled (`enable_workers=false`,
`enable_retailer_workers_on_aws=false`, consumer desired_count 0, QUEUE_BACKEND=
vercel) so Vercel keeps handling them with no duplicate execution.

Post-cutover follow-ups (documented in docs/aws-cutover-runbook.md): (a) replace
the imported Let's Encrypt www cert with an ACM-managed cert (DNS-validated once
www is on the ALB) so renewal is automatic — LE cert expires 2027-01-20; (b)
migrate Vercel Cron + Queues to the in-branch EventBridge/SQS stack (enable AWS
workers AND disable Vercel workers in one controlled change) — platform is NOT
fully independent until these are removed.

## www TLS solved via Let's Encrypt DNS-01 + apex→www edge redirect — 22 October 2026

The `www` TLS blocker is SOLVED without any broken-HTTPS window. ACM could not
issue for `www` (the Vercel CNAME's CAA excludes Amazon), but that same CAA
authorises `letsencrypt.org`, so a Let's Encrypt cert was obtained via DNS-01 and
imported into ACM — all before touching `www` DNS.

What was done (no production DNS changed; Vercel still authoritative/live):
- **Let's Encrypt cert for `www.supermarket.ie`** via certbot manual DNS-01.
  Validation record `_acme-challenge.www.supermarket.ie TXT =
  2R2IJHP7P3mGmOR3qghHii29b96J6XvwXwyZZMbr68o` was added by the user at
  Register365; confirmed on Google/Cloudflare/Quad9/authoritative NS; cert
  ISSUED (ECDSA P-256, expires 2027-01-20). Finding: `_acme-challenge.www` is NOT
  shadowed by the `www` CNAME (it resolves in the Register365 zone), so DNS-01
  works directly with no alias/delegation.
- **Imported into ACM eu-west-1** as `a6079f96-c4a9-4a2c-aaf3-3fa602003258`
  (type IMPORTED, Let's Encrypt, ISSUED). Key material kept in a chmod-700 temp
  dir OUTSIDE Dropbox/Git/logs; never committed.
- **Attached to the ALB HTTPS listener via SNI** (added to
  `additional_certificate_arns`). Listener now serves THREE certs: `cca36c0b`
  aws-preview (default), `a2cf0cf8` apex (ACM), `a6079f96` www (Let's Encrypt).
  VERIFIED against both ALB nodes via `curl --resolve` (no prod DNS change):
  `www.supermarket.ie` HTTP/2 200, `ssl_verify_result=0`, canonical=www. The
  ECDSA cert took ~45s to propagate across ALB nodes after attach, then solid on
  TLS 1.2 + 1.3.
- **apex→www 301 at the ALB edge** (replaces Vercel's apex redirect, removing
  that dependency): new `aws_lb_listener_rule.apex_redirect` (vars
  `apex_redirect_host="supermarket.ie"`, `canonical_www_host="www.supermarket.ie"`),
  priority 10, matches Host `supermarket.ie` only (inert until apex DNS points at
  the ALB). VERIFIED: `supermarket.ie/shop?x=1` → 301
  `https://www.supermarket.ie/shop?x=1` (path+query preserved); www + aws-preview
  unaffected. (ALB echoes a cosmetic `:443` in Location — standards-compliant,
  browsers normalise it.)

App readiness (image `14d960e-prod`, 2/2 tasks healthy, read-only posture):
`/`, `/terms`, `/shop`, `/api/products`, `/eve/v1/info` all 200;
`/api/agent/briefing` + `/api/revalidate` (no secret) 401. Write-capable features
(auth, registration, transactional email, Eve writes) were proven in the 21 Oct
controlled read-write test; secrets (Resend/Anthropic/Supabase service-role/
magic-link) are loaded. At cutover, `test_mode=false` enables writes + email while
retailer collection + workers + scheduled jobs stay disabled (no duplicate
execution with Vercel).

APEX CUTOVER CONSTRAINT (must choose a mechanism): Register365 uses plain DNS and
the apex is currently a plain **A record** to Vercel's stable IP `216.198.79.1`.
An AWS ALB has **no static IP** (its IPs rotate), so the apex A record must NOT
point at raw ALB IPs. No Route 53 zone and no Global Accelerator exist yet.
Supported options (pick one before apex cutover):
  (A) **AWS Global Accelerator** in front of the ALB → 2 static anycast IPs →
      apex A → those IPs. ~\$18/mo + data. Keeps Register365 as DNS host.
  (B) **Migrate the zone to Route 53** → apex ALIAS → ALB (free, auto-tracks ALB
      IPs). Changes authoritative nameservers (larger change, slower rollback).
  (C) **Leave apex on Vercel** (apex→www 301 continues there) and move only `www`
      to AWS now; handle apex later. Smallest blast radius.
The `www` cutover does NOT depend on this — `www` is a CNAME and can move to the
ALB immediately with valid TLS already staged.

CURRENT PRODUCTION DNS (rollback baseline, captured 22 Oct):
  apex `supermarket.ie`  A      216.198.79.1            TTL 86400 (24h — LOWER FIRST)
  `www.supermarket.ie`   CNAME  e2ae0df6f59fc39f.vercel-dns-017.com  TTL ~34000
  apex CAA: none (unrestricted). ALB: smie-prod-alb-48303444.eu-west-1.elb.amazonaws.com
See docs/aws-cutover-runbook.md for the exact cutover + rollback steps.

## AWS production image + apex cert staged; cutover-ready — 21 October 2026

Status: the AWS ECS Fargate environment is cutover-ready for the **apex**
(`supermarket.ie`) with zero TLS gap; `www.supermarket.ie` must wait for a
Vercel-exit window (CAA, below). Service is back to READ-ONLY posture. Vercel
remains live and authoritative for `www`/apex until the user flips DNS.

Production hostname image: `14d960e-prod` — built via GitHub Actions
(`image_mode=prod`, `NEXT_PUBLIC_*`/base URL baked to `https://www.supermarket.ie`),
pushed to ECR `smie-prod`, and deployed to the HA service (2 tasks). Verified on
the ALB: `/` 200, canonical = `https://www.supermarket.ie`, and `X-Robots-Tag:
noindex` on non-canonical hosts (aws-preview / raw ALB) per the SEO guard — only
www/apex will be indexable once they serve from AWS.

Apex TLS staged ahead of cutover (zero-gap): apex-only cert
`a2cf0cf8-54f4-42ec-9d3c-bdb8c898a5fa` (`supermarket.ie`) is ISSUED and attached
to the HTTPS listener via **SNI** (new `additional_certificate_arns` var +
`aws_lb_listener_certificate.extra`). The listener now serves valid TLS for BOTH
`aws-preview.supermarket.ie` (default, `cca36c0b`) and `supermarket.ie` (SNI).
Verified via the ALB: apex `https` 200, `ssl_verify_result=0`; aws-preview still
200. So the instant the apex A/ALIAS resolves to the ALB, valid TLS serves — no
certificate gap. (The earlier www+apex cert `cebaa35e` FAILED again on the `www`
CAA; apex-only is the cutover vehicle.)

READ-ONLY revert (done): after the controlled read-write test the service was
returned to `test_mode=true`. Task definition **revision 7** now has
`APP_ENV=preview` and `SUPABASE_READ_ONLY=true`; rolling deploy COMPLETED, 2/2
tasks HEALTHY, single deployment. The environment is read-only against the
production Supabase again. (`test_mode` is runtime-only — it sets APP_ENV +
SUPABASE_READ_ONLY env, not baked into the image.) Workers, retailer collection,
and outbound email remain DISABLED.

Cutover plan (apex-first; user drives DNS, agent drives AWS cert/listener):
1. User lowers www/apex DNS TTL (~60s) ~24h ahead; confirms the apex rollback
   target (current apex record at Register365) before the window.
2. At the window: add apex CAA `supermarket.ie. CAA 0 issue "amazonaws.com"` and
   `0 issue "letsencrypt.org"`; repoint apex `supermarket.ie` → ALB (zero TLS gap
   via the staged `a2cf0cf8` SNI cert).
3. Repoint `www.supermarket.ie` → ALB (leaves Vercel). Now re-request the `www`
   ACM cert (it will validate — `www` no longer governed by Vercel's CAA), poll
   ISSUED, add it to the listener via `additional_certificate_arns`, apply.
4. Verify www/apex TLS + real journeys; watch ECS health + CloudWatch; keep
   Vercel targets noted for instant rollback.
Do NOT merge PR #265, enable workers, or enable email/collection as part of this.

Open items for the user: (a) lower www/apex TTL + confirm apex rollback target;
(b) decide the 2 identifiable `agent_events` test rows (leave / delete via
Supabase SQL / authorise a scoped service-role delete — held per rule 7 as a
direct production write); (c) choose the cutover window.

## AWS read-write verification + CAA finding — 21 October 2026

Image `b5e538c` (adds SEO fix: any non-canonical host, incl. aws-preview and the
raw ALB, is now `noindex` even in production posture; only www/apex are
indexable). Built via GitHub Actions and deployed to the HA service (2 tasks).

TEST-MODE verification (`test_mode=true`): `/` 200, `X-Robots-Tag noindex`,
`robots.txt Disallow: /`, canonical=aws-preview, security headers present,
`/api/products` 200, `/api/agent/briefing` 401 (clean auth gate), Eve
`/eve/v1/info` 200.

CONTROLLED READ-WRITE test (`test_mode=false`, APP_ENV=production,
SUPABASE_READ_ONLY=false; retailer collection + outbound email + workers stayed
DISABLED; QUEUE_BACKEND=vercel): against production Supabase via the ALB —
- `POST /api/subscribe` (test email `aws-migration-test+20261021093932@supermarket.ie`)
  -> 200 `{success, verification_required}`. Email suppressed by the guard (no
  real send). Wrote an `agent_events` row (`verification_email_sent`). No
  subscriber row created (verification link not followed), so no customer record.
- `POST /api/contact` (name "AWS Migration Test", msg marked safe-to-delete)
  -> 200. Email suppressed. Wrote an `agent_events` row.
- `POST /api/revalidate` with no secret -> 401 (REVALIDATE_SECRET loaded, route live).
- noindex remained ON in production posture (SEO fix verified); retailer worker
  route still 503 blocked; catalogue `/shop` 200.
After testing, returned the service to `test_mode=true` (read-only) — confirmed
APP_ENV=preview, SUPABASE_READ_ONLY=true, rollout COMPLETED, 2 tasks.

TEST RECORDS CREATED (await cleanup decision — app is read-only so cannot self-
delete; deletion is a direct production write held per authorisation rule 7):
  * `agent_events` row from subscribe: event_type `verification_email_sent`,
    session_id = the sign_in session, metadata source `sign_in`. (~1 row)
  * `agent_events` row from contact: identifiable test name/email/message.
No customers, trusted prices, mappings, or retailer data touched.

CAA finding (production cert CAA_ERROR): apex `supermarket.ie` has NO CAA
(unrestricted — Amazon may issue; apex SAN validated). `www.supermarket.ie` is a
CNAME to Vercel `e2ae0df6f59fc39f.vercel-dns-017.com`, whose CAA authorises only
globalsign/sectigo/letsencrypt/pki.goog — NOT Amazon. Per RFC 8659 the CNAME
target's CAA governs `www`, and that zone is Vercel-controlled, so NO record in
the Register365 zone can authorise Amazon for `www` while `www` remains a CNAME
to Vercel. The `www` cert can only issue once `www` is repointed off Vercel (at
cutover). At cutover, add at the apex (preserving Let's Encrypt):
  `supermarket.ie. CAA 0 issue "amazonaws.com"`
  `supermarket.ie. CAA 0 issue "letsencrypt.org"`
Production cert `cebaa35e` (www+apex) is requested and waiting; apex validates,
www blocked until the above. (Earlier `amazon.com` guidance corrected to the
ACM-correct `amazonaws.com`.)

## AWS preview operational (website + Eve agent) — 19 October 2026

Branch `infra/aws-migration` (PR #265, still DRAFT — not merged). The website and
Eve agent now run on AWS ECS Fargate in account `Supermarket-Prod` (611622961299),
eu-west-1, reading the EXISTING production Supabase. This is a pre-cutover TEST
deployment; no production DNS, Supabase data, or Vercel config was changed, and
all AWS background workers/retailer collection/email remain disabled.

Verified live via the ALB (Host `aws-preview.supermarket.ie`, valid HTTPS/TLS1.3):
`/` 200, `/terms` 200, `/eve/v1/info` 200 (agent proxied), `/api/products` 200
returning 127 real products from production Supabase; HTTP 80 → 301 HTTPS;
`X-Robots-Tag: noindex,nofollow` and `robots.txt Disallow: /` (preview not
indexable). ECS task RUNNING+HEALTHY, ALB target healthy. No email/worker/write
activity in logs.

Posture (ECS task env): `APP_ENV=preview`, `SUPABASE_READ_ONLY=true` (writes
blocked in-app for website AND Eve agent clients), `DISABLE_RETAILER_COLLECTION
=true`, `DISABLE_OUTBOUND_EMAIL=true`, all `*_WORKER_ENABLED=false`,
`QUEUE_BACKEND=vercel`. Image `cd9963c` (built+pushed by GitHub Actions →
ECR `smie-prod` via OIDC role scoped to the protected `aws-prod` environment).

HA upgrade (cutover-readiness, 19 Oct): service now runs **2 tasks across
eu-west-1a + eu-west-1b**, both HEALTHY, both ALB targets healthy. Target-tracking
**autoscaling** enabled (min 2, max 6; CPU 60% + ALB 800 req/task). Zero-downtime
rolling deploys: `deployment_minimum_healthy_percent=50`, max 200%, **deployment
circuit breaker with auto-rollback**. Target-group `deregistration_delay=30s`.
Idle utilisation measured: CPU ~1%, memory ~24% of 2 GB — 1 vCPU/2 GB is
comfortably sized. Second task adds ~$35/mo (running total ~$93–101/mo).

Cutover readiness — REMAINING before production go-live (Plan A):
1. Fix `www`/apex CAA so Amazon can issue (add `amazon.com` to the CAA, or remove
   the Vercel-flattened CAA on the www CNAME target). Production DNS change.
2. Re-request + validate the `www`+apex ACM cert; repoint the HTTPS listener to it.
3. Rebuild image with `NEXT_PUBLIC_SITE_URL/BASE_URL=https://www.supermarket.ie`,
   set `test_mode=false` (read-write production), apply.
4. Verify REAL journeys in production posture on the test host (sign-in with an
   existing session, build a shop, an agent conversation, a write).
5. Lower www/apex DNS TTL ~24h ahead; then cut www/apex → ALB (approval-gated);
   keep Vercel targets noted for instant rollback.

Infrastructure (Terraform, S3 backend `smie-prod-tfstate-611622961299`):
ECR, VPC (10.42.0.0/16, 2 public + 2 private subnets), ALB
`smie-prod-alb-48303444.eu-west-1.elb.amazonaws.com`, HTTPS listener, ECS
cluster `smie-prod-cluster` + service `smie-prod-svc` (1 Fargate task,
1 vCPU/2 GB), IAM exec/task roles, CloudWatch `/ecs/smie-prod`. The 8 production
credentials were transferred Vercel→AWS Secrets Manager (`smie-prod/*`), verified
byte-exact incl. `MAGIC_LINK_SECRET` (so sessions survive cutover). Est. cost
~$58–66/mo.

Key findings / decisions:
- ACM 3-name cert (`www`+apex+`aws-preview`) FAILED `CAA_ERROR`: `www.supermarket.ie`
  is a CNAME to Vercel whose CAA authorises sectigo/globalsign/letsencrypt/pki.goog
  but NOT amazon.com. apex and `aws-preview` validated. Worked around with a
  single-name ISSUED cert for `aws-preview.supermarket.ie` (`cca36c0b`). The
  `www`/apex cert is a cutover-time concern (move `www` off Vercel, or add
  `amazon.com` to the CAA then).
- Fixed a container bug: Eve server crashed with EACCES creating `/app/.eve`
  (non-root `node` user vs root-owned `/app`); Dockerfile now pre-creates and
  chowns `/app/.eve` + `/app`.
- Vercel Queues/Cron have no customer-facing dependency; SQS/EventBridge
  replacements exist in the branch but are provisioned OFF (`enable_workers=false`).

Remaining to make `https://aws-preview.supermarket.ie` publicly resolvable:
add ONE DNS record at Register365 — `aws-preview` CNAME →
`smie-prod-alb-48303444.eu-west-1.elb.amazonaws.com` (does not touch www/apex/
production). Production cutover (www/apex → ALB) and enabling AWS workers are
later, separately-approved steps.

## Structured identity contradiction guard — 11 October 2026

Final review extended exact-match gates to the newly retained structured
variant, flavour, formulation and pack-count attributes. Identical titles must
not conceal contradictory source attributes. Non-GTIN manufacturer-code
corroboration now cross-checks both original proofs; supplemental GTIN evidence
must also support the retained title, not only the SKU. These are read-only
identity holds; they do not change prices, mappings or collection rules.
The frozen audit has no original SuperValu/Dunnes response rows, so its 252/45
counts are unchanged. Regression coverage includes identical titles with
conflicting original structured flavours and counts.

## Verified matching release and migration history — 11 October 2026

PR #262 merged as `18e08fa`; required CI passed 566 tests plus the 16-test
behavioural gate, all TypeScript checks, lint (zero errors, 22 existing warnings)
and build. Production was verified READY at exactly that commit, deployment
`dpl_D4vB5siLvN4vKRvma7AN3RSqFpmJ`, and the homepage returned HTTP 200.
Both new migrations are applied. Supabase records their actual versions as
`20261011113227_retailer_identity_responses` and
`20261011114913_manufacturer_brand_claims`; repository filenames and migration
tests are aligned to those applied IDs to prevent accidental reapplication.
This follow-up changes filenames/test references only, not SQL contents.

The 11:50 UTC read-only check confirmed 22 brand claims, zero original peer
responses accumulated so far, 341/1,268/919 fresh Tesco/SuperValu/Dunnes prices,
zero Tesco renewals due, 285 due 12 October and 56 due 13 October, with five
unresolved requests held. Mapping identity fields match the frozen audit snapshot
(digest `ea6e911672bd91292c77db965378af32`). No price/mapping/gate writes were made.
The final audit is 252 provisional >=2-store groups, including 45 triples and
31 triples with three fresh prices; zero independently captured triples.

## Manufacturer matching scale follow-up — 11 October 2026

PR #261 merged after required CI passed (552 tests, behavioural gate, typechecks,
lint and build). The original-response migration is applied with RLS, no browser
read privileges and no service update/delete privileges. Production is READY at
`cf21e92`, deployment `dpl_4YHbts52KZmuNdEnt4rnUPoaiCVG`. At 11:35 UTC the new
table had zero rows: source retention is deployed, historical verification is not
backfilled. Tesco remains 341 fresh, zero renewals due and five unresolved holds.

This follow-up adds Supabase-backed versioned brand claims, an unresolved-brand
review queue, separate private-label/exclusive-manufacturer classes, strict pack
normalisation, original-body corroboration with GTIN or manufacturer product code,
and four-way bounded structured inference. Twenty-two primary-source claims seed
portfolio/alias recognition. No catalogue/mapping/price approvals are changed.

On the unchanged 09:28 available-catalogue snapshot, eligible valid-URL identities
increase Tesco 2,474→2,679, SuperValu 982→1,110, Dunnes 503→563 (+393). Recorded
exact groups across >=2 retailers increase 225→252; three-retailer groups 39→45,
of which 31 have three fresh prices. Independently captured triples remain zero.
Brand-only ablation is 246/44, deterministic-only is 229/40. Specific URL/title
pack disagreement is held, while lossy decimal slugs (1.5L→1-5l) are not treated
as contradictory measurements. Counts are provisional, not estimated
whole-retailer assortment or independently verified matches.

A 26-case primary-source diagnostic has 14 positive and 12 negative cases, with
12 accepted, zero false acceptances and two positive cases held. It is targeted,
not independently dual-rated, and cannot establish population false-match risk.
Dunnes 100739964 is independently published as 3x225g despite retained 225g title;
keep its mapping repair separate. Local provider credential is unavailable (the
provider key exists in Vercel); no secret was retrieved, no live model calls made,
no inference cost or validated live yield claimed. See docs/branded-intersection.md.

## Original retailer identity retention — 11 October 2026

PR #260 was reviewed against the main ruleset (required validate, resolved
threads, squash; no required human approval), merged as `f92e4bc` and verified
on www.supermarket.ie: production deployment `dpl_4soRkpbG3frZsDobjz1rVuSyctPx`,
READY, exact main SHA. At 11:14 UTC there were 341 fresh Tesco observations,
zero renewals due and five unresolved request holds. First renewal remains
12 October 10:28:30 UTC. Existing Tesco gates/schedules were not changed.

This follow-up retains original decoded HTTP bodies from successful normal
SuperValu/Dunnes refreshes in private append-only `retailer_identity_responses`.
It adds no retailer requests, schedules, mapping approval or price rules.
Source nodes must independently supply the selected SKU and title. Retention
runs after successful price finalization; storage failures are logged without
replaying that completed operation. Listing responses remain listing evidence.
Hashes are database-computed over original decoded UTF-8, never assembled
metadata. The source adapter reparses and hashes retained bodies before use.
No historical receipt backfill is permitted. Browser roles have no table access.
Migration must precede worker release; until both are deployed, this is prepared
capability, not evidence that any historical product has been independently captured.

## Branded intersection audit proposal — 11 October 2026

GitHub main and production were verified at merged `1979aaa` (PR #258), Vercel
READY. A read-only full available-catalogue audit covers 2,462 canonical products,
7,381 Tesco/SuperValu/Dunnes mappings and 3,968 retained Tesco SKUs. Nominal
three-store associations and non-own-brand flags are not verified identity.
Sourced brand ownership, explicit pack/variant checks and retailer SKU evidence
must establish identity independently of the canonical associations.

This branch adds an offline deterministic evaluator, private JSON/CSV proposal
outputs, source-evidence intake and a bounded Anthropic inference interface.
Original SuperValu/Dunnes response bodies are not retained in the audited data;
refresh-attested title matches remain category B pending independent capture.
Only independently captured evidence at all three stores enters category A.
No provider credential was available in this audit session, so live inference
was not run. Fixture inference must never be reported as live model results.
See `docs/branded-intersection.md` for commands, evidence tiers and rollout.

Production rechecked at 09:55 UTC: 341 fresh trusted Tesco observations, 1,268
SuperValu and 919 Dunnes; the mapping identity digest was unchanged throughout
the chunked export and final check. Zero Tesco renewals are currently due; 285
become due on 12 October from 11:28:30 Irish time and 56 on 13 October. First
expiry remains 15 October 11:28:30. Five unknown requests (four products, one
listing) remain held. No active lease/cooldown; the supervised workspace egress
remains disabled between approved runs. Renewal takes priority over discovery.
No mappings, prices, gates, checkpoints or scheduler were changed by this work.

## Tesco identity/acquisition handoff proposal — 11 October 2026

Production verified at 06:42 UTC: 341 fresh trusted Tesco prices, 171 fresh
three-retailer comparisons, five preserved unknown requests, no active lease or
cooldown, and zero renewals currently due. First renewal is 12 October 11:28:30
Irish time; 285 due on 12 October and 56 on 13 October. Earliest expiry is
15 October 11:28:30. Production remains merged main `5e0d88a`, deployment READY.

This branch proposes consistent unit-word normalization, narrowly bounded
direct-product structured quantity fallback, and an explicit completed-acquisition
handoff in the supervised expansion runner. No renewal mode, production mapping,
canonical record, original evidence timestamp or pricing policy was changed.
A production read-only dry-run selected Avonmore Protein Milk Vanilla 1L (308465836)
and Birds Eye Petits Pois 450g (294076621) from their original checkpointed evidence
and current peer mappings. No Tesco request or trusted-price write was made.
Both are eligible under this proposed code, not yet enabled in production.

See `docs/tesco-acquisition-handoff.md` for evidence requirements, review boundary,
duplicate prevention, commands and retained limitations. Do not merge/deploy or
retry checkpointed requests merely to demonstrate the proposal. PR #256 remains
unapproved and unexecuted; all five unknown outcomes remain held.

**Last updated:** 29 September 2026

> **READ THIS FIRST BEFORE STARTING SUPERMARKET.IE DEVELOPMENT.**
>
> This file is the canonical technical/strategic project memory. Do not infer current project state solely from chat history or an old handoff prompt. Inspect referenced code, PRs, branches and specialist docs before changing implementation.
>
> Update this file whenever a material architecture decision, experiment, integration, production change or retailer-execution finding occurs. Never place credentials or secret values here.

## 1. North star

Supermarket.ie should become **Ireland's retailer-neutral AI grocery and household shopping infrastructure**.

Target flow:

`Household intent → Shopping Capability Layer → basket → retailer execution → retailer checkout`

Supermarket.ie owns household understanding, shopping intent, product/ingredient intelligence, cross-retailer reasoning, basket construction, retailer selection, transaction origination and eventually rewards/referrals/AI-agent distribution.

Retailers initially remain merchant of record and own checkout, payment, picking and fulfilment.

Supermarket.ie is **not primarily a price-comparison website**. Long-term promise: **"the service that runs your household shop."**

## 2. Shared Shopping Capability Layer

PR #20 merged to `main` on 18 August 2026.

Merge commit: `715889a9e61d4fb7293e9691491cdd5caeb98c52`

Architecture moved from:

`Eve tool → business logic`

toward:

`Shopping Capability Service → Eve / website / API / MCP`

Shared code under `src/lib/shopping/**` includes contracts, catalogue/product resolution, retailer offers, household context, basket construction, retailer preferences, store totals, whole-basket comparison and household-shop preparation/replenishment reasoning.

Target external capabilities include `find_product()`, `get_household_context()`, `prepare_household_shop()`, `build_basket()`, `compare_shop()`, `handoff_to_retailer()` and `record_shop_outcome()`.

**Do not rebuild this layer before inspecting current `main`.**

## 3. Immediate retailer-execution milestone

`prepare_household_shop → retailer basket → populated retailer trolley → shopper checkout`

Desired UX:

1. Eve prepares the household shop.
2. Shopping Capability Layer compares retailer fulfilment/price.
3. Shopper chooses a retailer.
4. Shopper explicitly selects **Shop this basket**.
5. Retailer trolley is populated where actually supported.
6. Shopper reviews delivery/collection and pays retailer directly.

Supermarket.ie must not handle retailer passwords, payment credentials or retailer session tokens merely to populate a cart.

**Product requirement: no browser extension.** The shopper may authenticate directly with the retailer, but Supermarket.ie must not require an extension as part of normal checkout.

## 4. Retailer status

| Retailer | Current understanding | Truthful status |
|---|---|---|
| SuperValu | Instacart Storefront; strong SKU/URL/store mapping; store-scoped single + bulk cart operations understood; anonymous cart disabled; OIDC login required | `product_links` today; authenticated cart mechanics understood but no acceptable browser-only/no-extension execution path yet |
| Dunnes | **Instacart Storefront**; production refresh uses `storefrontgateway.dunnesstoresgrocery.com/api`, store `258`; mapped SKUs/rsid URLs; `/api/stores/258/cart` exists and allows GET/POST; unauthenticated GET returns 401 | Cart resource and auth boundary proven read-only; exact authenticated add payload still to be confirmed, but architecture strongly converges with SuperValu |
| Tesco | Existing retailer data plus extensive prior Pepesto work, including checkout-protocol and 3-product basket session tests | **Prior basket-handoff work exists and must be recovered before any new Tesco implementation** |
| Aldi | Catalogue/pricing pipeline; no equivalent online grocery checkout target established | No transaction adapter currently |

See `docs/retailer-execution.md` for detailed findings.

## 5. SuperValu handoff — PR #21

Branch: `agent/retailer-handoff`

Draft PR #21 established:

- shared `RetailerAdapter`
- retailer registry
- SuperValu adapter
- basket-item mapping
- selection of SuperValu alternatives
- quantity preservation
- SKU/product identity
- direct product URLs
- safe-domain validation
- complete/partial/missing mapping states
- tests

It intentionally reports `product_links`; it does **not** claim trolley population.

PR #21 predates many later `main` commits. Preserve its architecture/findings; do not merge blindly.

## 6. SuperValu cart findings — 29 August 2026

Live Storefront inspection established:

- SuperValu uses Instacart Storefront.
- `rsid` is retailer-store context.
- Cart is store-scoped.
- Add uses `POST stores/{retailerStoreId}/cart`.
- Add payload includes SKU, quantity, catalog source and shopping-mode ID.
- Client exposes single and bulk add operations (`AddProductLineItemToCart`, `AddProductLineItemsToCart`).
- Quantity update uses `SetLineItemQuantity`.
- Delivery/collection slot is not required merely to build/review cart.
- Live config has `anonymousCart: false`.
- Logged-out Add redirects into SuperValu auth.
- OIDC auth references include `sts.supervalu.ie`.

Conclusion: bulk trolley population is technically straightforward **inside an authorised SuperValu shopper context**. The blocker is execution/auth context, not product mapping.

### Rejected extension route

Branch `agent/supervalu-browser-bridge-poc`, draft PR #56, proved a browser-side Add-to-Trolley model but required a Chrome extension.

**Do not merge PR #56 as mainstream UX.**

A normal supermarket.ie page cannot manipulate an authenticated `shop.supervalu.ie` tab because of browser same-origin/security boundaries. Do not seek brittle bypasses.

## 7. Dunnes cart findings — 29 August 2026

### Important correction

Do **not** describe current Dunnes grocery as a separate Wynshop execution surface. Current production code and live retailer URLs show that Dunnes is using **Instacart Storefront infrastructure**.

Production code explicitly uses:

- gateway: `https://storefrontgateway.dunnesstoresgrocery.com/api`
- retailer store ID: `258`
- site: `https://www.dunnesstoresgrocery.com`
- shopping mode: `22222222-2222-2222-2222-222222222222`
- search path: `/api/stores/258/search`
- headers including `x-site-host`, `x-site-location`, `x-correlation-id`, `x-shopping-mode`

Mapped Dunnes `store_products` already contain stable numeric `store_sku` values and store-scoped `rsid/258` URLs.

### Read-only cart probe

Branch: `agent/dunnes-cart-probe`

A read-only Vercel-side probe used the same headers/transport as the production Dunnes refresh. It performed no login, no POST and no cart mutation.

Results:

- production-style `/api/stores/258/search`: **HTTP 200**
- `OPTIONS /api/stores/258/cart`: **HTTP 405**, with `Allow: GET, POST`
- unauthenticated `GET /api/stores/258/cart`: **HTTP 401**

This proves:

1. Dunnes has a store-scoped Storefront cart resource at `/api/stores/258/cart`.
2. The cart resource supports POST mutations.
3. The cart is authentication/session-bound rather than a freely writable server-side guest cart.
4. Dunnes and SuperValu now appear to share the same underlying Instacart Storefront execution family, so a shared Storefront execution engine is preferable to duplicating retailer-specific cart logic if/when authenticated execution is solved.

Exact Dunnes POST domain-model/body has **not yet been sent or inferred as proven**. Do not mutate a Dunnes cart merely to discover it. First exploit the common Storefront architecture/public client behaviour or Pepesto protocol evidence.

The temporary one-shot GitHub probe workflow was removed after the test.

## 8. Pepesto — EXISTING INTEGRATION AND CHECKOUT WORK, DO NOT REDISCOVER

This is a critical historical area that was previously lost between chats.

Existing branch: `pepesto-tesco-adapter`

Historical adapter: `src/lib/pepesto-tesco.ts`

API base used: `https://s.pepesto.com/api`

### Credential architecture

Historical server-side code gets the Pepesto credential via:

`supabaseAdmin.rpc('get_pepesto_api_key')`

and sends it as a Bearer token.

Established access path:

`Supermarket.ie server → Supabase get_pepesto_api_key() → Pepesto API`

Do not search for, print or expose the secret value.

### Phase 1 — Tesco search/retrieval

Earlier Pepesto work used `/credits`, `/search` and `/retrieve` for Tesco product discovery/pricing because direct Tesco scraping was problematic.

### Phase 2 — Tesco basket / checkout-protocol work

**Do not describe the prior Pepesto work as search/retrieval only.**

On 21 August 2026 we explicitly investigated how Pepesto creates a Tesco basket and began reproducing that approach for Supermarket.ie handoff.

Repo history includes commits such as:

- `add one-time Pepesto checkout protocol test`
- `add three-product Pepesto checkout protocol test`
- `schedule three-product Pepesto checkout protocol test`
- `add one-time Pepesto checkout continuation`
- `add one-time Pepesto checkout recovery turn`
- `add fresh recorded Pepesto checkout session`
- `schedule fresh Pepesto checkout recording`

The three-product test implemented:

`/products` with exact Tesco preferred URLs → exact matches → Pepesto session tokens → `/session` with quantities → Pepesto session ID → `/checkout` → record protocol instruction → continue `/checkout` on the same session`

The checkout protocol parser explicitly inspected:

- `load_page`
- `await_element`
- `run_js`
- `prompt_user_action`
- `await_js_out_change`
- `done`

Historical Supabase records still include session/checkout metadata. One known session is `76a090b1-f7f9-437d-b505-2b996f00718a`; later continuation/recovery checkout calls were charged €0.00. Do not create a new paid session merely to rediscover this protocol.

### Pepesto public runtime boundary — 29 August 2026

Pepesto's current public docs confirm `/checkout` is a turn-by-turn browser-driving protocol. A compatible client must be able to load retailer pages, run server-provided JS, wait for DOM state and prompt the shopper.

Pepesto's hosted Agent-to-Cart/MCP route is free to initiate, but the actual consumer checkout handoff goes into the **Pepesto mobile app**. On desktop it shows a QR code and asks the user to continue on the phone. Pepesto says the app runs the checkout loop and then redirects to the retailer cart/login page.

Pepesto's iframe/dockable UI can host its basket-review UI, but current public documentation says the actual checkout-driving step moves into the Pepesto mobile app. Therefore **Pepesto has not revealed a normal browser-only cross-origin trick that supermarket.ie can simply copy**.

This validates our own browser-origin analysis: the hard part is executing inside the retailer-authenticated context. Pepesto solves that with a controlled client runtime (mobile WebView/app; their API also cites browser extensions or Playwright as examples).

### Pepesto strategic role

Preferred role if used:

`Shopping Capability Layer → PepestoExecutionAdapter → retailer execution`

Supermarket.ie should continue to decide household needs, products, quantities, retailer comparison and recommendations. Pepesto should not replace our shopping intelligence.

However, because the user experience must not require a browser extension and ideally should remain Supermarket.ie-led, continue studying/reproducing the underlying retailer Storefront operations before adopting Pepesto's mobile-app handoff as the primary UX.

## 9. Retailer-selection UX

After basket preparation, show retailer-neutral fulfilment/price options, for example:

- SuperValu — X/Y items — approx. €A
- Dunnes — X/Y items — approx. €B
- Tesco — X/Y items — approx. €C

Supermarket.ie may recommend based on fulfilment, price and household preferences, but the shopper chooses.

Only show **Shop this basket** as true trolley population where it has actually been proven. Never claim `authenticated_cart` merely because mappings or protocol instructions exist.

## 10. Transaction instrumentation

Target events:

- `basket_prepared`
- `retailer_selected`
- `handoff_started`
- `handoff_items_mapped`
- `retailer_trolley_prepared`
- `retailer_checkout_opened`
- `purchase_confirmed` only where legitimately observable

Never emit `retailer_trolley_prepared` unless the retailer trolley was actually populated.

Long-term leverage should include retailer-attributable GMV.

## 11. Current branches / PRs requiring awareness

### PR #21 / `agent/retailer-handoff`
Original SuperValu `RetailerAdapter` / `product_links` handoff. Valuable but stale relative to current main.

### PR #56 / `agent/supervalu-browser-bridge-poc`
Extension-based SuperValu proof. Experimental only; not mainstream product direction.

### `agent/dunnes-cart-probe`
Read-only Dunnes gateway/cart discovery branch. Confirmed Storefront cart path/auth boundary. One-shot workflow removed after test. Do not treat as production implementation.

### `pepesto-tesco-adapter`
Historical Pepesto Tesco work covering **both product retrieval and checkout/basket-protocol investigation**. Inspect before new Pepesto/Tesco handoff work.

## 12. Strategic guardrails

- Do not turn Supermarket.ie back into primarily price comparison.
- Do not build Supermarket.ie-owned grocery fulfilment at this stage.
- Do not become merchant of record initially.
- Do not make marketplace/vendor onboarding a prerequisite for proving transactions.
- Do not require retailer commercial agreements where a legitimate technical handoff exists.
- Do not circumvent retailer security controls.
- Do not make the business dependent on bypassing anti-automation/security protections.
- Do not handle retailer payment credentials.
- Do not capture/replay retailer passwords/session tokens merely to populate carts.
- Do not require consumer browser extensions.
- Do not use hidden sponsored recommendations.
- Do not claim an execution state that has not happened.

## 13. Current recommended next sequence

1. Read this file and `docs/retailer-execution.md` before retailer work.
2. Treat Dunnes and SuperValu as likely members of a common **Instacart Storefront execution family**, not completely separate checkout integrations.
3. Recover the most detailed historical Tesco Pepesto checkout instructions/results available from repo history and `scrape_runs`.
4. Continue zero-credit inspection of public Pepesto and Instacart client/runtime behaviour for retailer-specific execution details.
5. Determine whether a legitimate browser-native authenticated Storefront handoff exists; do not seek same-origin bypasses.
6. If a retailer-specific Pepesto session becomes the only way to reveal a decisive missing instruction, tell the user before spending credits and keep the test minimal.
7. Bring the chosen execution method behind the current Shopping Capability Layer / retailer adapter interface.
8. Add transaction attribution events.
9. Connect proven handoff to Eve with explicit shopper approval.
10. Only then expose the same primitive through API/MCP.

## 14. Documentation discipline

For every material Supermarket.ie development session:

1. Read `PROJECT_STATE.md` first.
2. Inspect current `main` and referenced branches/PRs.
3. Read relevant specialist docs.
4. Do the work.
5. Update documentation in the same workstream when findings/decisions change.
6. Record abandoned approaches as well as successful ones.
7. Never put secrets, tokens, passwords, customer credentials or payment data into project-state documents.

## 15. Decision log

- **2026-08-18 — Shared Shopping Capability Layer established (PR #20).** Reusable shopping logic becomes the architectural core.
- **2026-08-18 — SuperValu selected as first retailer-handoff adapter (PR #21).** Truthful `product_links` handoff created while cart execution remained unproven.
- **2026-08-21 — Pepesto Tesco checkout protocol investigated.** Three-product session, checkout instruction and continuation/recovery work were performed; this was the start of basket-handoff implementation, not merely search/retrieval.
- **2026-08-29 — SuperValu cart mechanism established.** Bulk cart operation understood; authenticated execution remains the blocker.
- **2026-08-29 — Browser-extension requirement rejected.** No-extension is a product requirement.
- **2026-08-29 — Pepesto prior work rediscovered.** Historical execution work must be recovered before new retailer reverse engineering.
- **2026-08-29 — Dunnes confirmed as Instacart Storefront execution.** Production gateway/search works at store 258; cart resource allows GET/POST and returns 401 without authentication. Consequence: design toward a shared Storefront execution engine for Dunnes/SuperValu rather than duplicate retailer-specific cart plumbing.
- **2026-08-29 — Pepesto public runtime boundary clarified.** Free MCP/list handoff still finishes through Pepesto's mobile app/WebView; no browser-only cross-origin shortcut has been identified.
- **2026-08-29 — Repository documentation is canonical project memory.** Future sessions must read and maintain these docs.
- **2026-09-18 — Signed-in Home visual direction modernised.** The forest-green Home banner and narrow dashboard stack were replaced with a wider consumer shopping workspace. The agent is the dominant pale-mint patterned surface on a neutral-stone page, while the current shop is a crisp-white live companion and household insights use lighter, purpose-specific cards. Green is reserved for actions and positive state rather than large decorative banners; conversation persistence and fresh-start behaviour remain unchanged.

## 16. Trusted pricing architecture and current state

The pricing identity chain is `products` (canonical catalogue identity) →
`store_products` (retailer mapping) → append-only `price_observations` →
`trusted_retailer_offers` → `latest_prices`.

`latest_prices` is the fail-closed consumer boundary used by the website,
shopping agent, product pages, comparisons, list generation, basket repricing,
deals and household insights. Consumers must not fall back to raw observations
when it is unavailable or empty.

A live price requires a resolved retailer mapping, non-empty retailer SKU and
name, positive price, approved provenance and an observation no more than seven
days old. SuperValu search-result URLs are excluded. Wrong mappings and stale
prices are worse than missing prices; plausible alternatives must never be
silently substituted for exact products.

Promotion truth rule: `on_promotion` is retailer evidence, not proof of a
monetary saving. A confirmed shopper-facing saving requires
`was_price > price`. Retailer-marked offers without a previous price may be
described as such, but must not be given an invented before price or claimed
percentage saving.

Production snapshot on 6 September 2026:

| Retailer | Mapped | Live trusted | Coverage | Retailer-marked | Confirmed savings |
|---|---:|---:|---:|---:|---:|
| Tesco | 2,461 | 397 | 16.1% | 132 | 0 |
| Dunnes | 2,460 | 827 | 33.6% | 189 | 189 |
| SuperValu | 2,460 | 1,148 | 46.7% | 64 | 64 |
| **Total** | **7,381** | **2,372** | **32.1%** | **385** | **253** |

There were 1,821 canonical products with at least one live retailer price, 503
with at least two, and only 48 with all three main retailers. These figures are
a dated snapshot and must be queried again before decisions.

Refresh selection should prioritise never-observed → stalest → freshest, with
usage-aware priority for products shoppers request. Transport failures and
product-identity failures must remain separately observable.

Retailer specifics:

- **Tesco:** uses Pepesto `/search` with exactly one product per independently
  attributable session. Accept
  only an exact Tesco SKU in the returned product URL. The synchronous
  `/products` route was tested and is unsafe as the primary refresh because it
  can generalise branded queries. Pepesto currently returns current price,
  promotion flag and sometimes percentage, but no validated Clubcard label or
  explicit previous price. Do not derive a previous price until arithmetic,
  rounding and history checks have been approved. Balance after the September
  500-product run was €12.16; verify before every paid run. Paid submissions
  are enabled by an explicit owner-authorised manual dispatch, `CRON_SECRET`,
  the daily spending cap and a live balance check—not by a persistent Vercel
  enable/disable flag. There is no automatic paid submission schedule.
  Do not estimate Pepesto spend from a hard-coded tariff. On 6 September a
  100-product/ten-search run reduced the balance from €12.16 to €0.16 despite
  the previous €0.32-per-search assumption. Record credits before and after
  submission and report only the observed balance difference as actual cost.
- **Dunnes:** direct storefront API; prefer exact stored SKU and validate name,
  product signals and pack identity. Scheduled Monday/Thursday 05:10 UTC,
  target 1,000.
- **SuperValu:** direct `/product/` pages; reject search-result mappings and
  validate name/pack identity. Generic promotion CSS in shared page chrome is
  not promotion evidence. Unsupported flags were cleared in production on
  6 September. Scheduled Monday/Thursday 05:20 UTC, target 1,000.

Latest run health at this snapshot: Tesco 397/500 exact matches and 103
rejections; Dunnes 738/1,000 extracted and degraded; SuperValu 828/1,000
extracted and degraded.

PR #62 (`Fix promotion trust and Tesco retrieval`) was merged and deployed to
production on 6 September 2026 at commit
`dca0c9db46af1dfe65003b9838d2ce7b0047ec6e`. It makes shopper-facing deals and
agent promotion tools require confirmed savings, fixes the SuperValu parser,
enforces exact-SKU Tesco matching, repairs manual Tesco dispatch, and adds a
ten-minute no-cost retrieval schedule. Paid Tesco submissions remain manual,
balance-aware and capped.

## 17. Active project monitoring

- **Supermarket.ie Update:** hourly condition watch for meaningful production-
  readiness changes. This is the source of the useful supermarket health/status
  notifications the user has been receiving.
- **Grocery Market Watch:** daily condition watch for material external grocery
  marketplace, retailer-onboarding, pricing and product-data developments.

## 18. Next pricing priority

Increase trusted fresh-price coverage without weakening identity standards or
exhausting Pepesto credit. Begin by measuring the overlap deficit by canonical
product and shopper usage, then prioritise work that adds the most two-retailer
and three-retailer coverage per request/euro.

### Coverage strategy and operating plan

Refresh selection should use this priority order for exact, resolved mappings:

1. the target retailer currently has no trusted live price;
2. the product has appeared in `list_items`, ordered by usage occurrences and
   quantity;
3. the product already has trusted live prices at other main retailers, so the
   refresh completes three-store and then two-store comparisons;
4. the mapping has never produced an observation;
5. the existing observation is stalest.

Fresh target-retailer rows remain eligible as lower-priority maintenance. A
missing/blank retailer SKU is not executable refresh work and must be sent to a
mapping/discovery workflow instead of consuming a price request.

Roll out coverage improvement in measured tranches:

1. refresh resolved Dunnes and SuperValu overlap gaps first because their
   direct transports do not consume Pepesto credit;
2. discover missing direct-retailer mappings, prioritising shopper demand;
3. run Tesco only after explicit manual approval, checking the live balance and
   any authoritative Pepesto quote available for that specific run; never
   invent or hard-code an expected cost, and never schedule or automatically
   start a paid submission;
4. protect high-demand staples from ageing out by keeping the same selector in
   scheduled Monday/Thursday direct-retailer refreshes;
5. only broaden to low-demand one-store products after high-demand and overlap
   gaps are materially reduced.

Baseline targets from the 6 September snapshot are: products with at least two
live retailers from 503 to 750; all three from 48 to 150; demanded products
with at least two retailers from 70/626 to 250; and, among the top 100 demanded
products, at least 80 with two retailers and 40 with all three. Re-query these
metrics after every tranche; do not treat the targets as evidence that coverage
has already improved.

Decision-log additions:

- **2026-09-06 — Promotion truth tightened.** Retailer flags and confirmed
  monetary savings are distinct; `was_price > price` is required for a saving.
- **2026-09-06 — SuperValu promotion contamination corrected.** Generic shared
  promotion classes had marked ordinary products; unsupported live flags were
  cleared without changing prices.
- **2026-09-06 — Tesco exact-SKU Pepesto rule confirmed.** Current prices are
  accepted only for the exact mapped Tesco SKU; no inferred Clubcard before
  price is approved.
- **2026-09-06 — Coverage strategy approved.** Rank exact resolved refreshes by
  missing target-store coverage, shopper demand, cross-retailer overlap,
  never-observed status and staleness. Use free direct-retailer requests first.
  Tesco/Pepesto paid submissions are manual-only: never schedule them, and
  confirm the live balance and any authoritative Pepesto quote for every
  approved run, then record the observed cost.
- **2026-09-06 — Pepesto cost assumption invalidated.** A ten-search run cost
  €12.00 rather than the hard-coded €3.20 estimate. Cost controls and reporting
  must use observed before/after credit balances; no fixed Pepesto tariff may
  be presented as authoritative.

## 19. Household-agent runtime and guest planning

The homepage agent uses the Eve runtime (`agent/**`) for both guests and signed-
in users, with Claude Sonnet 5 and the instructions in
`agent/instructions.md`. Guest versus signed-in status changes the tools and
household data available; it should not change the agent identity.

The homepage permits two guest user turns. After a complete first answer it
may show a relevant inline signup invitation while leaving the second turn
available. A persistent action such as watching or monitoring gates
immediately. For an underspecified complete-household-shop request, Eve may use
the first response for one consolidated clarification covering household
composition, approximate budget and essential dietary requirements. The second
turn must complete the shop using explicit reasonable assumptions for anything
omitted; there must be no further clarification loop.

Homepage continuation CTAs are selected from the requested outcome. Complete
or weekly basket planning is a `shop` intent even when the prompt mentions
offers, prices or a budget as supporting evidence. Its CTA is **Save this
household shop** rather than a product-watch CTA. Generated starters should
retain their declared task meaning, and freely typed requests use the shared
deterministic intent classifier.

The older `/api/plan` + `src/lib/planner-agent.ts` runtime remains a live
compatibility path for database-backed saved conversations through
`ConversationChat.tsx`; it must not be deleted until those conversations can be
resumed in Eve without losing history. Its temporary model is aligned to Claude
Sonnet 5, but its prompt/tool architecture is still legacy. Do not add new
callers. The intended migration is to preserve/import existing conversation
history into Eve, verify list/profile/validation parity, remove the final
caller, and then delete the old planner prompt/model/tool path.

Decision-log additions:

- **2026-09-06 — Guest household-shop clarification aligned to the two-turn
  preview.** One combined clarification is allowed only when household context
  materially changes a complete-shop result; the following turn must finish.
- **2026-09-06 — CTA intent follows requested outcome.** Household-shop plans
  remain shop intent when offers or prices are used as evidence.
- **2026-09-06 — Planner convergence boundary recorded.** Homepage traffic is
  already on Eve; `/api/plan` remains only for live saved-conversation
  compatibility and is frozen pending a history-preserving migration.

## 20. Typed household-shop contract

Phase 1 of the household-agent improvement programme introduces the reusable
`household_shop.v1` contract under `src/lib/shopping/**`. It is deliberately
owned by the Shared Shopping Capability Layer rather than the homepage or Eve.

The contract separates a model-authored shop proposal from authoritative
application state. The proposal may supply household and planning assumptions,
sections, needs, quantities, reasons and canonical-product candidates. It may
not author authoritative prices, promotion savings, totals or retailer basket
coverage. `groundHouseholdShop()` validates the proposal and joins it against:

- authoritative canonical catalogue products; and
- current exact retailer offers supplied from the fail-closed `latest_prices`
  boundary.

Unknown product IDs are downgraded to unresolved needs. Known products without
a trusted current offer remain explicitly unavailable. Retailer-marked
promotion evidence stays separate from a confirmed monetary saving, which
requires `was_price > current_price`. Line totals, selected totals, retailer
totals and complete-store basket totals are calculated in server code. A
retailer basket has no basket total and cannot be described as complete if any
shop line lacks a trusted offer at that retailer.

The v1 contract supports food, drink, toiletries, cleaning and other
supermarket household consumables. It carries household assumptions, item
purpose, resolution state, candidate and selected offers, missing/uncertain
items, store coverage, retailer strategy, price provenance and a compact
decision trace.

Current migration boundary: this phase adds the contract and deterministic
grounding. Phase 2 adds Eve's native `present_household_shop` path and homepage
rendering without making new results depend on `parse-planner-markdown.ts`.
Saved lists still use their existing JSON/Markdown compatibility paths. Phase
3 should make the validated v1 payload the authoritative saved-list input while
preserving old lists and conversations.

Decision-log addition:

- **2026-09-06 — `household_shop.v1` ownership boundary established.** Models
  propose household needs; the Shared Shopping Capability Layer validates
  canonical identity and owns current offers, promotion truth, totals, store
  coverage and retailer recommendations.

## 21. Native Eve household-shop presentation

Phase 2 uses Eve's supported structured tool-result path rather than a custom
event protocol. `present_household_shop` is available to guests and signed-in
users. It accepts only the model-authored `household_shop.v1` proposal, looks up
canonical identities and exact fresh offers server-side, and returns the
validated contract as a durable Eve `dynamic-tool` result.

The homepage reads completed `present_household_shop` tool parts from Eve's
default message projection and renders a native mobile-responsive shopping
card. The card shows household/planning assumptions, dietary requirements,
sections, quantities, selected current prices, promotion evidence, unresolved
gaps, deterministic totals, complete-versus-partial retailer coverage and the
recommended retailer strategy. It explicitly labels the result as a proposed
shop rather than a saved list, retailer trolley or completed order.

This mechanism preserves the structured payload inside the Eve event log. The
existing guest-to-account handover copies that event log to the signed-in
storage key, so the rendered shop and assumptions survive signup without being
reparsed from assistant prose. Invalid or incomplete tool outputs stored in the
browser are ignored by the renderer.

Catalogue resolution now carries `canonical_product_id` through its shared
result so Eve can cite an exact identity in the presentation proposal. The
model must leave uncertain needs unresolved rather than manufacture IDs.

Compatibility boundary: `parse-planner-markdown.ts` remains untouched for the
legacy saved-list flow and historical conversations. Phase 3 must persist the
validated structured tool output directly, deterministically reprice it and
retain unresolved gaps; it must not parse the accompanying prose.

Decision-log addition:

- **2026-09-06 — Native structured presentation uses durable Eve tool
  results.** `present_household_shop` returns the server-grounded v1 contract;
  homepage UI renders that payload directly while prose is limited to a short
  introduction or qualification.

## 22. Structured household-shop persistence

Phase 3 makes a completed `household_shop.v1` Eve result the authoritative input
to `/api/lists/save-from-planner`. After registration, the existing guest Eve
event handover restores the same native shop on the homepage and the signed-in
client saves that structured payload once. Existing signed-in structured shops
use the same path. A browser marker keyed by the contract generation timestamp
prevents duplicate saves, while a failed save leaves the proposed shop visible
and reports that persistence did not complete.

The save route authenticates with the HttpOnly session cookie (while retaining
the explicit-token compatibility path), reconstructs the model proposal, and
re-runs `groundHouseholdShop()` against current canonical products and the
fail-closed `latest_prices` view immediately before persistence. Therefore
stored product IDs, retailer identities, prices, promotion state, line totals
and coverage are not copied blindly from browser state. Unknown IDs become
unresolved needs and stale offers disappear through the same deterministic
grounding rules used for presentation.

`saved_lists.items` retains every line, including unresolved gaps, plus canonical
product ID, quantity, pack expectation, selected retailer identity and coverage
status. Only grounded, priced lines are written to `list_items` shopping history;
an unresolved line is retained in the saved-list JSON and is never converted to
an unrelated product. Store totals are derived from the newly grounded contract,
and incomplete retailer baskets retain a null total. Household assumptions and
the grounding decision trace are retained in `agent_decision_trace`.

Compatibility boundary: Markdown input remains accepted for historical callers
and continues through `parse-planner-markdown.ts`. New Eve household shops never
use that parser. Existing lists and conversations remain readable without a
data migration.

Decision-log addition:

- **2026-09-06 — Structured household shops are re-grounded on save.** The
  durable Eve result supplies needs and canonical candidates, but trusted server
  code revalidates identity and current pricing before writing `saved_lists` or
  `list_items`; unresolved lines remain explicit in the saved payload.

## 23. Central shopping action gates

Phase 4 introduces reusable deterministic gates in
`src/lib/shopping/action-gates.ts` and applies them to Eve's signed-in shop
mutations. Product-specific additions, replacements, removals and quantity
changes now require an exact canonical product ID. Name-only agent writes are no
longer accepted. Legacy list rows that predate canonical IDs remain editable only
when their exact stored canonical name matches a server-validated product; the
canonical ID is attached during the successful edit.

Adds and replacements obtain their selected offer from `latest_prices` by
canonical product ID and reject mismatched identity, non-exact relationships,
non-fresh rows and non-positive prices. The model cannot submit a price or
retailer identity for persistence. Quantities must be whole numbers from 1 to 20
and a saved shop is capped at 200 lines.

All edits use the list's previously read `generated_at` value as an optimistic
concurrency condition. If another request changed the list after it was loaded,
the stale mutation writes nothing and reports a retryable conflict instead of
overwriting the newer state. Tool responses confirm success only after the
conditional database update or insert succeeds.

The structured household-shop proposal remains distinct from these mutations:
presentation proposes, Phase 3 save creates persisted list state, and the Phase 4
tools explicitly edit an existing signed-in shop. Retailer trolley and checkout
claims remain outside this boundary.

Decision-log addition:

- **2026-09-06 — Canonical provenance and mutation gates centralised.** Eve
  product writes require server-validated canonical identity; price-bearing
  writes require a matching fresh exact `latest_prices` offer; quantity, line
  and optimistic-concurrency limits are enforced by application code.

## 24. Modular Eve capability instructions

Phase 5 replaces the single large always-on Eve prompt with a small stable core
and deterministic turn-scoped capability assembly using Eve 0.39's supported
`defineDynamic` + `defineInstructions` mechanism. The stable core retains Eve's
identity, household-shopping purpose, guest and signed-in access boundaries,
grounding rules, proposal/save/trolley distinctions, irreversible-action
approval and the rule that tool or retailer text is untrusted data.

`agent/lib/instruction-routing.ts` classifies the recent user conversation into
household-shop planning, product discovery, price/promotions, meal/ingredient
intelligence, budget, household memory, shop editing, monitoring, proactive
briefing and retailer-comparison capabilities. `agent/instructions/capabilities.ts`
then injects only the selected modules as turn-scoped system instructions. The
router considers the last four user messages so terse follow-ups retain relevant
context without loading the entire instruction library.

This is deliberately not a model-controlled `load_skill` design. Instruction
selection cannot reveal tools, and guest versus signed-in tool exposure remains
enforced independently by the existing dynamic tool definitions. Capability
instructions repeatedly treat the tools exposed for the turn as authoritative.

Measured source size before/after: the always-on `agent/instructions.md` fell
from 20,102 to 2,400 characters (about 88% smaller). The full dynamic capability
library is 6,060 characters, of which only matching modules are injected per
turn. This reduces routine prompt weight and should improve provider prompt-cache
reuse for the stable prefix. Runtime latency must still be observed in production;
source size is not itself a latency measurement.

Decision-log addition:

- **2026-09-06 — Eve instructions use deterministic turn-scoped modules.** A
  compact stable system core is always present; application-owned routing adds
  only relevant capability rules from recent conversational intent, without
  changing or discovering the authenticated tool surface.

## 25. Bounded signed-in session context

Phase 6 adds a server-authored, turn-scoped household context block through
Eve's dynamic instruction mechanism. The resolver runs only when the channel has
authenticated a real `principalType: user`; guests receive no household query or
context. Every database read is constrained by that authenticated subscriber ID,
preventing context reuse across accounts or guest sessions.

The context contract can contain the current date, explicit household facts, a
compact current-shop summary, the active weekly meal plan, bounded recent
shopping evidence and active watches. Phase 5's deterministic capability router
selects which optional sections are included for the task. Current-shop data is
limited to 80 lines, recent behaviour to 40 source rows/20 summaries and watches
to 20. Raw conversation history and unrestricted purchase history are not
injected.

The entire block is capped at 4,000 characters with deterministic truncation and
an explicit `context_truncated` marker. Runtime observability records only the
character count, truncation flag, selected capabilities and included section
names; it does not log the household values. The block is delivered with user
role and is labelled application-supplied untrusted user data, so saved or
external text cannot become system instructions. The current user delivery
follows it and therefore overrides saved defaults naturally.

Explicit facts and inferred behaviour are separate named sections. Behavioural
summaries carry their `inferred_from_list_items` source, occurrence count, last
seen date and usual quantity; they are supporting evidence rather than facts.
Recommendation explanations should use this bounded evidence or the existing
decision traces without exposing internal prompt mechanics.

Current page/product context is not yet passed by the homepage Eve channel, so
Phase 6 does not manufacture it. It can be added later as a separately validated
channel attribute if a concrete use case warrants the extra context.

Decision-log addition:

- **2026-09-06 — Signed-in context is task-filtered, user-scoped and capped.**
  Eve receives a maximum 4,000-character application-authored data block only
  for authenticated subscribers; explicit facts remain separate from inferred
  evidence and context telemetry excludes household values.

## 26. Governed durable household memory

Phase 7 replaces the legacy whole-document shopping summary with a versioned
`household_memory.v2` contract in the existing `households.memory` JSONB field.
No production schema migration or backfill is required: legacy memory is
adapted on read and upgraded on its next governed write.

Durable memory has separate `explicit` and `inferred_products` maps. Explicit
facts are restricted to stable household composition, dietary, budget, store,
dislike and stopped-product keys; arbitrary temporary errands and values that
look like credentials, payment data, contact details or Irish PPS identifiers
are rejected. Each fact records source and timestamps. Inferred product facts
record canonical product identity, usual quantity, likely replenishment
interval, recency, confidence and supporting observation count, and expire after
180 days without an observation.

Corrections overwrite one stable key while preserving its creation time.
Forgetting a product deletes its inference and writes a versioned tombstone. An
inference run records its start time and cannot restore a product tombstoned
after that time, closing the delayed-writer race. Explicit stopped products also
suppress inferred product memory. The authenticated household API exposes an
inspectable governed view and supports product-specific forgetting; Eve's
preference tool supports explicit stopped products and forgetting.

Household memory is deleted with its household row through the existing
`households.subscriber_id` `ON DELETE CASCADE` relationship. The API and agent
continue to scope all reads and writes to the authenticated subscriber ID.

Decision-log addition:

- **2026-09-06 — Durable memory is versioned, inspectable and forget-safe.**
  Explicit facts and inferred evidence have distinct provenance; inference is
  bounded by retention and cannot race a user deletion to restore forgotten
  product memory.

## 27. Behavioural evaluation release gate

Phase 8 adds a repeatable, fixture-backed domain-quality suite under
`src/lib/evaluations/**`. It covers 13 representative journeys: offer-led and
ordinary complete shops, a two-adult/two-child €120 shop, four dinners and
ingredients, a usual shop, reduction below €100 without removing essentials,
cheapest butter, contextual add, cereal replacement, a genuine Persil offer
watch, gluten-free and low-protein shops, and ambiguous staple-family search.

Every run scores the agreed 16 dimensions: intent, clarification, guest turns,
household and planning-period coherence, essential categories, quantities,
dietary compliance, product resolution, price and promotion truth, store
coverage, totals, retailer split, persistence/CTA and retailer-handoff truth.
Fixtures contain no account data and make no live retailer, Supabase, model or
Pepesto calls.

Critical deterministic failures block CI through the explicit
`npm run test:behavioural` step. The initial release threshold is zero critical
failures across every fixture and non-zero coverage for all 16 dimensions.
Household coherence, practical quantities and reasonable retailer split remain
visible as `review` scores and are not initially blocking because they require
qualitative judgment. Model scoring may later assist only those qualitative
dimensions; it must not replace deterministic truth or safety checks.

Baseline on 6 September 2026: 13/13 scenarios passed with zero critical
failures; all 16 scoring dimensions had fixture coverage. The first baseline run
caught and led to fixes for plural `dinners`, direct cereal replacement and
`low-protein` capability routing, plus an incorrect captured total.

Decision-log addition:

- **2026-09-06 — Critical behavioural regressions block deployment.** CI replays
  stored domain fixtures without paid/live dependencies; deterministic truth
  and safety thresholds block, while subjective quality is reported for review.

## 28. Legacy planner retirement

Phase 9 removes the final application caller of the legacy Anthropic planner and
deletes the exact `/api/plan` generation route, `src/lib/planner-agent.ts`, its
separate watch-agent dispatcher and the obsolete manual memory test script. The
deterministic `/api/plan/weekly`, `/api/plan/refresh` and `/api/plan/reprice`
features remain: they are not model routes and continue to support the weekly
dashboard and saved-list repricing.

The only live caller found was the signed-in `/dashboard/chat/[id]` page for
pre-Eve saved conversations. Those records are not deleted or rewritten. The
page now renders a read-only archived transcript and offers **Continue with
Eve**. Eve receives only the archive UUID, loads a subscriber-owned record with
the new `get_archived_conversation` tool, and receives at most the last 12 valid
user/assistant messages at 1,000 characters each. Historical text is explicitly
untrusted, while the linked structured saved list remains authoritative.
Quick actions and list-edit entry points now continue through Eve rather than
posting to the legacy route.

Price-history and price-change queries used by weekly planning, refresh,
watchdog and household briefings moved to
`src/lib/shopping/price-history.ts`. Current Eve tools preserve household
profile updates, catalogue-grounded validation, repricing, shop modification,
watch creation and saved structured-list behaviour. Markdown parsing remains
only in the explicitly named legacy import endpoint for historical planner
output; native Eve household-shop results do not depend on it.

Production evidence checked before removal: all 35 saved legacy conversations
were preserved and linked to a saved list; none had been updated in the prior
seven days, while nine had activity within 30 days. Vercel showed no exact
`/api/plan` log match in the available one-hour window; longer log retrieval was
unavailable due the account log-query limit. Source inspection found no other
runtime caller. Production retirement was verified after merge on 6 September
2026: Vercel deployment `dpl_Coq91LRKKx1GVLgtM9VJYF6W2xV4` built commit
`e04e3e1`, reached `READY`, attached the `supermarket.ie` and
`www.supermarket.ie` aliases, and had no runtime-error clusters after release.
The public homepage returned the current Eve household-agent experience.

Decision-log addition:

- **2026-09-06 — Eve becomes the sole interactive grocery-agent runtime.**
  Legacy transcripts remain readable and resumable through a bounded,
  subscriber-scoped adapter; the old prompt/model route has no application
  caller and is removed without deleting saved history or structured shops.

## 29. SuperValu refresh recovery — 10 September 2026

The scheduled SuperValu refresh completed at 05:31:58 UTC with 550/1,000
successful validations (55.0% coverage): 69 changed prices, 481 unchanged, 263
`direct_name_mismatch` failures and 187 `no_product_data` failures. All 1,000
requests fetched successfully, so the dominant fault was extraction/identity
handling rather than retailer transport. The preceding 7 September run had the
same shape (56.4%, 260 mismatches, 176 no-data), and 411 failed mappings were
repeated across those two runs.

Production evidence showed that the fallback metadata parser treated both
quote styles as terminators regardless of the attribute delimiter. This
truncated retailer titles such as `Ben's Original...`, `Flahavan's...` and
`10" Stonebaked...`, creating false identity failures. The Vercel-native direct
worker also omitted the older browser scraper's `__PRELOADED_STATE__` product
extraction, causing valid hydrated product records to fall through to weak
HTML price/name heuristics or `no_product_data`.

The repair keeps the trusted-price boundary fail closed and adds:

- delimiter-aware metadata attribute parsing;
- direct parsing of balanced JSON in SuperValu `__PRELOADED_STATE__` product
  and product-card records before weak HTML fallbacks;
- retailer SKU extraction and rejection when a fetched SKU conflicts with the
  resolved mapping;
- regression fixtures for apostrophes, inch marks, hydrated state and SKU
  mismatch;
- real failure-streak tracking from the most recent successful observation;
- refresh selection that keeps missing coverage first but places SuperValu
  mappings with two or more failures since their last success behind healthier
  gaps, so the same repair set does not consume every 1,000-product tranche.

Rows with a canonical size conflict remain rejected even when the stored
retailer title matches the fetched page. A stable retailer SKU proves which
retailer page was fetched; it does not prove that the page is an exact match for
the canonical product. Those rows require mapping repair rather than relaxed
acceptance.

Decision-log addition:

- **2026-09-10 — SuperValu failures are split into extraction defects and
  mapping repair.** Fix deterministic punctuation/hydration extraction, verify
  retailer SKU identity, and back off repeated repair failures without
  weakening exact-product or seven-day freshness rules.


## 30. Signed-in experience design alignment — 18 September 2026

A production visual review covered the authenticated Home, My Shop, Browse and
Household surfaces. The Home experience already reflected the current
household-agent direction, but the remaining signed-in routes mixed that design
with older catalogue/planner styling: cyan section labels and glows, a neutral
grey desktop navigation state, and legacy “AI planner” / “Checkout coming soon”
language.

The signed-in shell now uses the current green-led design tokens for active and
hover states. My Shop and Household use brand green for section hierarchy and
replace the legacy cyan decorative treatment with restrained green tonal
accents. Browse gains the same green-gradient contextual header used by the
authenticated experience and its CTA is framed around the supermarket agent and
the complete household shop.

The saved-shop handoff copy remains deliberately truthful. Until a retailer
adapter is actually available on the live saved-shop path, the UI says retailer
handoff is unavailable for that saved shop rather than implying checkout or
trolley population.

Decision-log addition:

- **2026-09-18 — Signed-in UI converges on the household-agent design.** Home,
  My Shop, Browse and Household share the green-led palette, tonal surfaces and
  agent vocabulary; legacy cyan planner styling and premature checkout language
  are removed from the principal authenticated journey.

## 31. State-aware signed-in Home — 18 September 2026

The authenticated Home now treats the persisted agent journey as the primary
workspace. When account-scoped Eve events contain a user turn, Home restores the
conversation directly. With no prior interaction, it opens with **Your agent is
ready**, the primary question and the existing fresh-shop starters. Redundant
page-level and section-level introductions are deliberately omitted so the
working surface begins at the top of Home.

The current-week summary remains available immediately below Eve as supporting
deterministic shopping state. Browse remains a primary signed-in navigation
route for direct product discovery and manual research; it supports rather than
competes with the active household-shop journey. Recent-shop links now use the
saved-list route's actual `list` query parameter.

Public and authenticated Home copy are intentionally separate. The public
guest agent retains **Ready when you are**, **Meet your supermarket agent** and
its broad discovery placeholder. The authenticated empty state uses **Your
agent is ready** and the household-oriented question. These variants are now
rendered directly from authenticated state rather than rewritten after render
by a DOM observer, preventing signed-in copy changes from leaking into the
public homepage.

Current persistence boundary: Eve's active event stream is transferred from
guest to account after sign-in and then stored per account on the current
device. Structured household shops continue to persist server-side through the
validated saved-list path. Do not describe the complete Eve transcript as
cross-device account storage until server-backed Eve event persistence exists.

Decision-log addition:

- **2026-09-18 — Persisted agent state leads signed-in Home.** A returning active
  journey resumes ahead of weekly status; an account with no interaction starts
  fresh, while Browse remains directly available in primary navigation. The
  runtime remains Eve internally, but signed-in customer copy calls it **your
  agent** rather than exposing that implementation name.
- **2026-09-18 — Public and signed-in agent copy are isolated.** Guest messaging
  remains **Meet your supermarket agent** while authenticated Home can use more
  household-specific wording; both are rendered explicitly without DOM text
  replacement.

## 32. Living Shop signed-in Home model — 18 September 2026

The next signed-in Home iteration makes the household shop a visible, evolving
product object beside the agent. The agent remains the primary place to express
intent; a **Living Receipt** shows only deterministic application state from the
current weekly plan and the latest validated saved shop.

Home derives three presentation states without asking the model to classify
them:

- **New:** no current-week validated shop, no current agent journey and no
  partial weekly plan;
- **In progress:** the agent journey or weekly plan has started, or the current
  saved shop still contains unresolved, unavailable or partially covered lines;
- **Ready:** a shop saved during the current week contains at least one item and
  every line is resolved.

The current-shop summary is built server-side from subscriber-owned
`saved_lists.items`. It exposes item count, selected-price estimate, unresolved
count and bounded line detail. It does not use hypothetical complete-retailer
totals as the household estimate, and it treats missing prices, unavailable
lines and partial coverage as attention states. Older saved lists remain
available under My Shop and recent activity but are not presented as this
week's active shop.

The receipt's action is **Review my shop** for a current saved shop. It does not
claim retailer selection, trolley population or checkout. Without a current
saved shop, its action returns focus to the agent. Home-state views and receipt
actions are instrumented without logging household contents.

Decision-log addition:

- **2026-09-18 — Signed-in Home uses a deterministic Living Shop state.** The
  visual shell may respond to agent continuity, but Ready status and receipt
  facts come only from subscriber-scoped weekly-plan and validated saved-list
  data; retailer execution remains outside this UI boundary.

## 33. Account-backed chats and Living Receipt controls — 18 September 2026

The Living Shop implementation extends the existing subscriber-owned
`conversations` records rather than introducing a second chat store. A signed-in
agent conversation is created after its first meaningful message and its Eve
events/session plus a bounded display transcript are updated after completed
turns. The latest account-backed agent chat resumes on Home; a requested chat ID
must belong to the current subscriber and be marked as an agent chat. **New
chat** clears only the active conversation. It does not clear household memory,
the weekly budget, saved shops or persistent watches.

The existing `/dashboard` history surface is now a primary **Chats** destination.
Native agent chats reopen in the signed-in Home workspace; legacy pre-Eve
conversations retain their bounded archive/continue path. Device-local storage
remains a resilience cache and guest continuity mechanism, not the source of
truth for signed-in chat history.

The Living Receipt also exposes two durable controls without changing their
underlying ownership model:

- the weekly budget can be edited inline and is saved to the subscriber's
  household record; the displayed remaining/over amount recalculates locally;
- active product watches are listed in the receipt and **Add a watch** routes the
  shopper into the agent, which still resolves and creates the persistent watch
  through the governed agent tools.

Conversation text does not implicitly become durable household memory. Budget
changes, watches and saved shops remain explicit structured writes, even when
they are requested inside a saved chat.

Decision-log addition:

- **2026-09-18 — Conversations organise the signed-in agent experience.** Chats
  save automatically at the account level, while household preferences, watches
  and shops remain separately governed durable objects; starting a new chat does
  not erase or recreate those objects.

## 34. Batched household-shop catalogue resolution — 19 September 2026

Production review found that complete household shops could show many **Needs
resolving** lines even when the named products existed in the canonical
catalogue and had trusted current offers. `present_household_shop` previously
validated only canonical product IDs supplied by the model. Generating a large
shop therefore depended on one `resolve_product`/`get_current_price` call per
line, while the shared turn budget allowed only ten expensive calls. Remaining
lines were intentionally submitted without IDs and appeared unresolved.

`present_household_shop` now performs bounded server-side batch resolution for
the entire proposal before grounding it. It derives safe alphanumeric search
seeds, queries catalogue products and the fail-closed `latest_prices` boundary
in chunks, preserves valid supplied IDs, replaces invalid supplied IDs only
when a safe match exists, and accepts either a unique exact canonical-name
match or a clearly separated high-scoring current-offer match. The model no
longer needs one catalogue tool call for every ordinary shop line.

The distinction between product identity and price coverage remains explicit:
an exact canonical product with no trusted current offer is now `unavailable`,
not `unresolved`. Ambiguous families such as generic milk remain unresolved
rather than being silently assigned to a variant. Existing trusted-offer,
freshness, exact-relationship, total and retailer-coverage gates are unchanged.
Complete-shop instructions send the full proposal directly to this batch
boundary and reserve individual catalogue calls for standalone product questions
or genuine ambiguity, avoiding redundant model-tool turns and token use.

Decision-log addition:

- **2026-09-19 — Complete-shop product resolution moved into the server-side
  presentation boundary.** Resolve all proposed lines in bounded batches and
  reserve **Needs resolving** for genuinely ambiguous or absent catalogue
  items; do not weaken canonical identity or trusted-price requirements.

## 35. SuperValu and Dunnes coverage observability — 19 September 2026

Retailer coverage is now measured independently of scrape transport success.
Private Supabase views expose current canonical-catalogue, mapping, trusted-live,
freshness, shopper-demand and category coverage for SuperValu and Dunnes, plus
their shared overlap. A private snapshot table captures the same business-level
metrics whenever a retailer run reaches a terminal state. The baseline at rollout
was 852 live SuperValu products (34.61%), 810 Dunnes products (32.90%), and 635
products live at both retailers (25.79% of the 2,462-product catalogue).

The authenticated scrape-health API and `/admin/data-health` now present these
metrics, category gaps, latest-run failure mixes and threshold alerts. The
existing scheduled watchdog includes coverage under 50%, dual-retailer coverage
under 40%, three-point regressions and prices due to expire within 24 hours in
its operational email. Supabase remains the system of record: the current data
volume and workload do not justify Snowflake, while snapshots provide a clean
future export boundary if analytical scale changes.

Live SuperValu samples established that most `no_product_data` results are HTTP
200 empty product shells for expired mappings, not parser failures. They are now
classified as `empty_product_state` so remapping can be measured separately.
Dunnes recovery now accepts the numeric product identity embedded in an existing
resolved URL when the stored SKU has drifted, but only after the existing name,
size and type safeguards pass. Search queries retain up to eight words instead
of five to reduce false `no_search_results`; no model calls were added and fuzzy
confidence thresholds were not lowered.

Decision-log addition:

- **2026-09-19 — Coverage is a first-class operational metric in Supabase.**
  Track trusted catalogue and demand coverage over time, alert on regressions,
  and repair retailer identities conservatively before considering a separate
  warehouse or model-assisted matching.


## 36. Retailer failure-recovery tranche — 19 September 2026

The first post-observability 1,000-product production runs completed degraded:
SuperValu validated 701/1,000 (70.1%) and Dunnes validated 698/1,000 (69.8%).
The resulting live trusted catalogue coverage was 1,553/2,462 (63.08%) for
SuperValu and 831/2,462 (33.75%) for Dunnes. SuperValu failures were 192
`empty_product_state` and 107 `direct_name_mismatch`; Dunnes failures were
168 `no_search_results` and 134 `no_confident_match`.

Failure samples showed a mix of deterministic false negatives and genuinely bad
stale mappings. Examples such as `Celery` versus `Dunnes Stores Fresh Celery`
should match after removing retailer boilerplate and normalising simple
inflections, while a chilli-pepper mapping pointing to a pakora must remain
rejected. Dunnes recovery now tries at most three de-duplicated retailer-owned
queries: stored retailer name, the product title encoded in the resolved URL,
and canonical name. The URL title is query evidence only; candidates still pass
the existing SKU, name, size and type safeguards. Failure records now retain the
queries and a bounded candidate sample for the next analysis tranche.

SuperValu direct-name validation now recognises simple singular/plural wording,
retailer boilerplate and retailer pack units such as piece, roll and box. A short
generic retailer mapping may accept a more specific variant only when every
meaningful expected word is present and both sides carry compatible explicit
size evidence. Size conflicts such as 500g versus 400g remain rejected.

No model calls or AI matching were introduced. A 150-product validation run
per retailer then selected only products that had failed in the preceding full
run. SuperValu recovered 27/150 previously failing mappings: 27 succeeded, 37
remained direct-name mismatches and 86 remained empty product shells. Dunnes
recovered 15/150: 13 of the previous no-confident-match cohort and two of the
previous no-search cohort. Live trusted coverage consequently moved to 1,580
SuperValu products (64.18%) and 846 Dunnes products (34.36%); demand-weighted
coverage moved to 81.07% and 68.05% respectively.

The targeted runs also exposed an observability distinction: their deliberately
failure-heavy 18% and 10% success rates are useful repair metrics but should not
replace the latest scheduled full-run health on the dashboard. Add explicit run
scope (scheduled full run versus targeted validation/canary) before relying on
`latest_run_status` for alerts. Empty SuperValu product shells remain a
separate remapping problem and are not made trusted by the name changes.

Decision-log addition:

- **2026-09-19 — Repair deterministic retailer false negatives before broader
  discovery.** Use bounded retailer-owned query variants and vocabulary
  normalisation with regression fixtures; keep stale/wrong mappings fail closed,
  retain diagnostic evidence, and validate on a small production tranche before
  another full refresh.

The follow-up validation route can replay an exact prior failure cohort by run
UUID. This prevents the standard coverage-priority selector from changing the
sample between recovery tranches, while retaining `targeted_validation` scope so
the result cannot replace scheduled full-run health.

## 39. Exact retailer recovery validation — 19 September 2026

The next recovery tranche was deployed through PRs #109 and #112 and validated
only against exact prior-failure cohorts. SuperValu retried 123 remaining
failures and recovered eight (6.50%). Dunnes first retried 135 remaining
failures and recovered four; diagnostics then exposed that `N Pack` versus the
same explicit `N x unit-size` notation was still being rejected. The narrow
correction retained single-item/multipack and variant safeguards, and an exact
replay recovered 22 of the remaining 131 failures (16.79%).

Live trusted coverage is now 1,588/2,462 (64.50%) for SuperValu and 872/2,462
(35.42%) for Dunnes. Demand-weighted coverage is 81.13% and 70.10%
respectively. Scheduled full-run health remains correctly anchored to the prior
1,000-product runs (SuperValu 70.10%, Dunnes 69.80%); the recovery results are
separately labelled `targeted_validation`.

The remaining exact cohorts are 115 SuperValu failures (51 empty search/product
states, 37 direct-name mismatches and 27 ambiguous remaps) and 109 Dunnes
failures (74 no-confident-match and 35 no-search-results). These should be
treated as stale/ambiguous mapping or discovery work, not resolved by lowering
confidence thresholds. No AI/model or paid-retrieval calls were introduced.

## 37. Retailer run-scope observability — 19 September 2026

`scrape_runs.run_scope` now distinguishes `scheduled_full`,
`targeted_validation`, `canary`, `catch_up`, `discovery` and `manual` work.
The regular Dunnes and SuperValu cron URLs explicitly declare
`scheduled_full`; filtered or sub-1,000 direct runs default to
`targeted_validation`, and operational catch-up dispatches declare `catch_up`.
A guard rejects attempts to label filtered or smaller runs as scheduled full.

The private current-coverage view, authenticated data-health API and scheduled
watchdog now use only the latest completed `scheduled_full` run for the primary
health signal. The latest non-scheduled run remains visible separately with its
actual scope and result. Coverage snapshots retain the scope of the run that
caused them, so targeted repair gains remain measurable without turning their
deliberately failure-heavy success rate into a false production-health alert.

After the production migration, the primary run health correctly returned to
the 19 September full runs: Dunnes 69.8% degraded and SuperValu 70.1% degraded.
The later 150-product validation cohorts remain separately recorded as
`targeted_validation`: Dunnes 10.0% and SuperValu 18.0%. Historical direct runs
of at least 1,000 products were backfilled as scheduled full; smaller direct
runs, canaries and discovery runs were classified separately.

Decision-log addition:

- **2026-09-19 — Scheduled scrape health is scope-aware.** A canary, catch-up or
  targeted failure cohort may update trusted coverage and its snapshot, but it
  cannot replace the latest scheduled full-run status used by dashboards and
  alerts.

## 38. Empty-shell remapping and pack-expression recovery — 19 September 2026

The post-validation diagnostics showed that Dunnes' remaining
`no_confident_match` cohort mixes genuine stale/wrong mappings with a narrow
false-negative class: the canonical name says `N Pack`, while the retailer title
states the same leading item count plus a total weight. The direct worker now
reuses the richer Dunnes pack parser for this case and accepts it only when both
sides expose the same item count. Single-versus-multipack changes, explicit size
changes and variant conflicts such as salted versus unsalted remain rejected.
Candidate diagnostics now include whether a price was actually returned, so an
identity failure can be distinguished from an unavailable search result.

SuperValu `empty_product_state` rows now enter a bounded retailer-owned remap
attempt. The worker issues at most two de-duplicated compact queries derived
from the stored and canonical titles, parses the existing Storefront product
card dictionary and constructs a new product URL from retailer name and SKU. A
mapping changes only when exactly one priced candidate passes the canonical
name/pack checks, or when one compatible candidate retains the same retailer
SKU. Multiple plausible variants remain unresolved. The replacement URL, SKU
and retailer title are persisted only through the existing successful product
finalizer; unsuccessful attempts retain bounded query/candidate evidence.

No AI matching, fuzzy-threshold reduction, browser extension, ScrapingBee or
Pepesto credit was introduced. Validate this tranche on the previous failure
cohort before another scheduled 1,000-product run.

Decision-log addition:

- **2026-09-19 — Repair empty shells through unique retailer-owned evidence.**
  A search result can replace an expired SuperValu product identity only when
  canonical identity and pack constraints leave one safe priced candidate;
  ambiguous families stay unresolved.

## 40. Retailer-owned mapping cleanup — 19 September 2026

Live inspection confirmed that SuperValu exposes a Storefront JSON search
gateway at `storefrontgateway.supervalu.ie/api` for store `5550`. The previous
recovery parsed server-rendered search state, but the public HTML did not
populate that state and therefore produced false empty searches. The direct
worker now consumes retailer-owned JSON search results for empty product shells
and incompatible/stale direct mappings. It still requires one canonical- and
size-compatible priced candidate, with a same-SKU preference; ambiguous
families remain unresolved.

Dunnes known-SKU recovery now permits retailer merchandising words around a
generic stored title only when the candidate matches the stored or URL SKU and
contains every meaningful canonical product term. Existing size, pack, food
type and variant guards remain mandatory. This safely covers title expansions
such as `Baby Corn 145g` while continuing to reject stale links such as chilli
peppers mapped to a pakora product. Neither path uses an AI/model or paid
retrieval service. Production impact remains pending exact-cohort validation.

The production dispatcher has two immutable, owner-authorized operations for
that validation: `[ops] SuperValu mapping discovery validation` replays the 115
failures from run `a40142ef-2448-4c54-b477-b6cc4d77a2e7`, and `[ops] Dunnes
mapping cleanup validation` replays the 109 failures from run
`d75b1dc5-d497-4f11-a32b-7f378cdd35af`. Both remain scoped as
`targeted_validation` and do not replace scheduled full-run health.

### Production validation result

Both immutable operations completed against their exact cohorts. SuperValu run
`3f359792-3929-4778-a9af-9c9ae10022ae` recovered 6/115 mappings (five updated
prices and one unchanged price), leaving 109 failures: 57
`no_confident_remap`, 51 `empty_product_state` and one
`direct_name_mismatch`. Dunnes run
`6c30c0f8-2601-4ade-a371-c8ed5ebf5a56` recovered 23/109 mappings (three
updated and 20 unchanged), leaving 86 failures: 51 `no_confident_match` and 35
`no_search_results`.

Live trusted coverage is now 1,594/2,462 (64.74%) for SuperValu and 895/2,462
(36.35%) for Dunnes. Demand-weighted coverage is 81.56% and 72.51%
respectively. Scheduled full-run health remains 70.10% for SuperValu and 69.80%
for Dunnes; both mapping runs remain separately scoped as
`targeted_validation`. The one-shot authorization issues were closed after use.

Live retailer probes of the 35 Dunnes `no_search_results` residuals found that
the catalogue still contains some exact products, but the Storefront search API
returns no items for their full merchandising title. A single additional
compact query now removes size and bounded merchandising filler while retaining
the first five meaningful canonical product terms. Returned candidates still
pass the existing SKU, size, pack, type and variant safeguards; the compact
query does not itself authorize a mapping.

The immutable `[ops] Dunnes compact discovery validation` operation replays
only the 86 failures from run `6c30c0f8-2601-4ade-a371-c8ed5ebf5a56` with
`targeted_validation` scope.

Production run `4fe56cf5-5501-45fa-8f7e-5aff7785a2a6` recovered 18/86 of that
cohort (12 updated prices and six unchanged). Dunnes live trusted coverage is
now 913/2,462 (37.08%) and demand-weighted coverage is 74.44%. The 68 residuals
are 55 `no_confident_match` and 13 `no_search_results`; automated matching must
stop for the ambiguous set. Scheduled full-run health remains 69.80%.

## 41. Demand-ranked manual product resolution — 19 September 2026

After bounded retailer-owned recovery, ambiguous products must not be forced
through weaker matching. The admin data-health surface now includes a private
resolution queue built from each retailer's latest targeted failure cohort and
ranked by actual list demand. Captured retailer candidates expose explicit
`Choose product`, `Mark unavailable` and `Skip` decisions.

Resolution decisions are audited in `product_resolution_decisions`, protected
by RLS and service-role-only grants. Exact selection is accepted only when the
chosen SKU appears in the captured retailer evidence; the atomic resolver then
updates the retailer identity and writes the observed direct-retailer price.
Unavailable mappings leave trusted refresh selection. Alternatives remain in
their separate candidate table and are never silently promoted by this queue.

## 42. Product-resolution hardening and residual classification — 19 September 2026

The 177-record SuperValu/Dunnes residual was classified before any further
mapping changes. The conservative classification produced 65 retailer
search/query failures, 51 variant/size/pack conflicts, 38 insufficient-evidence
records, 15 poor or underspecified canonical identities and only eight
same-SKU exact candidates. No record has enough repeated independent evidence
to be labelled a genuine retailer absence.

The resolution path now derives candidate name, URL and price from captured
retailer evidence on the server rather than trusting browser fields. Automatic
eligibility requires the existing retailer SKU, complete canonical product
signals, exact explicit measure and pack count, no candidate-side or
canonical-side variant conflict, and corroboration from the stored retailer
title. Generic canonical phrases embedded in a different product do not
qualify. The database verifies the complete evidence tuple and retailer
URL/SKU before updating mapping or price state.

The `unavailable` action is disabled until repeated independent discovery
evidence is modelled. The admin queue remains an internal audit/exception
surface and offers an apply action only for server-validated exact candidates.
Canonical identities such as `Cornflakes`, `Deodorant Roll-On`, `Snackpack`,
`Stripes` and `Stackz` are product-policy/data-quality work, not candidates for
relaxed matching. Obvious stale mappings must be cleared or rediscovered
without renaming a generic canonical product to the arbitrary retailer item it
happened to reference.

The first eight strict exact Dunnes decisions raised live trusted coverage from
913 to 921 products (37.08% to 37.41%) and demand-weighted coverage from 74.44%
to 74.50%. A fresh targeted run showed that these products still failed the
older Dunnes worker's separate identity heuristic. The worker therefore reuses
the same stricter exact-identity predicate so accepted resolutions remain
refreshable after the initial seven-day observation. This applies only to
same-SKU candidates and does not widen the fallback similarity matcher.

Production verification run `e878ac5f-4242-4856-aaa2-cd0333b5aeb3`
subsequently refreshed 26/86 products, exactly eight more than the preceding
18/86 replay. All 26 were unchanged retailer prices and 60 remained unresolved,
confirming that the eight audited decisions now survive the ordinary Dunnes
refresh path. The live trusted figures remain 921/2,462 (37.41%) and 74.50%
demand coverage because the replay refreshed existing observations rather than
adding mappings. The current unresolved queue is 169 products: 60 Dunnes (47
`no_confident_match`, 13 `no_search_results`) and 109 SuperValu (57
`no_confident_remap`, 51 `empty_product_state`, one `direct_name_mismatch`).

SuperValu replay `39dd552a-1640-40f6-bdeb-98d20edbc89d` attempted 112 legacy
failure-cohort records, with three successful observations (two unchanged) and
109 failures. It did not change live trusted coverage, which remains
1,594/2,462 (64.74%) and 81.56% demand coverage. This confirms that the
remaining SuperValu cohort needs better canonical data or new retailer evidence,
not another pass with the same queries.

## 43. Retired browser-based data-health page — 20 September 2026

The `/admin/data-health` browser page has been removed. It was an internal
exception-handling interface and is no longer part of the operating workflow;
product resolution remains an autonomous, evidence-gated process. The page was
not present in public navigation or the sitemap and carried `noindex` metadata
while it existed. Its removal now makes the URL return the standard not-found
response.

The protected admin APIs, resolution audit table, queue view and atomic resolver
remain in place for developer-operated diagnostics and audited technical
operations. Removing the browser page does not change retailer discovery,
coverage calculation, matching safeguards or price refresh behaviour.

## 44. Pepesto account identity and blocked Tesco refresh — 20 September 2026

An owner-authorised 250-product Tesco refresh reached the protected production
dispatch but submitted no products and spent no credit. Pepesto reported a
balance of 16 cents and rejected the first `/search` request with HTTP 400
(`no products specified`). Run `pepesto_tesco_20260920100817` is recorded as
failed with a target of 250, zero submitted and zero actual cost. Tesco remains
outside `latest_prices` until a successful exact-SKU refresh produces current
observations.

Pepesto bootstrap linking now identifies the account only by
`colin@supermarket.ie`; the optional `Supermarket` alias has been removed from
future `/link` requests. This does not expose, delete or silently rotate the
existing Vault credential. Reconcile that stored credential with the funded
Pepesto account and revalidate the current `/search` contract before retrying
the paid refresh.

## 45. Funded Pepesto relink and Tesco refresh — 20 September 2026

The Pepesto credential was explicitly relinked using only
`colin@supermarket.ie`. The replacement key passed `/credits` validation before
the Vault value was changed, and the funded account reported 2,990 euro cents
(€29.90). No API key was exposed.

Pepesto's current `/search` contract uses a singular comma-separated `product`
string rather than the former `products` array. PR #138 updated the adapter to
that documented contract while retaining ten-product batching and the exact
retailer-SKU acceptance gate. A corrected ten-product canary submitted 10/10,
cost 12 cents and recovered one exact unchanged price.

Production run `pepesto_tesco_20260920103339`
(`c8812c38-678b-4346-8580-3cf14023ea3e`) then submitted and retrieved all 250
requested products across 25 sessions. Credits moved from 2,978 to 2,678 euro
cents: an actual cost of €3.00, exactly 12 cents per batch. Nineteen exact-SKU
prices were accepted: six newly inserted observations and 13 unchanged current
prices. The other 231 results failed the exact-SKU gate and were not mapped.
The run is recorded as `failed` only because 7.60% exact recovery is below the
existing 70% health threshold; submission, retrieval and spend accounting all
completed. `latest_prices` now contains 19 fresh Tesco rows, bringing Tesco
back into the live dataset without weakening matching rules. Remaining Pepesto
balance is €26.78.


## 46. Tesco preferred-products coverage gain — 20 September 2026

Pepesto's preselected `/catalog` endpoint returned no rows for existing Tesco
Ireland product URLs in two 50-product canaries; each cost 96 cents. The
250-product catalog operation was therefore not released. The cached
`/products` endpoint was then integrated with multi-line product requests and
existing Tesco URLs supplied as preferences. Returned candidates remain subject
to an exact stored retailer-SKU gate across the complete batch, so omitted or
reordered Pepesto items cannot cause positional mis-mapping.

The corrected 50-product canary recovered 19 exact products for 32 cents.
Production run `pepesto_tesco_20260920121121`
(`1d49106a-848f-4cf8-8f37-d2c173b810ec`) then attempted 250, returned 171
Pepesto items and accepted 64 exact Tesco SKUs for €1.60. The other 186 were
safely rejected. Across the funded work, fresh Tesco coverage initially increased from 19 to 106 products. A second
250-product preferred-products run (`22304113-97c9-4dff-bd83-94f480b0b71d`)
added 12 more exact prices for €1.60 before further identical retries were
stopped for diminishing returns. Final fresh Tesco coverage is 118/2,462
(4.79%), a 6.21x increase from the first successful run. Demand-weighted Tesco
coverage is 845/1,659 units (50.93%). The remaining Pepesto balance is €21.02.

## 47. Queue-backed exact Tesco direct canary — 20 September 2026

Tesco direct recovery now has a separate `exact_direct_canary` queue mode. The
trigger creates a durable canary run and returns HTTP 202 with its run UUID
immediately; all 20 demand-ranked unresolved exact mappings are processed by
the existing Vercel Queue consumer. This path makes no Pepesto or ScrapingBee
request.

The canary fetches only each stored Tesco product URL. It records requested and
final URL, expected and returned SKU, retailer title, price, availability, HTTP
status and a bounded failure classification. A price is accepted only when the
SKU in the final Tesco URL exactly equals the stored SKU. There is no fuzzy
search fallback and no alternative SKU can update a mapping in this mode.

Evidence is retained in the private, RLS-protected
`tesco_direct_canary_results` table, with a service-role-only run summary for
exact recovery and failure-reason reporting. `retailer_coverage_current` now
includes Tesco, and `main_retailer_comparison_coverage_current` reports products
covered by at least two and by all three main retailers. Production canary
results and any decision to scale remain pending deployment verification.

The production canary stopped on its first exact stored URL with HTTP 403 and
classified the response as an access challenge. The Vercel Dublin egress was
quarantined and direct retrieval was not scaled. No Pepesto credit was used.

## 48. Untouched Pepesto products cohort — 20 September 2026

Receipt analysis showed that the two 250-product preferred-URL runs overlapped
on 186 mappings, including 179 repeated non-successes. Repeating the same
selection was therefore the cause of much of the diminishing return. There are
2,104 unresolved exact Tesco mappings that no preferred-products run attempted;
558 of these already have fresh trusted prices at both other main retailers.

The products canary now selects up to 50 mappings from this untouched cohort,
preserving the existing demand/overlap ranking and exact stored-SKU acceptance
gate. It publishes one durable queue message and returns the run UUID
immediately. The paid response, cost and progress are persisted in a private
service-role-only batch table so queue redelivery can resume finalisation
without intentionally repeating the paid request. This does not use direct
Tesco retrieval or any legacy proxy integration.

Production run `pepesto_tesco_20260920143901`
(`97f092ea-8cd6-49ed-bd04-a3ce7545c751`) processed all 50 untouched mappings
asynchronously. Pepesto returned 22 shopping-list items but no candidate with
an exact requested stored SKU. All 50 were safely rejected, the run cost 32
cents and the balance moved from €21.02 to €20.70. The returned evidence shows
that `/products` ignored the preferred URLs for this residual cohort and fell
back to broad name alternatives. Do not scale or repeat this cohort.

The canary also exposed a pre-existing Tesco mapping-integrity issue. Across
the catalogue, 325 Tesco SKUs are assigned to more than one canonical product
(742 mapping rows). Current Tesco coverage contains 118 canonical rows but 114
unique retailer SKUs. Some duplicates are catalogue synonyms, while others are
materially invalid (for example red chilli mapped to a red bell pepper SKU).
Exact response-SKU matching cannot repair a bad stored mapping: Tesco mapping
identity must be audited and invalid rows cleared or re-resolved before further
coverage spending. No returned alternative may be promoted without full brand,
type, variant, size and pack agreement.

## 49. Tesco mapping risk audit baseline — 20 September 2026

A read-only production audit introduced a deterministic Tesco identity
classifier covering URL/SKU corroboration, brand and own-label status, product
type, variant, explicit measure, pack count, fresh/frozen state, material
formulation and generic canonical identities. Duplicate-SKU status is a risk
signal only: a group cannot be called a synonym without complete group-level
identity corroboration.

The live baseline remains 118 fresh canonical rows and 114 unique fresh Tesco
SKUs, but at least 12 current rows have deterministic material conflicts. These
include red chilli mapped to a bell pepper, 250g mushrooms mapped to 300g,
180g Muller Rice mapped to 170g, several pack-count conflicts, branded
canonicals mapped to Tesco or another brand, pizza mapped to a baguette,
semolina pasta mapped to flour and yogurt mapped to a yogurt drink. No mapping
or price was changed during this pass.

All 325 duplicate-SKU groups (742 mapping rows) were enumerated. Only one group
has the same normalised canonical term set, and it still fails brand/own-label
corroboration, so no group is yet accepted automatically as a genuine synonym.
Within fresh coverage, 29 rows use a SKU duplicated elsewhere in the catalogue.

The persisted evidence from Pepesto run
`97f092ea-8cd6-49ed-bd04-a3ce7545c751` was reused without another paid request.
None of its alternative SKUs passed the strict exact-replacement test. The next
step is to complete row-level classification of the non-equivalent duplicate
groups and the remaining fresh title-review cohort, then prepare a reversible
deterministic invalidation set before recalculating corrected coverage.

## 50. Tesco deterministic repair set — 20 September 2026

The row-level read-only audit is complete for all 29 fresh rows whose Tesco SKU
is duplicated elsewhere and all 23 fresh unique-SKU rows whose retailer title
does not contain every canonical term. The combined repair set contains 26
fresh material mismatches. It extends the first 12-row result with plain oil for
chilli-infused oil, onions versus breaded onion rings, powder versus granules,
wholemeal/free-range/organic substitutions, conflicting brands, yogurt
variant/pack changes, oyster versus boneless chicken thighs and materially
different fruit variants.

If all 26 mappings are invalidated, Tesco trusted coverage will correct from
118 to 92 canonical products and from 114 to 91 unique SKUs. Catalogue coverage
will move from 4.79% to 3.74%; using the current 1,681-unit demand denominator,
demand-weighted coverage will move from 50.86% to 38.13%. Main-retailer overlap
will correct from 803 to 794 products with at least two live retailers and from
78 to 67 with all three.

The prepared migration introduces a private, RLS-protected
`retailer_mapping_audit_decisions` table. Each repair stores the complete prior
mapping identity, current-observation timestamp, classification, reason and
evidence source before changing `url_status` to `failed`. SKU, URL, title and
historical observations remain intact. The mutation is guarded by the stored
identity so it cannot invalidate a mapping changed after the audit. A full
production transaction dry-run completed and was rolled back before release.

PR #171 then passed CI and preview verification and was merged at commit
`b7507cb90931143cd1e1d919fdea17c368aa33d2`. Production deployment
`dpl_5vZFcKCa6jUpxfcWL3po34RVZKZ7` reached `READY`, after which the audited
Supabase migration was applied. Verification found 26 decisions and 26 applied
actions, 26 audit-failed mappings and zero audited mappings leaking through
`latest_prices`.

The corrected live result exactly matched the dry-run: 92 trusted Tesco
canonical products, 91 unique SKUs, 3.74% catalogue coverage and 641/1,681
demanded units (38.13%). Main-retailer overlap is now 794 products at two or
more retailers and 67 at all three. Supabase advisors showed no new unindexed
foreign key; the private audit table intentionally follows the existing
service-role-only RLS-without-user-policy pattern. Vercel reported no recent
production runtime errors.

## 51. Strict Tesco candidate-discovery canary — 20 September 2026

The next Tesco recovery path is deliberately different from the exhausted
multi-product `/search`, `/catalog` and preferred-URL `/products` retries. It
selects only mappings invalidated by the deterministic audit and submits one
canonical identity per Pepesto search session. This removes positional
attribution guesses and caps each operator-confirmed request at five products.
Following explicit approval for more testing, observed same-day discovery spend
is capped at €1.20 by default.

Every candidate returned by `/retrieve` is persisted in the private,
service-role-only `tesco_candidate_discovery_evidence` table, including its raw
payload, URL/SKU, title, price, deterministic signals and classification. A
zero-candidate session is still remembered through the durable session record
and is not selected again automatically.

The replacement gate is stricter than the existing exact-stored-SKU refresh
gate. A new Tesco SKU may be applied only when exactly one distinct candidate
has a corroborated Tesco product URL/SKU, positive observed price, complete
canonical terms, exact explicit brand, size and pack agreement, and no product
type, variant, own-label, fresh/frozen or formulation conflict. Mapping repair,
price observation, audit decision and run accounting are committed atomically
by a service-role-only database function. Ambiguous, incomplete and conflicting
candidates remain evidence only.

The schema was executed successfully inside a production transaction and
rolled back before release, then applied after PR #173 passed verification and
production deployment reached `READY`.

The first three-product production submission cost 36 cents, but persisted
evidence showed that discovery had incorrectly inherited the ordinary refresh
query preference and sent each obsolete stored Tesco title instead of its
canonical identity. Five returned candidates simply reproduced or varied the
invalid mappings; all were rejected and no mapping or trusted price changed.
This is not a valid discovery-yield measurement. Candidate discovery now
explicitly queries the canonical name, with a regression test that preserves
stored-title preference only for ordinary exact-SKU price refreshes. The
operator endpoint has no same-day guard; its default observed-spend cap is
€1.20 and an optional run-count limit is available for one-shot scheduling.

The corrected canonical-query run
`pepesto_tesco_discovery_20260920191847`
(`36a98b6a-a0fd-4125-85f0-c62a87ddd25f`) submitted three independently
attributed searches for 36 cents. Credits moved from €20.34 to €19.98. It
returned exactly one candidate per query and recovered 0/3 exact replacements:
Fyffes loose bananas still returned the Tesco own-label SKU, the 180g Muller
canonical still returned the invalidated SKU without corroborating size
evidence, and Fitzgeralds wraps still returned H.W. Nevills wholemeal wraps.
All three were rejected and no mapping or trusted price changed.

Together, the invalid first run and corrected run cost 72 cents and produced
zero safe recovery. The temporary schedules were removed after each bounded
submission. Even with additional spend authorised, do not repeat this search
strategy across another cohort: corrected canonical queries still reproduce
the obsolete stored alternatives rather than discover defensible new SKUs.

## 52. Tesco Pepesto yield reconciliation — 20 September 2026

The apparent fall from 397/500 exact matches on 5–6 September to 19/250 on
20 September was primarily a request-shape failure, not loss of Pepesto's
Tesco transport. The historical `/search` contract accepted a `products`
array and returned ten independently attributable items for each ten-product
session. The current contract accepts a singular free-text `product` field.
When ten stored titles were joined into that field, each session returned only
one item: 25 sessions therefore produced 25 items for 250 nominal products,
and the other 225 were misleadingly finalised as failed despite never having
an independently returned result.

The old headline also requires an identity qualification. Exact response-SKU
matching proved agreement with the stored mapping, not agreement between that
mapping and the canonical product. The old cohort contains known material
mismatches. It must not be blindly reactivated.

The ambiguous legacy multi-product submission endpoint is retired. The shared
search adapter permits exactly one product per session, preserving attribution
for both trusted price refresh and bounded candidate discovery. `/search`
followed by the asynchronous `/retrieve` collector is the validated Tesco
price-refresh path. The synchronous `/products` route is not an operational
Tesco refresh route.

A new `proven_search_success` products cohort recovers only stale mappings
from historical Pepesto sessions that returned one item per requested product,
had a successful receipt, remain resolved, and pass the deterministic
canonical identity classifier including duplicate-SKU checks. Fresh mappings
are excluded. Selection remains demand-ranked, is capped at 50, requires an
explicit `proven-products-canary` confirmation, and supports a zero-credit
`dry_run=true` inspection before any queue message or Pepesto request is
created.

## 53. Tesco Pepesto search golden path restored — 20 September 2026

The corrected one-product-per-session `/search` canary returned 8 exact Tesco
SKU matches from 10 products. It cost 120 cents, moving the Pepesto balance
from €19.66 to €18.46. Two non-matches were rejected. This is consistent with
the earlier 397/500 exact-SKU baseline and confirms that the poor 2/50 result
from `/products` was specific to the wrong retrieval route, not a general loss
of Pepesto viability.

The single production operation is now `[ops] tesco pepesto search refresh`,
which targets `/api/workers/pepesto-tesco-search-refresh`. It requires explicit
confirmation, submits one product per search session, records observed credits
before and after, enforces a per-run spend ceiling and leaves result collection
to the existing ten-minute `/retrieve` worker. Paid submission remains manual;
there is no persistent paid schedule.

`/products`, `/catalog`, candidate-discovery and direct Tesco experiments are
not exposed as normal production refresh operations. The legacy ambiguous
submission endpoint returns `410` and points only to the search-refresh route.
The query builder and submitter both reject multi-product search requests, and
a regression test locks this attribution rule in place.

Operational confidence must remain split into two measures: exact response-SKU
agreement establishes product identity, while price freshness is a separate
claim. The 8/10 canary repeated the same numerical prices observed on
6 September, and four promotion flags lacked a corresponding previous price;
therefore freshness and promotion evidence require separate monitoring and
must not be inferred from SKU agreement alone.

## 54. Proven Tesco search refresh batches — 20 September 2026

The restored one-product-per-session Pepesto `/search` path was scaled through
two bounded production operations after the corrected 8/10 canary. PR #187
scheduled the first 50-product batch; run
`pepesto_tesco_search_20260920214644`
(`bd1fef45-3a4a-4652-8f92-69b37ebdccc1`) accepted 40 exact stored SKUs and
safely rejected 10. Observed credit moved from €18.46 to €12.46, an actual cost
of €6.00. Corrected fresh Tesco coverage increased from 102 after the earlier
paid experiments to 142/2,462.

PR #189 scheduled the requested next batch with the same 50-product and €6.00
ceilings. The identity-audited stale proven-success selector contained only 20
eligible products, so the operation submitted those 20 rather than broadening
into unproven mappings merely to fill the limit. Run
`pepesto_tesco_search_20260920222204`
(`e8678d31-2aed-4510-8148-fd085277cc13`) fetched all 20 in the next collector
pass, accepted 14 exact stored SKUs and safely rejected six. The run succeeded
at 70% yield. Credits moved from €12.46 to €10.06, an actual cost of €2.40.

The second operation added 14 distinct `pepesto_search` observations and
brought fresh trusted Tesco coverage to 156/2,462 (6.34%). Across the two scaled
batches, 54/70 products were accepted (77.14%) for €8.40. The six residual stale
products from the second operation remain ineligible for trust without a future
exact response; do not immediately repeat them merely to spend the remaining
balance. Price freshness remains a separate confidence dimension from exact SKU
identity. The fixed-date paid triggers were removed after collection; there is
still no persistent paid Tesco schedule.

## 55. Audited untried Tesco search cohort — 21 September 2026

After the two scaled corrected-search batches, the original stale
`proven_search_success` pool had been consumed apart from six products rejected
in the latest run. Repeating those six immediately would likely repay for the
same alternatives, so the selector now continues into a new safety-preserving
cohort instead.

Selection still prioritises independently attributable historical exact-search
successes. If fewer than the requested limit remain, it then fills from resolved,
stale Tesco mappings that pass the deterministic canonical identity audit as
`obsolete_mapping` or a fully corroborated `exact_synonym_duplicate`. Products
already tried by the corrected one-product workflow are ranked behind untried
audited mappings, including sessions that returned no item. This avoids immediate
paid retries while allowing future refresh once the broader untried pool is
eventually exhausted.

The response acceptance contract is unchanged: one product per Pepesto
`/search` session, asynchronous `/retrieve`, and an exact stored Tesco SKU in
a corroborated Tesco product URL before any price observation is trusted. The
fallback does not repair mappings, accept alternative SKUs or weaken brand,
variant, size, pack, formulation or duplicate-SKU safeguards.

## 56. Audited Tesco search scale validation — 21 September 2026

PR #191 deployed the audited-untried selector and PR #192 released one bounded
50-product operation through the corrected one-product-per-session `/search`
route. Run `pepesto_tesco_search_20260921172137`
(`b1333407-f9b3-40c1-b99a-a8d76d0aa615`) retrieved all 50 sessions, accepted
46 exact stored Tesco SKUs and safely rejected four. The run succeeded at 92%
yield. Credits moved from €10.06 to €4.06, an actual cost of €6.00.

Fresh trusted Tesco coverage increased from 156 before the operation to
202/2,462 (8.20%). Demand coverage is 836/1,681 units (49.73%). Across the main
retailers, 1,800 canonical products now have at least one live price, 841 have
at least two and 120 have all three. The fixed-date paid trigger was removed
after completion.

The validated next recovery tranche is 250 audited, previously untried
products, released as five separately accounted 50-product runs with a €6.00
ceiling each. At the currently observed 12 cents per product this requires
about €30; require a live balance of at least €35 before release and continue
to record actual before/after credit rather than treating that observation as
a permanent tariff. At the latest 92% yield, 250 products would add about 230
trusted prices and bring Tesco to roughly 432/2,462 (17.55%), but this is a
planning estimate rather than a promised result.

The `/retrieve` worker now checks up to 50 sessions per ten-minute pass instead
of 20 and has a 300-second runtime allowance. This reduces expected collection
for the five-batch tranche from roughly 130 minutes to about 50 minutes without
changing candidate extraction, exact-SKU acceptance, finalisation or failure
handling. Paid submission remains manual and no persistent Tesco paid schedule
is installed.

## 57. Tesco 250-product recovery tranche — 21 September 2026

A live zero-spend balance check confirmed €33.96 before release. PR #195 then
scheduled five separately accounted 50-product operations through the validated
one-product-per-session Pepesto `/search` route. All 250 distinct audited,
previously untried candidates were submitted and retrieved successfully:

- `pepesto_tesco_search_20260921204248`
  (`23aab187-26d8-486d-a700-147f2779e1e9`): 47 accepted, 3 rejected.
- `pepesto_tesco_search_20260921204518`
  (`a1463436-ba28-45df-8c62-1bc119618792`): 45 accepted, 5 rejected.
- `pepesto_tesco_search_20260921204823`
  (`ee2d8bee-235f-4974-96ec-8b16b141b65c`): 47 accepted, 3 rejected.
- `pepesto_tesco_search_20260921205127`
  (`f868643a-0325-49e9-b556-4433317f3577`): 46 accepted, 4 rejected.
- `pepesto_tesco_search_20260921205442`
  (`b1c79adc-74bc-4138-88a2-320f70d31924`): 39 accepted, 11 rejected.

The tranche accepted 224/250 exact stored Tesco SKUs (89.6%) and safely
rejected 26. All 250 Pepesto sessions returned and no retrieval session failed.
Observed credits moved from €33.96 to €3.96: €30.00 actual spend, exactly
matching the aggregate five-run ceiling.

Fresh trusted Tesco coverage increased by the same 224 products, from
202/2,462 (8.20%) to 426/2,462 (17.30%). Demand coverage remained
836/1,681 units (49.73%), showing that this tranche repaired audited catalogue
gaps rather than the currently demanded subset. Across the three main
retailers, products with at least one live price increased from 1,800 to 1,828,
at least two from 841 to 939 and all three from 120 to 218.

PR #196 removed all five fixed-date paid triggers immediately after submission;
the cleanup deployment reached production before retrieval finished. The free
ten-minute `/retrieve` worker completed the queue. There is no persistent paid
Tesco schedule. Exact response-SKU agreement continues to establish identity
only; price freshness remains a separate confidence measure.


## 58. Demand-first Tesco mapping-repair tranche prepared — 21 September 2026

The completed 250-product refresh lifted Tesco catalogue coverage but did not
change demand coverage. A live audit found 163 missing-demand Tesco mappings.
Only 19 were untried mappings with basic URL/SKU evidence, and deterministic
identity review rejects that apparent pool because the stored Tesco identities
contain material brand, product, formulation, measure or pack conflicts.
Repeating the normal refresh selector would therefore continue into
zero-demand catalogue gaps rather than safely improve household-list coverage.

The next safe tranche is instead the remaining 20 untried mappings already
invalidated by the deterministic risk audit. All 20 are tied to current demand,
representing 67 demanded units. Candidate discovery searches by canonical
identity, persists every candidate, and permits a mapping and price update only
when one exact replacement SKU passes the full brand, type, variant, measure,
pack, formulation and URL/SKU checks.

The protected candidate-discovery route now supports an explicit
`demand_only=true` cohort of up to 20 products, a caller-supplied spend ceiling
hard-limited to 240 cents, and `dry_run=true` inspection before any run, credit
lookup or Pepesto request is created. At the currently observed 12 cents per
one-product search, the complete tranche is expected to cost €2.40. Treat that
as a bounded current-tariff estimate and continue recording actual credits
before and after the run. No paid schedule is installed.


## 59. Demand-first Tesco mapping-repair result — 22 September 2026

PR #199 released the prepared 20-product demand-only candidate-discovery
tranche. Run `pepesto_tesco_discovery_20260922114211`
(`3240abfb-78b6-4037-bf4c-68a2b128dee6`) submitted and retrieved all 20
one-product Pepesto search sessions. Credits moved from €3.96 to €1.56, an
actual cost of €2.40 matching the run ceiling.

The operation persisted 40 candidate rows across 16 products; four products
returned no candidates. Nineteen candidate rows across eight products were
material mismatches and 12 rows across nine products were ambiguous. Two
products produced nine individually exact-looking candidates, but each had
multiple qualifying SKUs: seven materially different chicken-thigh products
for the underspecified `Chicken Thighs` canonical and both white and wholemeal
six-pack pitta for `Pitta Bread 6 Pack`. The single-SKU finalisation rule
correctly rejected both groups rather than guessing a variant.

No mapping or price was accepted. Tesco coverage therefore remained
426/2,462 (17.30%) and demand coverage remained 836/1,681 units (49.73%).
The 20 products are now recorded as attempted discovery evidence and must not
be repaid for without new deterministic identity evidence or a canonical
product-definition repair. PR #200 removed the fixed-date paid trigger after
submission; no persistent paid Tesco schedule remains.

## 60. Deterministic canonical repair from persisted Tesco evidence — 22 September 2026

The 20-product demand-first evidence was reconciled against Dunnes and
SuperValu identities without another Pepesto request. Only `Pitta Bread 6
Pack` had enough cross-retailer evidence for a deterministic repair: the
existing SuperValu SKU/URL explicitly identifies the product as white pitta,
which resolves the otherwise ambiguous white-versus-wholemeal Tesco pair.

The canonical is clarified to `White Pitta Bread 6 Pack`, including its eight
existing list-item units. Tesco is restored to exact SKU `254945564`, `Tesco
White Plain Pitta Bread 6 Pack`, with the persisted €0.88 observation from run
`3240abfb-78b6-4037-bf4c-68a2b128dee6`. The wholemeal SKU is retained as
rejected evidence with an explicit variant conflict, and the prior mapping is
preserved in `retailer_mapping_audit_decisions`.

The other 19 products remain unresolved because their persisted candidates do
not prove exact brand, type, variant, measure, pack or formulation identity.
No further Pepesto credit was spent and no paid schedule was added.

## 61. Structured-quantity Tesco demand repairs — 22 September 2026

The wider missing-demand backlog was reconciled against persisted candidate
payloads and Dunnes/SuperValu identities without another Pepesto request.
Structured candidate quantity is now part of deterministic replacement
classification, allowing `pieces=1` to corroborate the otherwise omitted
`loose`/single-item wording while still rejecting multi-piece packs.

Three further mappings had sufficient exact evidence. `Loose Pink Lady Apples
1 Pack` maps to Tesco SKU `284182372` at €0.60 and `Loose Aubergines 1 Pack`
maps to Tesco SKU `266344796` at €0.85; both persisted candidates explicitly
report one piece. The branded Dr. Oetker canonical is corrected from pizza to
`Dr. Oetker Bistro Pepperoni Baguettes 2 Pack 250g`, matching both the Dunnes
identity and existing Tesco SKU `260285673` with its prior trusted €2.00
Pepesto observation.

All prior mappings and evidence decisions remain auditable. Other candidates
remain unresolved where brand, type, variant, formulation, measure or pack
identity is not exact. No Pepesto credit was spent and no schedule was added.

## 62. On-demand private GA4 traffic report — 26 September 2026

The production service-account connection in `src/lib/google-analytics.ts`
remains configured in Vercel. The August traffic assessment used a temporary
public endpoint and cron that were removed after use; there was no surviving
on-demand report route. Do not assume the GA4 connector itself is an invocable
report without a deployed entry point.

The deployed read-only operation `[ops] analytics traffic report` uses the
existing owner-authored GitHub issue dispatcher and a `CRON_SECRET`-protected
route. It compares the last 14 complete GA4 property days with the preceding
14 days and returns daily activity, source/medium, landing pages and event
counts. The response is stored in the private `ops_manual_dispatches` table;
the public dispatcher returns only status and dispatch ID for this operation,
including idempotent replays. The operation sends no personal or credential
data to public logs. After deployment, create a fresh owner-authored issue with
that exact title, call `/api/ops/dispatch?issue=<number>`, and read its private
response through the database. PR #219 was merged as `68ca948`, the Vercel
production deployment reached READY and issue #220 ran successfully. The
private report is in `ops_manual_dispatches` dispatch
`4d8632d2-52e5-4d05-838a-b651a8ecc91c`.

For 12–25 September, GA4 counted 1,241 sessions and 1,109 new users, versus
668 sessions and 580 new users in the preceding 14 days. The `/contact`
landing page accounts for 538 sessions, the comparison landing page 138 and
home 99. GA4 reported 68 signup prompt views and six `signup_started` events;
`keyEvents` was zero. The database has no new subscriber from 19–25 September;
two signup verification emails were sent on 20 and 21 September with no
signup-source verification link open. A controlled registration on 26
September did receive the email and completed the protected session. The
Supabase egress quota outage on 22–23 September is not a complete explanation
for the earlier registration stop. GA4's client completion event is missing
despite server-confirmed registrations, so use `subscribers` and
`agent_events` as the registration source of truth until GA4 is verified.

## 63. Registration funnel recovery — 26 September 2026

PR #221, merged as `fe96006`, extended the private report with `/contact`
daily and source breakdowns. The production deployment reached READY and the
second owner-authorized dispatch through issue #220 succeeded as
`fc88f227-1af9-4e2a-bf56-218d8ad76c57`. All 538 `/contact` landing
sessions in the 12–25 September report were classified as `(direct) / (none)`;
184 were engaged sessions. The surge begins on 17 September (40 sessions),
then 91 on 18 September and 57–76 a day on several subsequent days. This is
not evidence of qualified household interest, but GA4 alone cannot establish
whether visits were automated. Do not add a shopper signup prompt to the
partnership/contact page on this evidence alone.

The release initializes the GA4 tag queue before hydration and gives the
verified signup completion event callback up to 1.2 seconds before redirect.
This improves client delivery but is not a substitute for a verified
server-side conversion record. The email link is valid for 30 minutes rather
than 15, with consistent email and UI copy, a prompt to check Updates/spam
and an explicit retry option. Existing rate limits remain in place. The
production sign-in page returned HTTP 200 and the protected analytics route
returned HTTP 401 without credentials. A fresh real-user signup and GA4
completion event have not yet been observed after the release; continue using
`subscribers` and `agent_events` as the registration source of truth.

## 64. Contact landing route — 26 September 2026

The `/contact` page appears in public search results, although GA4 classified
all 538 sessions landing there on 12–25 September as direct traffic. Indexing
alone does not establish the cause of the spike. To test whether these visits
include shoppers, move the existing contact form to `/contact-us`, update the
footer and vendor contact links, and add the new canonical URL to the sitemap.
Temporarily redirect `/contact` to the agent homepage with `?entry=contact` so
GA4 can distinguish old-link traffic from normal homepage landings. PR #223
merged as `0340ecf`; the production deployment reached READY. Live checks
confirmed `/contact` returns HTTP 307 with `Location: /?entry=contact`, the
marked homepage returns HTTP 200, and `/contact-us` returns HTTP 200 with its
canonical and footer link. Keep the redirect reversible and compare those
landing sessions with agent starts and verified registrations before treating
the traffic as qualified demand.

## 65. Immediate acquisition and signup improvements — 26 September 2026

The 14-day GA4 increase of 573 sessions included 536 additional `/contact`
landings compared with the preceding 14 days. Excluding that page leaves 703
sessions versus 666, about 5.6% growth. The next decision needs an organic
source-to-landing breakdown and a report on events for sessions redirected
from `/contact` to `/?entry=contact`. Extend only the private on-demand report
with these aggregate dimensions; the redirect report includes the partial
current day and must not be compared directly with complete-day totals.

The comparison landing page is a meaningful existing shopper entrance. Offer
one-tap weekly-shop, budget and dinner tasks alongside its free-form agent
request, measuring the selected action in `landing_agent_started`. Keep the
visitor's first agent answer available before the email gate. For signup
emails, distinguish the subject and message from ordinary sign-in, making the
saved conversation and next step explicit. Observe subsequent prompt-to-email,
email-to-verification and verified-subscriber counts before claiming uplift.
PR #225 merged as `0d97777`; CI and preview passed and the production
deployment reached READY. The private dispatch above returned HTTP 200.
Its new `organic_landings` list has 126 Google organic sessions on the main
comparison page, 40 on home and a long tail of product pages. The new
`redirected_contact_events` list was empty on the same partial day; that is
not yet an outcome measure. Preview showed the comparison-page task buttons.

## 66. Product search handoff — 26 September 2026

The expanded private GA4 report ran successfully after PR #225 as dispatch
`987c7be5-a7c5-4bb2-b9ca-5e7b9d3cddbf`. In the last 14 completed days,
126 of 409 Google organic sessions landed on the main comparison page; the
homepage received 40, then product pages formed a long tail, led by chicken
mince with 14. The comparison-page one-tap tasks target the largest existing
organic entrance. The product template's price-panel CTA currently links to
the plain homepage, losing the viewed product. Carry the product and its
landing path into the agent prompt, and offer one-tap add, alternative and
watch tasks in the existing product agent card. This changes the journey for
existing indexed product pages; subsequent agent starts and verified signups
still need measurement before claiming an uplift. PR #226 merged as `aca3676`
after CI and preview passed. The production deployment reached READY, and
`/browse/chicken-mince` rendered the three tasks and a price-panel link whose
agent prompt includes `Chicken Mince` and the product landing path.

## 67. Growth shortcut rollback — 26 September 2026

At the owner's request, PR #228 reverted PRs #225 and #226. Main and the READY
production deployment were verified at `c1fb33b` before this work. The added
comparison/product shortcut buttons, product price-panel handoff, signup copy
and extra analytics report dimensions were removed. Sections 65–66 describe
historical work, not the current interface. Registration reliability work in
PR #221 and the `/contact` redirect in PR #223 remain deployed. No conversion
uplift was established for the reverted shortcuts.

## 68. Useful weekly-shop landing page — 26 September 2026

The owner approved improving `/cost-of-weekly-shop-ireland` while retaining its
search intent, public answer and canonical URL. The old page returned HTTP 200
with a zero-item basket, three €0.00 totals and a false Tesco cheapest label.
Its shared `getAllLatestPrices()` helper performed one unpaginated PostgREST
read: the live REST response returned only 1,000 of 2,480 trusted price rows.
Filtering those truncated rows to products present at all three main retailers
left none of the fixed 53 basket items. A complete read still would not price
all 53 products; pagination and honest coverage are separate requirements.

The shared reader now follows deterministically ordered pages until exhausted,
deduplicates by canonical ID/store, and publishes/caches a result only after
all pages succeed. Existing dependency retries and the bounded last-known-good
fallback remain; raw observations are never a fallback. Regression tests cover
the API cap, shorter server caps, equal names with different IDs and failure
of a later page.

The landing page retains its URL, weekly-cost title/H1, canonical, crawlable
content and related links. It now renders a 17-product example with explicit
quantities, observation dates and actual retailer product names. Quantities can
be changed or set to zero; displayed subtotals and coverage recalculate in cents.
Missing prices are not zero, incomplete totals are null, and no blanket cheapest
retailer claim is made. The example is explicitly not an average household
spend or a complete weekly meal plan. Some catalogue matches differ in brand or
specification; their retailer names are exposed rather than advertised as
identical products. Known ambiguous pack examples such as loose bananas and
mixed peppers were not chosen for this reference basket. No mappings, prices
or retailer jobs were mutated by this work.

A household form collects adults, children, optional budget and shopping needs,
and optionally includes the selected example lines. It enters the existing Eve
flow, which grounds proposed prices and supports registration to save the shop.
There is no new planner/model path. A single-use, 30-minute session-storage
handoff keeps household text out of query strings/referrers/GA page URLs; only
aggregate entry metadata is tracked. Existing URL-based entry paths remain
compatible. The page revalidates every 30 minutes rather than 12 hours; each
render also excludes example observations outside the seven-day boundary.

The available tools do not expose the site's Search Console property or query
performance. Do not claim a measured ranking baseline or guaranteed SEO uplift.
The pre-release HTML/metadata and the dated GA4 observations in sections 62–66
are the available baseline. Search Console query, click and position comparisons
remain unverified. Track subsequent `landing_agent_started` and `agent_started`
with this landing path, then server-confirmed registrations in `agent_events`;
GA4's completion-event limitation remains as recorded in section 63.

PR #229's initial commit `77c5595` passed release CI (build, tests, behavioural
gate and lint), and its Vercel preview reached READY. TypeScript also passed
locally. Preview HTTP 200 and server HTML contained the public prices, coverage,
editable quantities and guide. Default subtotals were Tesco €16.79 (8/17),
Dunnes €33.97 (11/17) and SuperValu €41.52 (14/17). Browser quantity/removal
changes recalculated correctly. A 2-adult/1-child/€100 request preserved the
selected quantities and existing-supplies notes, cleared the handoff URL,
produced structured household shops and reached the existing save/signup form.
The server recorded `agent_started` against this landing path. No signup email
was sent and no new registration was created during this check.

The completed agent response took several minutes. It also exposed pre-existing
catalogue/agent quality issues: a fresh-banana request matched a baby snack,
the prose flagged that mismatch while the structured proposal still included
it, and two successive proposal versions remained visible. These are separate
follow-ups; this page fix does not claim to repair catalogue matching or agent
response speed. The visible handoff text now uses product names and quantities
without exposing internal catalogue IDs. Production verification remains a
release gate; a READY preview alone is not proof of a successful release.

PR #229 merged as `bf02e779`. Production deployment
`dpl_DnEQJheu8PgzMRkCqUcJbZC7386X` reached READY on that commit; live HTML and
browser checks confirmed the public example, editable quantities, coverage and
household form. The catalogue and agent follow-ups below are separately scoped.

## 69. Household-shop response and product identity — 26 September 2026

The owner approved the follow-up after the weekly-shop journey exposed slow
responses, a banana/snack mismatch and duplicate proposal cards. Baseline main
and production were verified at `bf02e779`; Supabase had 2,480 trusted prices
(Tesco 539, Dunnes 920, SuperValu 1,021). The previous diagnostic guest session
for two adults and a €100 weekly budget took 121.496 seconds. It made two
`present_household_shop` calls and 20 individual `resolve_product` calls,
exhausting the ten-call expensive-tool budget. The two proposals had 9/29 and
19/29 priced lines. Tool execution itself was under two seconds per proposal;
five model steps consumed 158,463 cumulative input tokens. The repeated full
tool results and unnecessary second resolution pass were the main observed
amplifiers, rather than evidence of a slow database.

Keep the existing Eve runtime and batch resolver. Normalise ordinary pack
wording (`1kg bag`, `dozen`, `sliced pan`) and prefer clear pack-aware matches
without relaxing the minimum score or ambiguity gap. Explicit product-type,
measure, pack and variant contradictions are rejected in catalogue resolution
and household grounding. These checks catch known material conflicts; their
absence is not proof that every catalogue mapping is correct. Ambiguous needs
remain unresolved, missing prices stay missing, and incomplete basket totals
remain null. The model receives a compact coverage summary through Eve's
`toModelOutput`; the durable tool result still contains the complete native
shopping card. Instructions finish after presentation instead of doing one
lookup per missing line or repeating the basket in prose.

Only the latest completed proposal within each user turn is displayed. Earlier
turns remain in conversation history, partial/invalid revisions are ignored,
and autosave waits until the turn finishes. Memoising parsed proposals prevents
unrelated React renders from aborting/restarting persistence. The registration
invitation also waits for the completed first answer.

Two exact stored mappings were confirmed wrong: SuperValu SKU `1709524003`
mapped fresh `Mini Bananas` to Ella's Kitchen banana mini puffs, and Dunnes SKU
`100750899` mapped `Bananas Loose` to a five-banana organic pack. The guarded,
reversible SQL in `supabase/operations/2026-09-26-quarantine-banana-mappings.sql`
preserves each prior mapping in the existing private audit table and invalidates
only the unchanged erroneous mapping. A transaction dry run returned exactly
those two rows, both excluded from `latest_prices`, and was rolled back.
The same transaction was then committed and independently checked: both
erroneous mappings are absent from `latest_prices`. Trusted row counts are now
Tesco 539, Dunnes 919 and SuperValu 1,020 (2,478 total). No observation or prior
mapping was deleted, and no retailer refresh or paid retrieval was triggered.

Local validation passed 288 tests across 44 files, TypeScript and lint. New
regressions cover banana/snack and pack conflicts, ordinary pack wording,
latest-proposal selection and compact model output. Preview latency, final
release checks and production verification remain pending;
do not claim a measured speed improvement or conversion uplift yet.

PR #230's first preview exposed an additional lifecycle defect: capability
instructions were selected from `ctx.messages` at Eve `turn.started`, before
the current delivery entered history. The first request therefore received
only the fallback product module, and the repeat-lookup loop persisted despite
the new household guidance. Eve 0.39.0 documents this ordering. Capability
selection now runs in the supported HTTP channel `onMessage` hook against the
actual incoming text/parts, returning application-owned guidance as request
context and preserving `defaultEveAuth`. The stable core and protected-tool
checks are unchanged. Instructions remain modular; historical instructions
are no longer mistakenly treated as the current turn's intent. Regression
checks cover the first weekly-shop delivery and structured text input.

The next preview (`57d9f3e`) finished the same request in 79.238 seconds, with
one household-shop call and no individual product lookups (three model steps,
41,818 cumulative input tokens). It proposed 30 lines with 18 priced; this is
a single diagnostic comparison, not a latency SLA or conversion result.
It also exposed an unconfirmed six-pack being assigned a single-item price.
Grounding now requires positive evidence for a requested pack count/measure,
rejects multipack-versus-loose contradictions in both directions and recognises
bare egg counts. Unknown packs stay unpriced. The input schema explains the
required unresolved-need field and distinguishes purchase quantity from the
contents of one unit. Compact output labels incomplete budget assessments as
unconfirmed. The four-item browser check reached one native card and the
registration invitation; no signup email or account was created.

The final pack regressions bring local validation to 294 tests across 44 files;
TypeScript and lint pass. Final preview and production checks remain release
gates. Signed-in autosave selection is covered by regression tests; the live
checks use guest sessions and do not create an account solely for testing.

Commit `c3472de` passed release CI and reached a READY preview. The final
diagnostic asked one permitted dietary clarification, then completed the shop
in 75.056 seconds after the answer: one `present_household_shop` call, no
individual lookups, 36 proposed lines, 16 priced and €45.67 explicitly described
as a partial subtotal. Bananas were six individual units; unconfirmed salmon
packs remained unpriced. This is not directly comparable to the one-turn
baseline because it used a clarification. Validation also exposed the wording
`one 2L bottle` against a six-bottle offer; the final guard recognises explicit
single containers and written units such as `2 litre`, with regression cases.
Production verification remains a release gate and will be recorded on PR #230.
Final local validation passes 296 tests, TypeScript and lint.

PR #230 merged as `a6349a8`; production deployment
`dpl_FrVahwWvjvaRDfiBKuHbzAqSf1xa` reached READY with both public domain aliases.
The weekly-shop landing returned HTTP 200 with its existing canonical and public
example. Both quarantined mappings remained outside trusted prices.
The production five-item check displayed one card, six individual bananas, an
explicitly incomplete subtotal and the registration form; no email was sent.

## 70. Spaced unit parsing follow-up — 26 September 2026

That production check also exposed a false negative: after converting `2 litre`
to `2 l`, the existing retailer pack parser interpreted `2 l bottle` as two
bottles. Join numeric measures to their units before pack-count parsing so a
valid 2L milk offer remains eligible. This does not relax differing measures
or single-versus-multipack conflicts. A grounding regression verifies one
`2 litre bottle` at the trusted €2.25 price. The fix is separately gated through
CI and production verification; the earlier production result is not treated
as final success while this known regression remains.

PR #231 merged as `cdc26087`; production deployment
`dpl_A2t1Jfius62Z3D5Zm8576X9h6Kkj` reached READY with both public aliases.
The five-item guest check priced milk at €2.25, carrots at €1.45, a dozen eggs
at €4.35 and six loose bananas at €1.86. One card displayed an explicit €9.91
subtotal for 4/5 lines, with the unconfirmed individual water bottles excluded.
The registration prompt followed completion; no email or account was created.

## 71. Search landing shopping workspace — 26 September 2026

Sprint 2 of the traffic/registration work targets the existing organic entrance
`/compare/supermarket-prices-ireland`. Baseline GitHub main and READY production
were verified at `cdc26087`; Supabase still returned 2,478 trusted offers. The
page had a prefilled prompt redirect and static price examples, with no way to
select products or edit a shop there. The shortcut-button releases remain
reverted; this work introduces a functional shopping workspace instead.

Visitors can search the currently priced catalogue, add up to 50 exact canonical
products, change quantities from 1–20, remove lines and immediately see retailer
coverage and subtotals. Products with one retailer remain useful; three-retailer
overlap is not an entry requirement. A bounded public search route returns at
most eight products, or refreshes up to 50 exact selected IDs. Both search and
the crawlable initial examples use the existing fully paginated `latest_prices`
reader, the seven-day boundary and explicit identity-conflict checks. Unmarked
canonical single units cannot show a retailer multipack price. Empty and
unpriced lists have no numeric total, and incomplete store totals remain null.
Retailer names, dates and price exclusions remain inspectable.

The visitor supplies household size, optional budget and free-form needs. The
default request keeps to their list; completing the rest of the week is an
explicit option. Review continues through the existing Eve runtime and native
shop/save invitation. Household text and selected quantities travel via the
existing single-use session handoff, never a prompt query string. A separate
30-minute tab-local draft preserves intentions when returning to the page;
stored offers/prices are discarded and refreshed. Persistence still requires
registration and existing server grounding. This is not a second planner or
retailer checkout path, and it does not complete sprint 4's email verification
and cross-device continuation audit.

`shop_builder_edited` records aggregate action/count metadata, and
`landing_agent_started` identifies the builder, selected count and landing path.
No product query, shopping text, budget value or household detail is included
in those events. The URL, title, canonical, H1 and public price evidence remain;
the page adds useful crawlable comparison guidance and related links. ISR is
30 minutes, consistent with the weekly-shop page. No mapping, schema or retailer
job is changed, and no ranking or registration uplift is claimed.

Focused validation passes 15 tests covering identity/price truth, canonical-ID
separation, quantities, request scope, bounded search and draft expiry/restore.
The full local suite passes 306 tests across 46 files; TypeScript and changed-file
lint pass. Release CI, preview interaction and
production confirmation remain release gates and will be recorded on the PR.

PR #232 merged as `f3ac83f7`; production deployment
`dpl_4EuUkBUAcfbQdsyQh4EqvytNpjpF` reached READY with both public aliases.
Preview verified add/remove/quantity editing, draft restoration, household and
budget preservation, one completed agent shop and the save/signup invitation.
Production verified the public page, catalogue search, editing and totals.
No signup email or account was created. These checks complete sprint 2; the
full email-verification continuation remains sprint 4.

## 72. Product search coverage and useful catalogue discovery — 26 September 2026

Sprint 3 starts from GitHub main and READY production `f3ac83f7`. Supabase still
has 2,478 trusted offers (Tesco 539, Dunnes 919, SuperValu 1,020) for 1,248
canonical products. The old product-page/sitemap rule required resolved mappings
at all three main retailers: 1,029 products qualified, while 325 products with
fresh trusted offers were excluded. Category pages additionally rebuilt prices
from raw observation history, required all-three overlap, and did not link
individual products. The browse directory read an unpaginated mapping subset,
linked unavailable product routes and displayed blurred zero-price placeholders.

The public pre-release sitemap returned only 29 product URLs, despite the live
mapping-based eligibility count of 1,029. HTTP checks confirmed that the Andrex
four-roll and Baby Spinach 90g URLs returned 404, while Chicken Mince returned
200. Distinguish this observed public sitemap from the larger theoretical
eligibility count; neither is a measurement of Google's indexed-page count.

A shared public catalogue now joins canonical identities to the same guarded
`latest_prices` evidence used by the shopping workspace. One currently trusted
retailer is sufficient. Metadata records are fully paginated in stable ID order;
a failed page aborts the read rather than publishing a partial catalogue. Only
metadata is persistently cached; freshness/identity eligibility is recalculated
when pages render. Price reads retain the existing bounded cache/resilience
policy. Product pages, categories and the sitemap revalidate every 30 minutes.
Product pages use on-demand ISR instead of rebuilding the whole catalogue per
product during deployment. CI's existing explicit placeholder environment may
return an empty catalogue; preview and production cannot use that exception.

The guarded snapshot yields 1,230 products with prices across 24 categories,
including 317 products excluded by the previous publishing rule. The new sitemap
lists those currently priced products with actual observation/template dates,
replacing the blanket June date. Existing canonical product URLs remain valid
when prices expire: they show missing prices, related products and an editable
add-to-shop action. They are not redirected or marked noindex. The sitemap
omits 116 previously eligible products currently without a guarded price; their
pages remain accessible. Existing names/slugs are preserved. Future equal-name
collisions receive distinct ID-suffixed URLs rather than merging price evidence.

The shop/category directory links to crawlable product pages and adds the six
previously omitted categories (Baby, Chilled, Pet Care, Oils, Seasoning, Stock).
Canonical category names/slugs share one configuration. Historical browse
category queries and space/ampersand category paths redirect to their canonical
category route. `/browse` offers server-rendered product search and pagination;
search-result queries are noindex/follow, ordinary pagination self-canonicalises.
There is no signup gate for this public price evidence.

Product pages display exact retailer names, observed dates, source links and
explicit missing-price states. Product JSON-LD only includes visible, guarded
offers. Unverified stock availability and invented future promotion-end dates
are removed; category ItemList markup links to actual product URLs. Existing
nutrition remains retailer-labelled and is included only for a current matched
retailer product. Price claims do not promise national cheapest-store status.

An add-to-shop quantity form preserves the existing draft's household, budget,
notes, products and quantities, enforces 50-product/20-unit limits, and reloads
current prices in the existing workspace. Only intentions enter session storage.
The original product landing path continues through the agent handoff for funnel
attribution. `product_added_to_shop` records the public landing path and item
count; no shopping notes, budget or household details enter this event. Existing
Eve grounding, save and registration paths are reused; no email flow is changed.

Validation exposed two existing identity errors: Chicken Mince had a Dunnes
Turkey Breast Mince offer, and ordinary `100% Pure Honey` had a specialist Manuka
Honey offer. Shared identity checks now reject explicit meat-species conflicts
and ordinary/manuka contradictions, including in the builder/household guard.
The chicken URL remains available with missing prices. No catalogue row, mapping,
observation, schema, paid retailer job or schedule was changed. These guards catch
known contradictions, not proof that every historic mapping has been re-audited.

Local validation passes 314 tests across 47 files, TypeScript, changed-file lint
and diff checks. New regressions cover single-store eligibility, stale/zero/pack
exclusions, the observed identity errors, stable URLs without prices, equal-name
identity separation, truthful schema, category aliases and draft preservation.
Preview interaction, release CI and READY production verification remain gates;
final deployment and live evidence will be recorded on this sprint's PR. Search
Console query/position access remains unavailable: no indexing, ranking, traffic
or registration uplift is claimed from publishing more eligible pages alone.

PR #233 merged as `968d2304`; production deployment
`dpl_MaoG8VGucQWUVB1aJKYhKBq7MysC` reached READY with both public aliases.
Preview and production confirmed the catalogue/category/product routes, the
expanded sitemap, stable existing URLs and product quantity handoff. Preview
also confirmed preservation of an existing household draft through one completed
agent shop and the registration invitation. CI passed all 314 tests. Sprint 3 is
complete; email-verification continuation remains sprint 4.

## 73. Catalogue copy should sell usefulness, not catalogue size — 27 September 2026

Paul explicitly asked not to highlight the number of products to visitors: the
current catalogue size is not a selling point and may discourage registration.
This is a durable copy preference for public catalogue and category discovery.

The catalogue hero now focuses on finding food and household essentials, checking
prices and pack sizes, and adding what the household needs. Category cards and
category introductions no longer advertise product totals. The introductory
coverage disclaimer is removed; each product still shows its actual retailer
prices, checked dates and missing-price states where those help a shopping
decision. Search and browse results use neutral labels without product totals;
pagination retains the current page and Previous/Next links without a total.
URLs, headings, metadata, category descriptions, crawlable links, sitemap and
accurate structured data are preserved. The category directory no longer reads
the complete priced catalogue merely to calculate presentation counts.

Before this follow-up, GitHub main and READY production both remained `968d2304`.
A read-only Supabase check returned 2,476 trusted price rows for 1,248 canonical
products. No database, retailer refresh, matching, registration or agent-flow
changes are part of this copy update. Release checks and live confirmation will
be recorded on the PR.

PR #234 merged as `37ad3615`; production `dpl_FTZ6uYYY93picNTrb3nNoMFsYt1M`
reached READY. Live catalogue, category and browse checks confirmed the copy
change and preserved navigation/canonicals.

## 74. Registration and guest-shop continuity — 27 September 2026

Sprint 4 starts from verified GitHub main and READY production `37ad3615`.
The existing email token held account details only. Guest Eve state lived in
origin-local browser storage; another browser/device had no state to transfer.
An existing account's saved/local chat could replace the new guest journey, and
the restored transcript was not persisted as an account chat until another turn.
The sign-in form also sent a default household of two, overwriting existing
subscriber family size. These are observed implementation gaps, not proof of
which issue caused any particular visitor to abandon registration.

`/api/subscribe` now stages a bounded snapshot before sending the email. The
private `registration_continuations` table binds an opaque UUID to an HMAC of
the normalized email, with RLS and service-role-only table/function grants.
The email token carries the UUID, never the transcript or household details.
Snapshots expire after 24 hours; email links still expire after 30 minutes.
An expired, correctly signed link may lead to a fresh email request for the
same snapshot, but never authenticates on its own. Resend checks both email
binding and expiry. Automated cleanup runs on registration requests and the
existing daily protected agent-task job; claimed temporary content clears
immediately. The privacy page describes this temporary transfer.

After verification sets the existing HttpOnly session cookie, the completion
screen calls an authenticated restore route. A transaction locks and claims the
handoff, checks subscriber/email ownership and creates exactly one existing-style
account conversation. Replays return the same chat. The screen opens `/?chat=...`
and exposes a retry if restoration fails, rather than silently opening an older
chat. Requested chats load directly under the existing ownership check. Guest
events preserve the native card and display history; guest runtime session IDs
and client account claims are discarded. The first signed-in message starts an
authenticated Eve session with bounded, explicitly untrusted prior conversation
and shopping intentions as supported client context. Prices remain server-grounded.

The existing structured-shop save route still reprices before its first write.
An account/proposal uniqueness key prevents repeated links, reloads or concurrent
requests from creating duplicate shops. Autosave cache keys are account-scoped,
the shop links to the owned conversation, and a failed save has a working retry.
Sign-in preserves an existing family size; new registrations derive it from a
validated household shop when available. Registration prompts explain the free
account/save benefit and email confirmation step, and email copy follows the
actual saved-shop/conversation intent. Forms wait for a completed agent response.

Server events distinguish email sent/failed, verification opened/expired,
registration completed, continuation restored/failed and first shop saved.
The omitted client event types `signup_email_engaged` and `sign_in_started` are
accepted, and blocked browser storage no longer stops analytics or submission.
No transcript, household requirements, budget or bearer token enters analytics.
GA completion remains supplementary to the server-confirmed registration event.

Validation: 323 tests across 49 files, TypeScript, changed-file lint and diff
checks pass. New route tests exercise the real email-token/cookie/restore/save
handlers with an isolated email sink and database double; they cover another
browser with no local storage, new/existing accounts, duplicate save, expired
and forged links, fresh-link recovery, staging failure and provider rejection.
The migration also passed isolated Postgres assertions for service-role access,
denied browser-role access, email/account binding, expiry, single claim/event,
temporary content removal and account-scoped save uniqueness. No test account
or verification email has been created in production. Database application,
release CI, preview UI and READY production checks remain release gates and
will be recorded on the PR; real inbox delivery and conversion uplift are not
established by isolated flow tests.

Database migration `20260927081635_registration_continuations` was applied
successfully. The repository migration filename follows that database-assigned
version. Live checks confirm RLS enabled, no anon/authenticated SELECT or RPC
EXECUTE permission, service-role access, a rejected unowned claim and the unique
saved-shop index. No pending handoff rows or test accounts were created. The
security advisor reports only the expected informational no-policy notice for
the new service-only table; no browser policy is appropriate to this design.

PR #235 merged as `c6b56305`; production `dpl_5gSJPENNg7CxVEBwe772TWAyZj2B`
reached READY with both public aliases. Live guest-shop/save copy, expired-link
recovery, unauthenticated restore rejection and invalid-token/no-cookie checks
passed. All 323 tests passed. No production test account/email was created.

## 75. Price-backed homepage example and editable handoff — 27 September 2026

Paul approved replacing the existing illustrative `#sample-shop` section below
the homepage agent, not adding another banner, generic prompt row or new SEO
landing page. The baseline main and READY production were `c6b56305`; a read-only
Supabase check returned 2,476 trusted offers. No retailer job, mapping, schema,
account, email or paid promotion is changed by this work.

The household-essentials example uses stable canonical identities and quantities,
with current prices from the existing fully paginated `latest_prices` reader and
the shopping-workspace freshness/identity/pack guards. It chooses one retailer by
coverage, then subtotal; it does not combine stores into a one-store total or
claim national cheapest status. Actual retailer names, quantities, check dates and
line totals are visible. The full list expands in place. Missing prices remain
explicit and prevent a complete total; no-data/dependency failure retains the
unpriced intentions without a numeric zero or taking down the agent homepage.
The server section streams independently behind Suspense. No price or total is
hardcoded. The example is labelled a starting basket, not a full week's meal plan
or an average household spend. The two-adult/one-child/€100 context is editable.

`Make this shop yours` fills the existing guest agent composer and moves focus
there without sending, saving or ordering. A non-empty request is preserved
unless the visitor explicitly chooses the example instead. Busy/gated sessions
are not overwritten. The visitor edits and sends through the existing Eve flow,
then uses Sprint 4 registration. Only shopping intentions, not cached prices or
canonical IDs, enter the editable prompt. No household text is placed in URLs;
`/#sample-shop` is the public shareable anchor. Existing catalogue and SEO routes
remain unchanged.

Aggregate `homepage_example_viewed`, `homepage_example_selected`,
`homepage_example_started` and `homepage_example_result` events distinguish actual
visibility, handoff, explicit submission and a new structured result. They use the
existing analytics session so registration can be joined to the same journey;
they contain no request text, quantities, household values or prices. Existing
server-confirmed registration events remain the conversion source of truth.
Release tests, preview interaction and READY production checks are recorded on
this work's PR. No traffic or conversion uplift is claimed. External promotion,
outreach and advertising are not launched by this homepage implementation.

Local validation passes 331 tests across 50 files, TypeScript, changed-file lint
and diff checks. Eight new regressions cover cents/quantities, one-store coverage
selection, partial/no-data states, freshness/pack/identity exclusions, intent-only
handoff and existing-draft/busy/gated protection.

The initial READY preview confirmed actual retailer prices and preserved a typed
request through the keep/replace choice. Its mushrooms had no current offer at
the selected retailer, so the authored example was changed to the already-priced
broccoli identity; this changes the example list only, not catalogue mappings or
the missing-price safeguards. Multiline example requests suppress the existing
predictive-search suggestions to keep the editable request clear.

PR #236 merged as `67ea37b5`; production `dpl_CAqVZi1uE3Cd9UdHNDfBPrrTZDkr`
reached READY with both public aliases. The public example showed a complete
€36.02 SuperValu basket and an editable, non-submitting handoff. Preview changes
to an €80 budget and three milk units survived into the native card and save
invitation. All four example funnel stages were observed. No email/account or
promotion was created. A separate existing-agent issue remains: generated prose
called the €35.21 selected mixed-store subtotal a SuperValu total, while the
validated card correctly showed the €38.27 complete SuperValu basket. The
homepage's deterministic one-store calculation was not affected.

## 76. Image-free homepage example visual refinement — 27 September 2026

Paul approved restoring visual polish without relying on product photography.
Baseline main and READY production were `67ea37b5`; a read-only database check
returned 2,459 trusted offers. This is a presentation-only follow-up to sprint 5,
not a replacement shopping flow or a claim about improved conversion.

The existing example uses a compact editorial split: household introduction and
the editable-shop action on the left, a cream receipt with a pale-green total
on the right. On narrow screens the introduction, receipt and action stack in
that order. Bundled decorative line icons provide visual anchors without remote
images, missing-image placeholders or invented product photography. Clearer type
hierarchy, quieter borders, consistent spacing, tabular prices, visible keyboard
focus, adequate touch targets and reduced-motion support preserve usability.

The authored basket, trusted reader, freshness/identity checks, totals, disclosure,
event names and existing-draft/busy/gated handoff protection are unchanged. Actual
retailer names, individual checked dates, missing prices and total exclusions
remain visible. No schema, mappings, retailer work, agent narrative, registration
or email changes are included. Tests, preview checks and final production evidence
are recorded on the release PR; the separate agent-prose issue above remains open.

Local validation passes all 331 tests across 50 files, TypeScript, changed-file
lint and whitespace checks. No dependencies or remote image hosts were added.

## 77. Guest living receipt alongside the homepage agent — 27 September 2026

Paul approved adapting the signed-in right-hand basket for the pre-login shop
experience, keeping the polished `#sample-shop` example as marketing proof.
Baseline main and READY production were `8c1d80b3`; a read-only Supabase check
returned 2,383 trusted offers. No retailer refresh, schema or email change is
required.

The guest homepage opens a receipt when a shopping conversation starts. Desktop
places it beside the agent; smaller screens use an expandable summary immediately
above the composer and a compact save action. The shared receipt surface preserves
the signed-in visual language, while its data comes directly from completed,
validated `present_household_shop` results in the existing Eve conversation.
It never calls the private weekly-plan endpoint. Partial/invalid tool results
cannot replace the last completed proposal. Chat retains concise proposal markers
instead of repeating full shop cards. Product-only queries keep the existing flow.

The receipt uses server-calculated line totals, selected subtotal and one-store
coverage. No priced lines means no numeric total; incomplete shops cannot claim
to be within budget. Mixed-store prices are explicitly identified, and incomplete
retailer baskets have no complete total. Household details and assumptions remain
inspectable. A deterministic revision summary describes additions, removals and
updates without claiming savings from changing coverage.

The homepage guest UX permits one revision after the first completed proposal,
including when one initial clarification was needed, with a hard maximum of three
user messages. Without a proposal the existing two-message bound remains; watches
and other persistent requests still lead to sign-in. Authenticated tools retain
their server access controls. This UX limit is not a security or rate-limit claim.
The existing email continuation carries the same Eve events and latest proposal
through verification, then revalidates prices and saves using the existing path.
No new account or email is needed for testing; isolated route tests cover that
handover. Existing registration analytics remain in use.

A preview-only `/preview/guest-shop` viewport harness embeds the real homepage at
390 × 844 for mobile checks. It returns not-found in production, uses no synthetic
auth or shopping state and is marked noindex. Local validation passes 339 tests
across 51 files. Release CI, real preview interaction, responsive inspection and
production evidence will be recorded on the PR before this release is complete.


The first READY preview (`ba0e6eb1`, PR #238) completed a real three-turn guest
journey: clarification, a seven-line top-up shop with one unpriced product, then
an explicit revision changing milk quantity and removing that product. The
receipt retained the €12.64 incomplete proposal during revision, then showed the
€14.89 selected total and “1 removed · 1 updated”. The mixed-retailer label and
missing-price warning were correct. The existing model prose still occasionally
attributes the selected subtotal to one retailer or calls an incomplete proposal
within budget; deterministic receipt truth does not fix that separate agent
narrative issue recorded in §75.

The 390px preview confirmed a compact summary above the composer and expandable
product details. Follow-up polish makes mobile product and save disclosures
mutually exclusive, uses plain missing-price wording, and suppresses an early
registration prompt while the initial proposal is still processing. A further
isolated regression confirms the latest revision, quantities and budget survive
email continuation. No live verification email or test account was created.

## 78. Guest ideas: optional first-answer saving, registration gate retained

The first product-use/meal-ideas answer had no structured shop, correctly, but
HomePlanner automatically opened the full registration form after any first
useful answer. That made exploration feel interrupted before the shopper chose
an idea. The user requested a quieter first-answer experience while explicitly
retaining the registration gateway.

First non-shop answers now show a small optional “Save these ideas — free
account” action (or “Save this answer” for other intents). Opening it reveals
the existing email continuation form; closing it preserves the mounted form.
Meal copy describes saving ideas rather than claiming a meal plan already
exists. The collapsed action does not count as a full signup-form impression.
Completed structured shops keep the existing receipt and save invitation.

Exploratory meal guidance now offers a contextual next step: choose an idea,
give the number of people, and optionally name ingredients already owned. It
does not create a basket from ideas alone. Acceptance prepares a structured
proposed shop through present_household_shop, excluding stated owned ingredients
and making reasonable assumptions. Short follow-ups use conversation context;
natural “make with”, “ways to use” and snack queries select meal guidance.

The guest journey limits are unchanged: two user turns without a completed
proposal; one revision after a completed proposal with at most three user turns;
persistent monitoring still leads to registration immediately. Composer/send
guards, server authentication, verification and continuation persistence remain
unchanged. Added regressions cover ideas without a shop reaching the gate,
ideas becoming a shop followed by one revision and the gate, and natural meal
idea routing. Local tests pass 344 assertions across 51 files. Preview, CI and
production evidence will be recorded on the release PR.

The READY PR #239 preview at d8c01e8159a8e32ff496d6bb4d71902b5fe09365
returned Philadelphia ideas with only the optional save action. Opening and
closing that action revealed the existing email form without submitting it.
Choosing spinach/mushroom pasta for two produced a three-line priced proposal
at €3.89, excluding the cheese, garlic, oil and pepper already owned. One
revision doubled the pasta, updated the total to €5.64 and disabled further
guest input while preserving the registration form. The first mobile ideas
response at 390px also retained an enabled composer and collapsed save action.
Local build passes using system TLS certificates for Google Fonts; CI passed.

## 79. Mobile navigation overlays the page and exposes category links

While §78 was in preview, the user reported that the mobile menu pushed the
page down and asked for category headings instead of a generic browse option.
AppShell's menu was an in-flow header block. It is now a native modal dialog
anchored to the right, with a dimmed backdrop, independent category scrolling,
body scroll lock and a fixed sign-in/register action. Native modal behaviour
keeps keyboard focus inside the menu and restores it on close; Escape, close
button, backdrop and destination selection dismiss the panel. It also closes
when navigating or resizing to the desktop breakpoint.

The menu leads with “Your agent” and lists the existing CATALOGUE_CATEGORIES
names in two columns, linking to their existing canonical /shop/{slug} routes.
“View all categories” remains available. No product counts, new catalogue
routes, catalogue data changes or registration exemptions are introduced.
Desktop navigation and the signed-in bottom navigation remain in place.
Responsive preview and final production evidence are tracked on PR #239.

## 80. Remove the example section's self-link

The user flagged “Link to this example” in the homepage “See the result”
section as random. It linked back to the section already being viewed and
competed with the meaningful “Make this shop yours” action. Remove that visible
self-link and its unused import. Keep the sample-shop anchor for existing
inbound links, the example content, prefill behaviour and registration flow.
This is a presentation-only cleanup; release verification is recorded on its PR.

## 81. Homepage starter and deal-chip audit (27 September 2026)

The user asked whether the homepage starter prompts are dynamic/useful and why
the Instant Coffee banner never changes. Inspection of production at main
b15b9942b0f61757b201be1508515657a9e69ffa confirms the following findings.

Market starters use fixed templates filled from latest_prices, with deterministic
ten-minute rotation among up to twelve top-ranked candidates. They are shared
guest suggestions, not AI-written or household-personalised recommendations.
Meal/household candidates rank by percentage saving; comparisons rank by raw
price spread under the same canonical name, without pack/unit normalisation.
The starter analytics record prompt_source=starter but no individual starter
identity, so these events cannot attribute registration to a particular prompt.

The separate LiveDealChip is not hardcoded. Its API selects the twenty largest
absolute savings, omits category from the response, then the client filters by
grocery keywords and picks up to five for five-second rotation. The actual
/api/promotions response had twenty rows but only one surviving grocery deal:
Instant Coffee 100g at Dunnes, €6 versus €9.80 (39% rounded saving). Therefore
its rotation is disabled by the one-item pool. The underlying retailer product
is L'OR Classique Instant Coffee 100g; the canonical label drops its brand.

The cited haddock starter is not a like-for-like comparison: Dunnes Stores
Breaded Irish Haddock Fillets 250g at €4 and SuperValu Loose Haddock Fillets
(1 kg) at €21.99 share the canonical name Haddock Fillets. Do not promote the
raw spread as evidence of better value. No product mapping was changed in this
audit; any mapping repair needs the established identity validation workflow.

The cited Philadelphia offer (€1.32 versus €2.65), Colgate offer (€4 versus €8)
and coffee offer were last observed on 24 September. “Today” and “this week”
are fixed wording, not derived from check dates or confirmed promotion periods.
The shop starter also exposes an offer count despite the user's preference to
avoid catalogue/coverage counts. Recommended next work: prioritise useful shop
outcomes, validate comparison eligibility, use honest freshness copy, remove
the redundant deal chip/count emphasis, and measure individual starter outcomes.
These are findings and recommendations only; this audit changes no live UI/data.

## 82. Homepage starter usefulness and attribution (27 September 2026)

User approved the §81 recommendations. The first starter now prepares a household
shop after asking for household/budget/existing-stock context. Meal and household
starters rotate within their own eligible categories, interleaving categories so
one heavily discounted category does not fill the candidate pool. They use actual
retailer names, preserving brand/pack details, and show observed check dates rather
than fixed “today/this week”. Meal prompts offer a contextual next step to build a
shop; household offers ask about value without assuming bulk buying is useful.
Preview exposed Club Lemon cans categorised under Fruit, so meal candidates also
require a recognisable ingredient in the actual retailer name and exclude drinks
and confectionery. Duplicate retailer products do not consume extra rotation slots.
Exploratory meal prompt wording is checked against the guest journey classifier so
it does not open an empty receipt before the visitor asks for a shop.
The fourth slot only promotes a product comparison when actual retailer names
(including brand/variant) and explicit pack evidence agree under the same canonical
ID. Loose/variable-weight products, missing evidence and conflicting packs/brands
fall back to a useful comparison capability prompt. This is deliberately stricter
than trusting the canonical mapping alone. No mapping or retailer feed changed.
The offer-count starter and separate LiveDealChip banner are removed. The remaining
promotions endpoint is unchanged. Stable fallback prompts share one client-safe
module, and price-check detail wraps rather than truncating on small screens.

Analytics add starter_prompt_viewed (half of the individual button visible, once
per starter/version/browser session), starter_prompt_selected (accepted tap), and
guest_shop_prepared (first newly completed validated guest shop in the session).
Starter ID, kind, position and version accompany starter events and agent_started;
deployment hostname lets the report exclude all preview/QA events from production.
no shopper prompt/email is added to these events. Existing session_id propagation
through the signed verification token already joins the normal email-verification
flow to server-recorded signup_completed, including opening that link on another
device. Authentication, signup limits and continuation payloads are unchanged.
The regression checks assert this correlation without real emails/accounts.

The read-only report docs/analytics/homepage-starters.sql gives per-starter visible
sessions, first selections, prepared shops and verified registrations with a
seven-day outcome window. This is observational first-selection attribution, not
proof of a conversion lift. Analytics blocking/storage loss and resending a link
from a different browser can cause gaps; existing-account sign-ins are excluded.
Wait for real cohorts to mature before judging winners. Template version is 2.

Validation/release evidence is recorded in PR #241. A merged PR is not itself a
production verification; the final deployed commit and live checks must be noted
in that PR before reporting the release complete.

Local verification for this implementation: all 359 tests across 51 files pass,
including the initial 17 starter-selection/identity cases, analytics de-duplication and the
isolated email continuation flow. The production build passes with normal TLS
certificate verification enabled. Lint has no errors (22 existing warnings;
changed files have none). The read-only report executes successfully against the
current schema and initially returns no v2 rows, as expected before release.

Three additional ingredient-filter cases pass (20 starter tests, 362 total after
the added cases). Preview desktop and 390px mobile checks show dated dynamic
starters with no separate deal banner. A household starter gathered context,
produced a receipt with explicit missing prices, and completed its permitted
revision to a fully priced €6.89 draft. The composer then gated registration.
The final selection logic's mobile tuna starter produced useful meal ideas,
an enabled follow-up composer and the quiet optional save link without an empty
receipt. Internal events recorded individual impressions/selections and the
prepared shop; the report's production-host filter excludes this QA traffic.

## Tesco structured direct collection — 29 September 2026

The historical 24–48-hour Tesco wait is an application quarantine policy, not a
measured retailer block lifetime. The legacy RPC defaults to 48 hours and clamps
at a 24-hour minimum. A later success on ordinary Vercel egress would not prove
same-IP recovery. Keep stop-on-challenge and do not treat cooldown expiry as proof
that transport is healthy.

A bounded product/listing collector now reads Tesco's Irish structured Apollo
page data and exact listing references. It separates regular prices from
conditional promotions, performs strict canonical identity checks, records
private request evidence, paginates selection inputs, and allows successful
products to become eligible for renewal after four days. It uses one deployment
path gate for the full run, stops on 401/403/challenge or 429, honors Retry-After,
and avoids repeated page requests for 24 hours. Existing seven-day freshness and
mapping-repair rules are unchanged. No recurring schedule is introduced.

See `docs/tesco-direct-collection.md` for the owner-issue probe/collection commands,
evidence schema, limitations and rollout gates. Local validation passes: 376 tests, including 14 collection tests, TypeScript,
lint (existing warnings only), and replay of the public product/listing fixtures.
PR #242 passed required CI and Vercel Preview, merged, and reached READY in
production. The deployed bounded probe returned an access denial on its first
request and stopped before listing collection; it wrote no prices. Persistent
quarantine and private result recording worked. Direct production transport is
therefore still blocked. Waiting longer than the earlier proposed cooldown did
not establish accepted access on the deployment path; ordinary Vercel egress
does not establish same-IP continuity. Retain the 48-hour policy and require
accepted retailer access before scaling. Do not shorten the timer as a presumed
transport fix. The implementation is deployed; coverage recovery is not proven.
Production audit rows and request results belong in private evidence storage,
not this repository.

### Supervised workspace recovery (partial run checkpoint)

Following explicit user approval, a separately supervised workspace collection
is refreshing existing mappings through the same structured parser, identity
checks and idempotent price finalizer. Vercel's quarantine is unchanged. The
workspace evidence gate is disabled for automated selection and is not a pool
failover identity. No paid provider, cookies, challenge solver or IP rotation is
used. Each page is checkpointed privately before continuing; a denial/rate limit
or other fetch failure stops the run.

The first accepted write was verified through `latest_prices`. Listing breadth
had low trusted yield. Exact pages with fully specified canonical identities are
now prioritised; generic canonical descriptions frequently fail strict pack-size
checks. The earlier 500/1,000 planning estimates are not established forecasts.
The standalone `scripts/tesco-workspace-page.mjs` emits one parsed page and its
identity decisions without holding database credentials. The supervising client
persists private evidence and calls the existing finalizer only for accepted,
still-resolved, unchanged canonical/SKU mappings. This is a supervised recovery,
not a recurring production transport.

The supervised pass completed 118 successful page requests before a brand-search
URL returned HTTP 404. The current conservative supervisor stops on any HTTP
error, so this triggered a 15-minute application pause, not the 48-hour
access-denial quarantine. No 401/403/429 was observed. The Vercel pause is unchanged.
Accepted prices were committed and verified incrementally. Private page evidence,
price receipts and the resumable queue are persisted in the manual scrape run.
The run is explicitly partial/degraded, not a completed full-catalogue scrape.
Future work should distinguish a confirmed no-result search from an access denial
without weakening challenge/429 handling or silently clearing an active gate.

Brand-specific listings with a requested count of 100 returned larger structured
result sets and materially improved yield. Pagination must preserve the actual
returned page size; do not change count mid-pagination and skip offsets. Stored
metadata-only candidate checks overestimated exact live matches, especially where
canonicals omit pack sizes. Do not extrapolate the initial 20-page sample into a
promised 500/1,000 fresh trusted products. Remaining mapping repairs require
separate identity evidence; no canonical mappings were changed during this run.

The user subsequently authorised continuation after the workspace pause had
expired. The saved brand-listing queue and its returned pagination were completed,
followed by the remaining stale, unseen candidates with explicit canonical sizes
or pack counts that passed the stored-identity precheck. The resumed requests
returned HTTP 200 without access denials or rate limits; accepted writes were
verified through `latest_prices`. Previously completed requests were not repeated.
The narrower overlapping Ballymaloe Foods query was covered by the broader
Ballymaloe search. Generic/underspecified residuals remain a mapping/product-policy
workload, not evidence that Tesco lacks those products. The selected collection
phase is complete; this is not a claim of full-catalogue coverage, a new production
transport, or achievement of the earlier speculative coverage targets.

### Tesco expansion and exact mapping repair — 29 September 2026

The user authorised a broader pass over previously unvisited resolved SKUs,
without rejecting requests solely because stored identity metadata is weak.
The first tranche stopped on an out-of-scope permanent redirect. This was a
resource-level event, not a new access denial; the existing application pause
was retained until its expiry. The production Vercel gate remains untouched.

Offline review of saved retailer evidence identified a small cohort of unique,
branded replacement SKUs with equal explicit pack size and variant. These were
applied transactionally after rechecking live canonical names, old mappings,
retailer evidence and destination-SKU collisions. Immutable private audit rows
retain the prior mapping, replacement product and source page. Cached prices
retain their original observation timestamps. Shared canonical definitions and
general identity thresholds were not changed. Broader classifier suggestions
included unsuitable variants and composite products and were not auto-applied.

The supervised helper now distinguishes missing resources from transport stops:
404/410 without Retry-After, and permanent redirects to the exact public Irish
homepage, can be recorded and skipped. Out-of-scope redirects are never followed.
Unknown redirects, challenges, 401/403, 429, Retry-After, parse and network errors
retain the conservative stop policy. Targeted tests cover missing pages that
actually contain access challenges and ensure redirect targets are not fetched.
This helper change does not enable an automatic production transport or clear
an active cooldown. Private run/evidence records remain the source of operational
counts and the resumable queue; successful page retrieval is not trusted coverage.

The subsequent supervised requests encountered a permanent redirect from a
retired product URL to the Irish steamed-vegetables/rice/pasta category. That
Irish browse-category shape is now also skippable without following it, limited
to permanent redirects, clean lowercase category path segments, no query/hash,
no authentication/security markers and no Retry-After. Other redirects remain
unknown and still stop. No workspace access
denial or rate limit was recorded. Application pauses already set by the older
handler are not shortened. CI passed all tests and the behavioural gate; its
first build failed in unchanged Google-font handling and a single retry passed.

Further private duplicate-SKU review showed that wrong or underspecified peers
were preventing otherwise exact products from refreshing. Reviewed stale peers
were quarantined with URL/SKU/GTIN cleared and `url_status=failed`; prior values,
canonical identity and the retailer evidence remain in immutable audit snapshots.
Different flavour/pack/product conflicts are labelled material mismatches;
underspecified or unproven identities are labelled insufficient evidence, not
retailer absence. No fresh peer was removed. Exact remaining mappings were
replayed with original evidence timestamps and the unchanged identity predicate.
Two previously conflicting groups also became unique after the earlier remaps.
Shared canonical definitions and synonym/duplicate matching rules are unchanged.

### Tesco transport diagnosis and evidence preservation — 8 October 2026

Repeated supervised network failures hit the local collector deadline. The old
catch handler erased HTTP status, Retry-After and exception/phase information,
including when a denial response had already arrived but its body failed. This
prevents retrospective attribution to Tesco versus network/workspace transport.
The workspace uses its existing managed proxy; no alternate route was tested.
Latency variance supports transient delay as a hypothesis, not a proven origin.

A narrow reviewed correction retains allowlisted transport diagnostics in private
page detail and preserves known 401/403/429 classifications on body failure.
Tests cover local deadlines before headers and during body reads, header/status
preservation, redirects, error sanitisation, existing challenge/Retry-After rules
and no extra requests. Deadline, pacing, terminal network-error policy, lease,
checkpoints, finalizer, identity matching and production mappings are unchanged.
See docs/tesco-direct-collection.md for the conservative conditional retry proposal;
no retry or scheduler is implemented or authorised by this code change.

The bounded live test ran the existing collector after cooldown expiry and stopped
on an exact-measure validation rejection after HTTP success. No new trusted price
was inserted. Deferred timeout products remain untested. Private run
tesco_workspace_transport_test6_20261008 contains the evidence. This small result
cannot validate a larger batch or unattended execution. Main and production were
unchanged at inspection; the correction remains a PR requiring review/deployment
approval. Operational counts and product evidence remain outside the repository.

### Supervised Tesco renewal implementation — 9 October 2026

The transport diagnostic correction above is now on main (#249). A separate
implementation from documentation-only #250 adds an operator-only Node renewal
entry point; see `docs/tesco-supervised-renewal.md`. It explicitly selects
still-fresh, proven observations at four days old, oldest first, separately from
expansion. Live parser/identity checks and the existing append-only finaliser
remain authoritative. No database migration, mapping change, scheduler or
production routing change is included.

The persistent SQL bridge uses the authenticated Supabase connector, the existing
disabled workspace gate, owner-guarded leases and atomic page/receipt/observation
commits. Unknown attempts remain held for reconciliation without automatic
retry; committed pages are skipped on an eligible interrupted-run resume.
Cooldowns precede checkpoints, and a stale owner cannot clear its successor.
Automated isolated PostgreSQL tests execute the existing finaliser, including
idempotency, rollback, old-price preservation and access-stop cases. Dedicated
runner TypeScript validation is included in CI. The production read-only dry run
selected no due products on 9 October; no Tesco request or production write was
made for this implementation check. Operational counts remain private.

First renewal is due 12 October 2026 at 11:28 Irish time, before the corresponding
15 October expiry. PR #251 was reviewed and merged on 9 October at
`69797402833097d3c7982db331a8828b6612c70d`, with an identical tree to CI #897
(406 tests, including 25 renewal tests). Main's ruleset required the passing
validate check and squash merge, with no approving-review requirement or bypass.
Production deployment `dpl_7zsS3B2AmJcZkDPW57SEcSbRBf3s` reached READY. The merged
CLI's read-only production dry run selected no due products and made no writes.

The first supervised batch is capped at 25 due products; 12 October at 11:40
Irish time is the recommended initial window, subject to live preflight. Front-
load renewal as the cohort becomes due that day, finish late carry-over early
on 13 October and retain 14 October for safe recovery. A 48-hour quarantine or
unresolved identity failure can still prevent complete coverage preservation.
Do not retry held requests or expand the catalogue during renewal protection.
The detailed procedure is in `docs/tesco-supervised-renewal.md`; exact coverage,
workload and unresolved-request evidence remain private.

The smallest proposed Work-independent follow-up is inspection of the existing
EC2/systemd host, a separately approved one-product connectivity test and a
thin PostgreSQL adapter around this runner. Current host access/credentials and
Tesco reachability are unverified; the legacy shell's Tesco branch uses a
different scraper. No AWS canary, new infrastructure, egress change, scheduler
or live renewal was executed. Work access does not establish Vercel/AWS access.

## Read-only Tesco catalogue discovery (implementation review)

A separate offline discovery CLI now indexes structured Tesco listing/product
snapshots across the complete missing-price catalogue, with exact SKU/URL evidence,
independent GTIN checks, conservative identity/peer checks, duplicate ownership,
request/rejection holds and incremental fingerprints. It invokes the existing
identity validator without changing collection or renewal. Stored evidence never
receives a live-verified URL label. See `docs/tesco-offline-discovery.md`.

Full-catalogue evaluation exposes incomplete canonical brand/pack information,
shared or conflicting historical SKUs and absent independent peer GTIN evidence
as constraints on new exact identities. Private reports retain actual yields and
operational evidence. A ready queue is not manufactured to meet coverage targets.
No production mappings, observations, timestamps, leases or schedules were changed.

### Discovery review: compound quantity guard

Pre-merge review reproduced a false exact discovery result when an extra explicit
measure was appended to a title and structured quantity was absent. Discovery
now holds compound-measure canonical, retailer and peer titles for review rather
than comparing only the first amount. Negative controls cover extra same-unit and
mixed-unit amounts. The discovery version changes to invalidate previous cached
decisions. Production matching/collection code is unchanged.
