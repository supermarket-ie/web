# AWS migration — Phase 3: deployable preview (IaC, CI, safety)

## Review corrections (PR #265 follow-up)

Three review findings addressed, plus CI Docker verification:

1. **ECR/image before ECS (deploy ordering).** Provisioning is now two staged
   applies via `deploy_application`. Stage 1 (`deploy_application=false`) creates
   ECR + network + ALB + IAM; CI then pushes the image to the new ECR repo;
   stage 2 (`deploy_application=true`) adds the ECS task + service that pull the
   already-pushed tag. ECS can no longer start before its image exists.
2. **HTTPS before auth / non-public data.** The ECS task/service exist only in
   stage 2, and an ALB `precondition` makes `acm_certificate_arn` mandatory
   there — so the application is only ever served over HTTPS. Plain HTTP is
   restricted to an appless stage-1 smoke test whose listener returns a fixed
   200 string and forwards nothing (no auth/data route reachable over HTTP).
   `public_base_url` must be an `https://` URL at stage 2.
3. **Full Supabase isolation (not just workers/email).** `SUPABASE_READ_ONLY`
   (forced on by `APP_ENV=preview`) wraps the shared service-role client so
   every write — `insert/update/upsert/delete` and mutating RPCs — throws
   `PreviewReadOnlyError`, from ANY route (subscribe, auth, vendor, agent tools,
   ops, etc.), independently of the key's own privileges. Read selects and an
   allowlist of read-only RPCs pass through. This is defence in depth on top of
   using a restricted/read-only Supabase key. Verified by
   `src/lib/__tests__/supabase-readonly.test.ts`.

**CI Docker build verified:** GitHub Actions run 39020696818 built the real
Docker image successfully (job "Docker image build (validation only, no push)",
~4m52s) alongside passing lint/test/build and `terraform validate`.

---

Branch: `infra/aws-migration`. **No AWS resources were provisioned**, no
production/DNS/Supabase/Vercel changes made, no scraping/email/schedules run.
This phase delivers review-ready infrastructure code, a safe CI workflow, the
in-app preview safety guards, isolated DB fixtures, and the exact deploy/rollback
steps.

## 1. Summary of what was added

| Area | Deliverable |
| --- | --- |
| Platform-neutral env | `src/lib/runtime-env.ts` — `APP_ENV` first, `VERCEL_ENV` fallback; drives preview + noindex. |
| Preview safety guard | `src/lib/preview-guard.ts` — fail-closed `retailerCollectionBlocked()` / `outboundEmailBlocked()`; wired into all retailer trigger routes and the Resend client. |
| Noindex | `next.config.ts` + `src/app/robots.ts` now noindex staging **and** any preview. |
| IaC | `infra/terraform/*` — VPC, SGs, ECR, IAM, ALB, ECS Fargate, logs. All gated by `create_resources` (default false). |
| CI | `.github/workflows/aws-preview-build.yml` — lint/test/build + Docker build + `tofu/terraform validate`. No deploy, no push, no AWS creds. |
| Fixtures | `infra/preview-fixtures/*` — synthetic data + guarded seed script for an isolated Supabase branch/clone. |

## 2. Preview safety model (defence in depth)

Four independent layers ensure the preview has no production side effects:

1. **Supabase read-only client** (`SUPABASE_READ_ONLY`, forced by
   `APP_ENV=preview`): the shared service-role client rejects every write from
   ANY route — `insert/update/upsert/delete` and mutating RPCs throw
   `PreviewReadOnlyError`. This is the primary production-isolation control and
   does not rely on per-route guards. Verified by
   `src/lib/__tests__/supabase-readonly.test.ts`.
2. **In-app worker/email guard** (`APP_ENV=preview`): every retailer collection
   trigger returns `503 blocked_preview` before any outbound request;
   `resend.emails.send` is short-circuited to a no-op. Covers 11 worker routes +
   all 13 email call sites. Verified by `src/lib/__tests__/preview-guard.test.ts`.
3. **Explicit env kill-switches**: `DISABLE_RETAILER_COLLECTION=true`,
   `DISABLE_OUTBOUND_EMAIL=true`, `SUPABASE_READ_ONLY=true`, and all
   `*_WORKER_ENABLED=false`, set in the ECS task definition.
4. **Infrastructure**: no EventBridge/cron schedules exist, no NAT/static egress
   exists (so Tesco can't reach the internet with a controlled identity), the
   Supabase key is a restricted/read-only credential, and the app is HTTPS-only.

None of these weaken existing safeguards — the per-store flags, `CRON_SECRET`
auth, egress pool, cooldowns and idempotency receipts all remain. The guards are
additional early returns / a client wrapper.

## 3. Infrastructure (Terraform/OpenTofu)

Validated locally with OpenTofu 1.13 (Terraform-compatible):
`fmt -check` clean, `init -backend=false` ok, `validate` → **"configuration is
valid."** A `plan` against AWS was not run here (no AWS credentials in the dev
environment, by design); every resource is guarded so the default plan is empty.

