# AWS migration — Phase 3: deployable preview (IaC, CI, safety)

Branch: `infra/aws-migration`. This is the single current procedure for the
isolated AWS preview. **No AWS resources are provisioned by reviewing this**; no
production/DNS/Supabase/Vercel changes; no scraping/email/schedules.

Account `Supermarket-Prod`, region `eu-west-1`. Preview served over HTTPS on a
hostname you control (never production DNS). Database is a **separate Supabase
project or branch**, accessed read-only.

## 1. What was added

| Area | Deliverable |
| --- | --- |
| Platform-neutral env | `src/lib/runtime-env.ts` — `APP_ENV` first, `VERCEL_ENV` fallback; drives preview + noindex. |
| Supabase read-only guard | `src/lib/supabase.ts` wraps the service-role client; `src/lib/preview-guard.ts` exposes `supabaseReadOnly()`. |
| Worker/email guards | `src/lib/preview-guard.ts` — `retailerCollectionBlocked()` / `outboundEmailBlocked()`; wired into all retailer triggers + the Resend client. |
| Noindex | `next.config.ts` + `src/app/robots.ts` noindex staging **and** any preview. |
| IaC | `infra/terraform/*` — VPC, SGs, ECR, IAM, ALB, ECS Fargate, logs. Gated by `create_resources` + two-stage `deploy_application`. |
| CI | `.github/workflows/aws-preview-build.yml` — lint/test/build + Docker image build + `terraform validate`. No deploy, no push, no AWS creds. |
| Fixtures | `infra/preview-fixtures/*` — synthetic data + guarded seed script for an isolated writable dev DB. |

## 2. Isolation model — read the limits

**The preview database MUST be a separate Supabase project or branch, accessed
with a restricted/read-only key.** That is the isolation boundary. The in-app
`supabaseAdmin` read-only proxy is **defence in depth, not the boundary** — do
not rely on it alone to protect production.

Layers (each independent):

1. **Separate Supabase project/branch + read-only key** — the actual isolation.
2. **Supabase read-only client proxy** (`SUPABASE_READ_ONLY`, forced by
   `APP_ENV=preview`): blocks `insert/update/upsert/delete` and mutating/4
   third-party RPCs from ANY route (`PreviewReadOnlyError`). The RPC allowlist is
   minimal: only pure read RPCs (`match_product_search_embeddings`).
   `get_pepesto_api_key` is deliberately **blocked** so the preview never fetches
   a third-party credential or calls Pepesto.
3. **Worker/email guards** (`APP_ENV=preview` + `DISABLE_*` env): retailer
   triggers return `503`; email sends no-op.
4. **Infrastructure**: no schedules, no NAT/static egress, HTTPS-only app.

### What a read-only preview CANNOT exercise

Because all writes are blocked, these flows will **not** work in the read-only
preview and must be tested later against an **isolated writable development
database** (not production):

- Registration / subscribe / magic-link issuance (writes `subscribers`,
  `registration_continuations`).
- Shopping-list creation and persistence (writes `list_items`, lists).
- Agent actions that persist (saved shops, watches, household insights,
  `agent_tasks`, `agent_notifications`).
- Vendor signup.
- Anything calling a write/finalise RPC.

What the read-only preview CAN validate: public pages, catalogue/pricing reads,
comparisons, deals, the agent's read/explain paths, auth-gated *reads* with a
seeded session, health (`/terms`), and the Eve proxy (`/eve/v1/*`).

To exercise writes, repeat the deploy against a writable isolated dev Supabase
with `APP_ENV` unset-for-writes (or a dedicated `dev` env) and seed it using
`infra/preview-fixtures/seed-preview-db.mjs`. That is a separate, later step.

## 3. NEXT_PUBLIC_* are build-time — the image must carry real preview values

Next.js inlines `process.env.NEXT_PUBLIC_*` into the build; they **cannot** be
overridden at runtime. So the **deploy image is built with the real preview
values as build args** (`BUILD_MODE=deploy`), never placeholders:

