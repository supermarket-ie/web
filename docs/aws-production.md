# Supermarket.ie — authoritative production architecture (AWS)

Last updated: 28 October 2026. This is the steady-state reference after the
Vercel → AWS migration completed. For the historical migration mechanics and
disaster-recovery reasoning see `docs/aws-deploy-today.md`,
`docs/aws-migration-production.md` and `docs/vercel-independence.md` (the latter
is marked HISTORICAL). **Vercel is decommissioned — see "Vercel status" below.**

## Where production runs

AWS account **611622961299 (Supermarket-Prod)**, region **eu-west-1**.

| Concern | Resource |
| --- | --- |
| Website + Eve agent | ECS Fargate service `smie-prod-svc` on cluster `smie-prod-cluster` (desired 2) |
| Ingress / TLS | ALB `smie-prod-alb` (`smie-prod-alb-48303444.eu-west-1.elb.amazonaws.com`); Global Accelerator static IPs for the apex |
| DNS | `www.supermarket.ie` → ALB; apex `supermarket.ie` → 301 → `www` (served by the ALB) |
| Background queues | Amazon SQS + ECS service `smie-prod-sqs-consumer` (desired 1); `QUEUE_BACKEND=sqs` |
| Scheduled jobs | EventBridge Scheduler → one-off ECS tasks (`src/workers/scheduled-runner.ts`) |
| Container images | ECR repo `smie-prod` (tagged per git SHA; untagged expire after 14 days) |
| Secrets | AWS Secrets Manager (`smie-prod/*`) |
| Infrastructure as code | `infra/terraform` (state in S3, versioned) |

The website has no queue/cron dependency on the customer path — it serves from
Supabase reads. Workers (SQS consumer + schedules) handle price refresh and
notifications.

## Deploy process (authoritative)

There is **no automatic deploy on merge.** A deploy is two explicit steps:

1. **Build & push the image** — run the GitHub Actions workflow
   **`Build & push deploy image to ECR`** (`.github/workflows/aws-ecr-deploy-image.yml`),
   which is `workflow_dispatch` only and gated on the protected `aws-prod`
   environment. Choose `image_mode=prod`. It builds via BuildKit (service-role
   key as a secret mount, never a layer) and pushes `…/smie-prod:<sha>-prod` to
   ECR. It does NOT run Terraform, change DNS, or touch the ECS service.
2. **Roll it out** — `terraform apply -var image_tag=<sha>-prod` in
   `infra/terraform`. ECS does a rolling, zero-downtime replacement
   (`deployment_minimum_healthy_percent=50`, max 200%, deployment circuit
   breaker with auto-rollback).

Rollback: `terraform apply -var image_tag=<previous-good-sha>-prod` (prior ECR
images are retained). Nothing in Supabase changes during a deploy.

## CI / release gate

- The required status check on `main` is the GitHub Actions **`validate`** job
  (`.github/workflows/ci.yml`: lint, unit tests, scraper typechecks, behavioural
  gate, Next build). Enforced by the repository ruleset **"Protect main"**
  (squash-only merges, review-thread resolution, `validate` required, no
  force-push, no deletion).
- `aws-preview-build.yml` is build/validate-only (no deploy, no registry push,
  no AWS credentials); it runs on the now-defunct `infra/aws-migration` branch
  and manual dispatch.

## Vercel status (decommissioned)

Vercel is **not** part of production: not on the customer path, not a deploy
target, not a release gate.

- Removed from the repo: `vercel.json` (Vercel-only deploy directives) and the
  `public/vercel.svg` template asset.
- Retained deliberately: the `@vercel/queue` dependency and the `vercel` branch
  of the queue facade (`src/lib/queue/index.ts`). It is inert in production
  (`QUEUE_BACKEND=sqs`, the package is only `await import()`-ed when the backend
  is `vercel`) and kept only as a code-level fallback. Safe to remove in a later
  pass together with that branch; not removed here because it is still wired
  into a live module and removing it is a behavioural change, not housekeeping.
- A `vercel[bot]` GitHub **commit status** ("Account is blocked") and
  `vercel[bot]` GitHub **Deployment** objects may still appear. These are
  produced by the Vercel GitHub App integration that is still linked to this
  GitHub repo at the **account level**, not by anything in the repository. They
  are cosmetic, do not gate merges, and do not deploy anything to AWS. Ignore
  them in release reporting.

### Account-level cleanup still required (manual, not possible from the repo)

To stop the `vercel[bot]` statuses/deployments entirely, do ONE of:

1. **Vercel dashboard** → the Supermarket.ie project → Settings → Git →
   **Disconnect** the GitHub repository (and optionally delete/pause the
   project). This stops Vercel reacting to pushes.
2. **GitHub** → the `supermarket-ie` account Settings → Applications → Installed
   GitHub Apps → **Vercel** → Configure → remove access to `supermarket-ie/web`
   (or uninstall the app).

Either requires account/owner access that the repo tooling and the CI token do
not have. Until one is done, the Vercel status is expected and harmless.

**Do not** add the Vercel status to the "Protect main" ruleset or any required
check, and do not weaken that ruleset to hide the status.
