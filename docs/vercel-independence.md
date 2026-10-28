# Supermarket.ie — Vercel independence & emergency continuity

> **HISTORICAL (superseded 28 October 2026).** The Vercel → AWS migration is
> complete: production now runs entirely on AWS ECS Fargate behind the
> `smie-prod-alb` ALB, with EventBridge Scheduler (crons) and SQS + an SQS
> consumer service (queues). `www` and the apex resolve to AWS; Vercel is NOT on
> the customer path, is NOT a deploy target, and is NOT a release gate. See
> `PROJECT_STATE.md` and `docs/aws-production.md` for the authoritative current
> architecture and deploy process.
>
> This document is retained for its disaster-recovery reasoning (what lived where
> before cutover, and the AWS-only recovery path, which remains valid). References
> to "Vercel is live / rollback to Vercel" are OBSOLETE — there is no Vercel
> rollback; recovery is a prior ECR image + S3 Terraform state (Priority 4 below,
> which is already AWS-only).

Operational-continuity plan originally written for a possible Vercel account
suspension during migration. Covers: what broke on suspension (Priority 1), the
fastest path to AWS (Priority 2), AWS replacements for Vercel background services
(Priority 3), and Vercel-independent disaster recovery (Priority 4).

Guardrails: no production DNS change, no merge to main, no disabling Vercel
workers, no duplicate jobs, and no billable AWS provisioning until approved.

---

## Priority 1 — What becomes unavailable immediately on Vercel suspension

| Capability | Vercel dependency | Impact on suspension | Mitigation |
| --- | --- | --- | --- |
| Public website + Eve agent | Vercel hosting of the Next app | **Site down** | Deploy the same image to AWS ECS (Priority 2). No Vercel-only code on the customer path. |
| TLS / domain routing | Vercel edge + DNS target | Site unreachable at `www`/apex | ALB + ACM on AWS; cut DNS to the ALB (approval-gated). |
| Scheduled jobs (10 cron entries) | Vercel Cron | Digests, alerts, watchdogs, scrape triggers stop | EventBridge Scheduler → scheduled ECS tasks (Priority 3). |
| Background queues (6 topics) | Vercel Queues | Retailer price finalisation + proactive notifications stop | SQS + SQS-consumer ECS service (Priority 3). |
| Env vars / secrets | Stored in Vercel project | **Lost if not backed up elsewhere** | Back up NOW to a password manager / AWS Secrets Manager (checklist below). |
| Deploy config | `vercel.json` (crons, queue triggers, region) | N/A (in git) | Already in the repo; mirrored by Terraform + EventBridge. |
| Build/runtime logs & metrics | Vercel observability | History inaccessible | CloudWatch on AWS going forward; export anything needed now. |

**Not at risk** (external, unaffected by Vercel): Supabase (DB + trusted prices),
Resend (email), Anthropic (agent model), the GitHub repo, retailer data. These
are reached by credentials, not via Vercel.

### Emergency backup checklist — do this before anything else

Record each item somewhere OUTSIDE Vercel (password manager + AWS Secrets
Manager). **Never commit secrets to git.** Capture by NAME/where-stored, copy
values directly into the secret store.