- `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_BASE_URL` → the HTTPS preview hostname.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` → the isolated
  preview project (these are server-only in this app today, but are still passed
  correctly so nothing placeholder/production can leak into the bundle).

The Dockerfile **fails the build** if `BUILD_MODE=deploy` is used with any
placeholder `NEXT_PUBLIC_*`. Server-only secrets (service-role key, Resend,
Anthropic, JWT secrets) are NOT build inputs — they are injected at runtime by
ECS from Secrets Manager.

`BUILD_MODE=ci` (default) builds with placeholders + the empty-catalogue escape
hatch for CI validation only; such an image must never be deployed.

The deploy build renders against the real (read-only) preview Supabase, so the
build host must be able to reach it over the network.

## 4. The one deployment procedure (after approval)

All commands run from the **repository root**. Prerequisites: AWS creds for
`Supermarket-Prod`; a separate Supabase project/branch + restricted read-only
key; an ACM cert for the preview hostname; Docker; Terraform (or OpenTofu); a
Terraform state backend.

```bash
# 0) Secrets in Secrets Manager (eu-west-1). Example names (values NOT shown):
aws secretsmanager create-secret --name smie-preview/supabase-readonly --secret-string '<READ-ONLY KEY>'
#    repeat: supabase-url, supabase-anon, magic-link, vendor-magic-link,
#            cron-secret, revalidate-secret, resend, anthropic.
#    Request/validate an ACM cert for the preview hostname (e.g. preview.supermarket.ie).

# 1) STAGE 1 — ECR + network + ALB + IAM (no ECS task yet)
#    terraform.tfvars: create_resources=true, deploy_application=false,
#                      acm_certificate_arn=<arn>, public_base_url=https://<preview-host>,
#                      secret_arns={...}
cd infra/terraform
terraform init            # configure the backend first
terraform apply
ECR=$(terraform output -raw ecr_repository_url)
cd ../..                  # back to repo root

# 2) Build the DEPLOY image from the repo root and push it to ECR
SHA=$(git rev-parse --short HEAD)
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin "${ECR%/*}"
docker build \
  --build-arg BUILD_MODE=deploy \
  --build-arg NEXT_PUBLIC_SITE_URL=https://<preview-host> \
  --build-arg NEXT_PUBLIC_BASE_URL=https://<preview-host> \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<preview-ref>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<preview-anon-key> \
  -t "$ECR:$SHA" .
docker push "$ECR:$SHA"

# 3) STAGE 2 — add the ECS task + service pointing at the pushed tag
#    terraform.tfvars: deploy_application=true, image_tag=$SHA
cd infra/terraform
terraform apply -var "image_tag=$SHA"
terraform output -raw preview_url     # the HTTPS hostname (ACM-covered), NOT the ALB DNS

# 4) Point the preview hostname at the ALB (zone you control; not production DNS)
terraform output -raw alb_dns_name    # CNAME/alias target for <preview-host>

# 5) Smoke test over HTTPS
curl -i https://<preview-host>/           # 200
curl -i https://<preview-host>/terms      # 200
curl -i https://<preview-host>/eve/v1/info # 200 (agent proxy)
curl -i https://<preview-host>/api/products # 200 against read-only DB
```

HTTP is only available as an appless stage-1 smoke test (fixed 200, forwards
nothing) if `allow_http_only_smoke_test=true` and `deploy_application=false`.

## 5. Cost estimate (preview, eu-west-1, USD/month)

| Item | Assumption | Est. |
| --- | --- | --- |
| Fargate | 1× **1 vCPU / 2 GB**, always-on | ~$35 |
| ALB | 1 ALB, low LCU | ~$18–22 |
| ECR | 1 repo, few images | ~$1 |
| CloudWatch Logs | 14-day retention, low volume | ~$2–5 |
| Secrets Manager | ~9 secrets | ~$3–4 |
| ACM | public cert | $0 |
| S3 state + data transfer | tiny | ~$1–3 |
| **Preview total** | no CloudFront, no NAT | **~$58–66** |

This matches the ~$55–65/mo target. Dropping to 0.5 vCPU / 1 GB saves ~$17/mo
(~$45–55 total) once the container proves comfortable. Not in the preview: NAT
Gateway (~$32/mo + data, Tesco egress — production phase), SQS, EventBridge,
shared ISR cache.

## 6. Rollback / teardown

| Scenario | Action | Production impact |
| --- | --- | --- |
| Abandon preview | `terraform destroy` | None — preview is isolated |
| Bad image | `terraform apply -var image_tag=<previous-sha>` or `aws ecs update-service --force-new-deployment` | None |
| Revert code | branch is unmerged; nothing on `main`/Vercel | None |
| DNS | preview hostname lives in a non-production zone | None |

Vercel production stays live throughout and is the instant fallback.

## 7. What is still required before launch

See the PR description / completion report. In short: AWS access to
`Supermarket-Prod`, a separate Supabase project/branch + read-only key as secret
ARNs, an ACM cert + preview hostname, and a Terraform state backend.

## 8. Test results (current)

- `npm test`: 60 files / 584 tests pass.
- `npm run test:behavioural`: 16/16.
- `npm run lint`: 0 errors (pre-existing warnings only).
- `npm run build` (`APP_ENV=preview`): succeeds.
- OpenTofu `fmt`/`validate`: pass.
- CI (`AWS preview build & test`): lint/test/build + real Docker image build +
  terraform validate all green.
