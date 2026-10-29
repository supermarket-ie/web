# Proposal — retailer refresh alerting (missed / degraded / expiring)

Status: PROPOSAL (not implemented). Written 29 October 2026 after a disabled
Dunnes EventBridge schedule silently let all trusted Dunnes coverage expire,
collapsing three-retailer comparisons 170 → 0 before anyone noticed. Goal: no
retailer can silently lose trusted coverage again, without changing the scraper,
matching thresholds, provenance, or any catalogue mapping.

## What we already have (reuse, don't rebuild)

- `src/app/api/cron/scrape-watchdog/route.ts` — runs Mon/Thu 07:45 UTC via the
  EventBridge `smie-prod-scrape-watchdog` schedule → `scheduled-runner`. It
  already DETECTS issues and logs them (it flagged both the SuperValu degradation
  and "dunnes: last healthy run is 171h old" on 29 Oct). Today its output only
  goes to CloudWatch logs — nothing escalates it.
- A notification path already used by other crons (Resend email;
  `check-alerts`/`price-watchdog` patterns) — reuse it, add no new infra.
- `scrape_runs` (status, coverage_pct, threshold_breached, run_scope,
  started_at/finished_at), `scrape_failures`, and the `trusted_retailer_offers`
  view (7-day freshness) — all the signal needed is already in the DB.

## The three conditions to alert on

For each ACTIVELY-SCHEDULED retailer (currently dunnes, supervalu; NOT tesco while
its schedule is disabled — derive the set from the ENABLED EventBridge schedules
so a deliberately-disabled retailer isn't alerted as "missed"):

1. **Missed scheduled run.** Expected a Mon/Thu run but none exists. Detection:
   no `scrape_runs` row for the store with `run_scope='scheduled_full'` and
   `started_at` within the last ~26h on a scheduled day (grace for stagger/retry).
   Severity HIGH — this is the exact failure that just occurred.

2. **Repeatedly degraded.** The store's last N (e.g. 3) `scheduled_full` runs all
   finished `degraded`/`threshold_breached=true` (coverage below the store
   threshold). One degraded run is normal catalogue drift; a sustained run is a
   signal (site change, matching drift, access). Severity MEDIUM. (SuperValu is
   currently in this state at ~73% vs 85% — the alert would surface it without
   crying wolf on a single run.)

3. **Trusted coverage approaching expiry.** The store's freshest
   `trusted_retailer_offers`/`latest_prices` observation is older than a warning
   threshold (e.g. > 6 days, i.e. < 24h before the 7-day cutoff), OR the count of
   fresh rows has dropped below a floor (e.g. < 50% of the trailing median).
   Severity HIGH as it approaches 0. This catches a disabled/failing schedule
   BEFORE coverage hits zero, and also catches "runs happen but write nothing".

Optionally fold in a fourth derived signal already implied by #3 for the
commercial goal: **three-retailer triples dropped by more than X%** vs the
trailing baseline → HIGH (the metric the business actually cares about).

## Where it runs

Extend the EXISTING `scrape-watchdog` cron (it already computes staleness and
degradation) to, after building its issue list, send a single consolidated alert
via the existing notification path when any HIGH/MEDIUM condition is present.
Keep its current CloudWatch logging. No new schedule, no new service, no new
dependency. Cadence: it already runs Mon/Thu 07:45 UTC (after the 05:10/05:20
scrapes); consider adding a daily run so an expiry warning (#3) can fire on
non-scrape days too — a one-line `enabled_schedules`/cron addition, still no new
infra.

Belt-and-braces (optional, infra-level): a CloudWatch alarm on the
`smie-prod-scheduled` task failures, or an EventBridge rule on RunTask failures,
so a schedule that fires but whose task crashes is caught independently of the
in-app watchdog. The in-app watchdog is the primary, richer signal.

## Alert content (actionable, not noisy)

One consolidated message per watchdog run listing, per affected store: the
condition (missed/degraded/expiring), the numbers (last run age, coverage% vs
threshold, fresh count, soonest expiry, triples delta), and the exact remediation
command — e.g. the one-off catch-up used on 29 Oct (`aws ecs run-task` of
`smie-prod-scheduled` with `CRON_JOB=<store>-scrape-trigger`) and/or
"schedule `smie-prod-<store>-scrape-trigger` is DISABLED". De-duplicate so the
same standing condition doesn't alert every run (e.g. only re-alert on state
change or once per 24h).

## Thresholds (start conservative, tune from history)

- Missed run grace: 26h after a scheduled slot.
- Degraded streak: 3 consecutive `scheduled_full` runs below the store's
  `threshold_pct` (Dunnes 75, SuperValu 85 per current rows).
- Expiry warning: freshest trusted observation > 6 days old (24h pre-cutoff);
  critical at > 6.5 days.
- Coverage floor: fresh count < 50% of the trailing 4-run median.

## Explicitly out of scope

No change to scraper logic, matching-confidence thresholds, rejection rules,
provenance, or catalogue mappings. Alerting is read-only observability over
existing durable state; it never triggers collection or mutates data.

## Suggested next step

Implement as a focused PR extending `scrape-watchdog` + a small
`retailer-coverage-alerts` helper with unit tests over seeded `scrape_runs` /
freshness fixtures (missed, degraded-streak, expiring, healthy → no alert),
wired to the existing Resend path behind the established secret. No schedule or
threshold change ships without review.