Production environment variables / credentials to capture from the Vercel
project settings (names only here):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`
- `MAGIC_LINK_SECRET`, `VENDOR_MAGIC_LINK_SECRET` (CRITICAL: session + magic-link
  signing — must be preserved verbatim or all signed-in users are logged out)
- `CRON_SECRET`, `REVALIDATE_SECRET`
- `RESEND_API_KEY`
- `ANTHROPIC_API_KEY`
- `SCRAPINGBEE_API_KEY` (if set), `SCRAPE_ALERT_EMAIL`
- `GOOGLE_ANALYTICS_CREDENTIALS_JSON`, `GOOGLE_ANALYTICS_PROPERTY_ID` (if set)
- Pepesto: the key is stored in Supabase Vault (`get_pepesto_api_key`), NOT a
  Vercel env — no action, but confirm Supabase access is backed up.

Other critical platform state to record:
- The current production domain → Vercel DNS target (so rollback is possible),
  and the registrar/DNS provider login.
- The Vercel project's cron list and queue topics — already in `vercel.json`
  (git), reproduced in `infra/terraform/workers.tf`.
- The latest known-good deployment commit SHA (for parity when building the
  AWS image).
- Supabase project ref + service-role + anon keys (independent of Vercel).
- Any Vercel Static-IP / egress identity used for Tesco (the `tesco_egress_pool`
  is empty today; record if one was provisioned).

Quick capture (requires Vercel still accessible; redirect to a local file, do
NOT commit):
```bash
vercel env pull .env.vercel.backup   # then move to a password manager and delete
```

---

## Priority 2 — Fastest path to the website on AWS

The website + Eve agent have **zero** Vercel-Queue/Cron dependency, so they run
on AWS immediately. The full procedure is `docs/aws-migration-production.md`.
Shortest path:

1. Back up secrets (Priority 1) → Secrets Manager.
2. S3 state backend + ACM cert for `www.supermarket.ie` + apex (+ test host).
3. `terraform apply` stage 1 (ECR+ALB+IAM), build/push the deploy image from the
   repo root, `terraform apply` stage 2 (ECS web service), with `test_mode=true`
   first to verify read-only against production Supabase.
4. Verify catalogue/prices/auth/registration reads + Eve agent on the test host.
5. Flip `test_mode=false`, re-verify, then cut DNS (approval-gated).

Workers are NOT required for the site to serve.

---

## Priority 3 — AWS replacements for Vercel Cron & Queues

Implemented in this PR, reusing all existing handlers and safeguards:

- **Queue abstraction** `src/lib/queue/*`: drop-in `send`/`handleCallback` with
  `QUEUE_BACKEND=vercel|sqs`. Vercel mode is byte-for-byte the old behaviour;
  SQS mode publishes to SQS and registers consumers for the poller.
- **SQS consumer** `src/workers/sqs-consumer.ts`: a long-running ECS service
  that long-polls each topic's SQS queue and drives the SAME consumer handler,
  re-implementing the per-topic retry closures as visibility/delete calls.
- **Scheduled runner** `src/workers/scheduled-runner.ts`: EventBridge Scheduler
  runs it as a one-off ECS task per job (CRON_JOB env), invoking the same route
  handler with the `CRON_SECRET` bearer — no ALB timeout exposure.
- **Terraform** `infra/terraform/{sqs,workers}.tf`: SQS queues (+DLQs, 24h
  retention, 10× redrive), the consumer service, EventBridge schedules, and
  least-privilege IAM. All gated by `enable_workers` (default false); schedules
  created `DISABLED`; consumer `desired_count=0` — nothing runs until the
  controlled background cutover.

### Safeguards preserved (unchanged — they live inside the handlers)
- Trusted-price verification + exact product identity gates
  (`src/lib/shopping/action-gates.ts`, trusted-offer logic).
- Tesco controlled egress: `tesco_egress_pool` semaphore + `claim/mark/release`
  RPCs, single-product canary before enqueue, Akamai `blocked_challenge` stop,
  48h quarantine (`src/lib/tesco-egress.ts`, the Tesco trigger + batch handlers).
- Idempotent processing: `scrape_product_receipts` / `dunnes_discovery_receipts`
  checked before any outbound request; `finalize_*` RPCs; `scrape_runs` status
  gating (`runIsActive`), per-delivery `scrape_fetch_attempts`.
- Dunnes/SuperValu transient-error limits + per-product spacing.
- Unresolved-request holds (`tesco-discovery.ts`, `branded-intersection.ts`) and
  alternative-candidate states — a resume never re-attempts held items.
- Subscriber notifications + scheduled tasks (weekly-digest, check-alerts,
  price-watchdog, agent-tasks) run via the scheduled runner with the same logic.

### Reconciliation (no blind replay)
The queue is only an at-least-once wake-up; **durable truth is in Supabase**.
On restart/cutover the handlers:
- early-return when a `scrape_runs` row is no longer `status='running'`
  (so Akamai-failed runs are NOT replayed);
- skip products that already have a receipt;
- honour `tesco_egress_pool.cooldown_until` before claiming;
- resume pepesto batches from `pepesto_tesco_product_batches` status without
  re-spending credits.
`scrape-watchdog` (stuck>3h, failed, degraded, stale>120h) is the health gate to
read before enabling schedules.

### Preventing duplicate workers across AWS and Vercel
- `enable_workers=false` by default → no AWS queues/schedules/consumer exist.
- Even enabled, schedules start `DISABLED` and the consumer at `desired_count=0`.
- The website task keeps retailer/email guards ON (`DISABLE_*=true`) during
  stage 1, so AWS never collects or emails while Vercel does.
- Background cutover is ONE controlled change: enable AWS schedules + scale the
  consumer up AND disable the Vercel crons/queue triggers together — never both
  live. (If Vercel is already suspended, there is no duplication risk.)

---

## Priority 4 — Vercel-independent disaster recovery

The recovery path must work even if Vercel is completely inaccessible.

### Everything needed lives outside Vercel
- Code: GitHub `supermarket-ie/web` (+ this branch/PR).
- Infra: Terraform in-repo; state in the S3 backend (AWS, not Vercel).
- Image: pushed to **ECR** — previous images are retained (ECR lifecycle keeps
  tagged images; only untagged expire after 14 days), so any prior good SHA can
  be redeployed with `terraform apply -var image_tag=<sha>`.
- Secrets: AWS Secrets Manager (versioned).
- Data: Supabase (independent).

### Restore entirely within AWS (no Vercel)
1. From any machine with AWS creds + Docker + the git repo:
   `terraform init -backend-config=backend.hcl` (S3 state) → the full stack is
   described in code.
2. If an image already exists in ECR, skip the build and
   `terraform apply -var image_tag=<last-good-sha>`.
3. If a rebuild is needed, build from the pinned commit and push to ECR.
4. DNS: point `www`/apex at the ALB (registrar is independent of Vercel).

### Image/version retention
- ECR `image_tag_mutability=MUTABLE`, scan-on-push, lifecycle expires ONLY
  untagged images after 14 days — tagged release SHAs persist for rollback.
- Tag every deploy with the git SHA (`image_tag=$SHA`) so a specific prior
  version can always be restored.
- Terraform state in S3 is versioned (bucket versioning on) — prior infra states
  are recoverable.

### Website remains operational WITHOUT workers, with honest freshness
If workers can't be migrated immediately (or are intentionally left on Vercel):
- The site serves fully from Supabase reads; no worker is on the customer path.
- Trusted prices carry freshness; the app's trusted-offer layer treats prices
  older than the freshness window as not-live (fail-closed), so with no refresh
  running, prices **age out of "live" rather than showing stale values as
  current**. Comparisons/deals naturally shrink to what is still fresh.
- `latest_prices` + the trusted-offer gates never substitute plausible
  alternatives, so an idle pipeline degrades to "fewer live prices", never wrong
  prices.
- Recommended while workers are paused: surface a subtle "prices last checked"
  freshness indicator (already supported by the freshness state) and keep the
  `scrape-watchdog` reader available to report staleness.

### Rollback to Vercel (while it still exists)
- DNS revert to the recorded Vercel target (keep TTL low during cutover).
- Nothing in Supabase changes during an AWS deploy, so switching back is a DNS
  operation only.
- If Vercel is suspended, rollback target is a previous AWS image/state instead
  — hence the ECR + S3-state retention above.

---

## Fastest path summary (risk-ordered)

1. **Back up Vercel secrets + DNS target now** (Priority 1) — the only
   truly-irrecoverable items on suspension.
2. **Provision AWS web** (Priority 2, approval-gated) — restores the site.
3. **Enable AWS workers** (Priority 3) — restores price refresh + notifications;
   do it as the single Vercel-off / AWS-on change (or immediately if Vercel is
   already gone).
4. **DR is inherently AWS-only** (Priority 4) — ECR images + S3 state + Secrets
   Manager mean no step depends on Vercel.
