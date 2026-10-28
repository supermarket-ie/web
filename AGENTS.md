# supermarket.ie agent instructions

Before investigating, planning, or changing this repository, read
`PROJECT_STATE.md` in full and then read any specialist document it identifies
for the task, including `docs/retailer-execution.md` for retailer work.

After any material production finding, architecture decision, retailer-feed
change, deployment, migration, or operational change, update
`PROJECT_STATE.md` in the same pull request. Do not rely on chat history as the
project source of truth.

## Production platform: AWS (Vercel is decommissioned)

Production runs entirely on **AWS** in eu-west-1 (account 611622961299):
- Website + Eve agent: ECS Fargate service `smie-prod-svc` on cluster
  `smie-prod-cluster`, behind the ALB `smie-prod-alb`. `www.supermarket.ie`
  resolves to the ALB; the apex 301-redirects to `www`.
- Background queues: Amazon SQS + the `smie-prod-sqs-consumer` ECS service
  (`QUEUE_BACKEND=sqs`). Scheduled jobs: EventBridge Scheduler → one-off ECS
  tasks. Container image: ECR repo `smie-prod`.
- Deploy process: build/push an image (manual `Build & push deploy image to
  ECR` GitHub Actions workflow, `workflow_dispatch` only) tagged with the git
  SHA, then roll it out with `terraform apply -var image_tag=<sha>` in
  `infra/terraform`. There is no automatic deploy on merge.

**Vercel is no longer part of the architecture.** It is not on the customer
path, is not a deploy target, and is NOT a release gate. If a `vercel[bot]`
GitHub commit status (e.g. "Account is blocked") appears on a PR or commit,
ignore it — the authoritative required check is the GitHub Actions **`validate`**
job (see `.github/workflows/ci.yml` and the "Protect main" ruleset). Do not
treat a Vercel status as a production signal.

Where live state may have changed, verify GitHub `main`, the **AWS** production
services (ECS/ALB) and Supabase before acting. Do not treat a merged pull
request as a successful production release until the ECS rollout and relevant
production behaviour have been verified.