Topology (when applied): public+private subnets across 2 AZs → ALB (HTTP, +HTTPS
when a cert ARN is supplied) → 1 Fargate task running the two-process container
→ external Supabase/Anthropic/Resend. NAT Gateway is defined but **off**.

See `infra/terraform/README.md` for the full resource list and usage.

## 4. Exact deployment commands (Phase 3 bring-up, after approval)

Prerequisites: AWS creds for `Supermarket-Prod`, an isolated Supabase access
path (branch or read-only key), Docker, and Terraform/OpenTofu.

```bash
# 0) One-time: create secrets in Secrets Manager (eu-west-1). Example:
aws secretsmanager create-secret --name smie-preview/supabase-readonly \
  --secret-string '<RESTRICTED READ-ONLY KEY>'          # NEVER the prod service-role key
# ...repeat for supabase-url, supabase-anon, magic-link, vendor-magic-link,
#    cron-secret, revalidate-secret, resend, anthropic.

# 1) Provision ECR + network + ALB + ECS (guard ON, secret ARNs filled in tfvars)
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # set create_resources=true, secret_arns, image_tag
terraform init                                  # configure a backend first
terraform apply                                 # review plan, then approve

# 2) Build & push the image to the new ECR repo
ECR=$(terraform output -raw ecr_repository_url)
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin "${ECR%/*}"
docker build -t "$ECR:$(git rev-parse --short HEAD)" .
docker push "$ECR:$(git rev-parse --short HEAD)"

# 3) Point the service at the pushed tag and roll
terraform apply -var "image_tag=$(git rev-parse --short HEAD)"

# 4) (Optional) seed an isolated Supabase branch with fixtures
PREVIEW_SUPABASE_URL=https://<preview-ref>.supabase.co \
PREVIEW_SUPABASE_SERVICE_ROLE_KEY=<preview-key> \
node infra/preview-fixtures/seed-preview-db.mjs --confirm-isolated

# 5) Smoke test (AWS-generated ALB hostname; no production DNS)
URL=$(terraform output -raw preview_url)
curl -i "$URL/"            # 200
curl -i "$URL/terms"       # 200
curl -i "$URL/eve/v1/info" # 200 (agent proxy)
curl -i "$URL/api/products" # 200 with read-only DB, or 503 if DB intentionally absent
```

## 5. Cost estimate (preview, eu-west-1, USD/month)

| Item | Assumption | Est. |
| --- | --- | --- |
| Fargate | 1× 0.5 vCPU / 1 GB, always-on | ~$18 |
| ALB | 1 ALB, low LCU | ~$18–22 |
| ECR | 1 repo, few images | ~$1 |
| CloudWatch Logs | 14-day retention, low volume | ~$2–5 |
| Secrets Manager | ~9 secrets | ~$3–4 |
| Data transfer | low preview traffic | ~$1–3 |
| **Preview total** | no CloudFront, no NAT | **~$45–55** |

Scale-up / production additions (not in preview): NAT Gateway ~$32/mo + data
(Tesco egress), SQS (cents at this volume), EventBridge (negligible), and a
shared ISR cache if running >1 task. If the 2-process container OOMs at 1 GB,
move to 1 vCPU / 2 GB (~+$17/mo).

## 6. Rollback / teardown

| Scenario | Action | Production impact |
| --- | --- | --- |
| Abandon preview | `terraform destroy` in `infra/terraform` | None — preview is fully isolated |
| Bad image | `terraform apply -var image_tag=<previous-sha>` or `aws ecs update-service --force-new-deployment` | None |
| Revert code | branch is unmerged; nothing is on `main` or Vercel | None |
| DNS | none used (AWS-generated hostname only) | N/A |

Vercel production remains the live system throughout; it is untouched and is the
instant fallback. Cutover (DNS switch) is a later, separately-approved phase.

## 7. Remaining prerequisites before deploying the preview

1. **AWS access** to `Supermarket-Prod` (none in the dev environment used here).
2. **Isolated Supabase** branch or restricted read-only key + secret ARNs.
3. **Docker image build** executed in CI or a Docker host (this environment has
   no Docker; the Dockerfile and entrypoint were verified with Node in Phase 2,
   and the CI workflow builds the image on every run).
4. **Terraform backend** (S3+DynamoDB) chosen for state.
5. **Memory sizing** confirmation on first deploy (1 GB vs 2 GB).
6. Optional: ACM certificate for HTTPS on a preview subdomain (otherwise HTTP
   smoke test on the ALB hostname; app enforces noindex regardless).

## 8. Test results (this phase)

- `npm test`: 59 files / 578 tests pass (was 58/570; +1 file/+8 for the guard).
- `npm run test:behavioural`: 16/16 pass.
- `npm run lint`: 0 errors, 22 pre-existing warnings (none from new files).
- `npm run build` with `APP_ENV=preview`: succeeds, `BUILD_ID` produced.
- OpenTofu `fmt`/`init`/`validate`: all pass.
- Seed script guards: reject missing `--confirm-isolated` and the production ref.
