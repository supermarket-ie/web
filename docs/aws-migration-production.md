# AWS production deployment & cutover — Supermarket.ie

Authoritative runbook for moving the **live website** to AWS using the
**existing production Supabase**. Supersedes the preview-only framing in the
earlier phase docs for the production path.

| Decision | Value |
| --- | --- |
| Account | `Supermarket-Prod` |
| Region | `eu-west-1` |
| Hosting | ECS Fargate (1 task) |
| Database | **existing production Supabase** (no copy/branch/migrate) |
| Live domain | `supermarket.ie` / `www.supermarket.ie` |
| Test hostname | `aws-preview.supermarket.ie` (pre-cutover only) |

Hard rules until cutover is approved: do not change production DNS, do not merge
to `main`, do not disable Vercel workers, do not enable duplicate jobs on AWS.

## The one image, two runtime postures

A single image serves both postures; behaviour is chosen by the ECS task env
(Terraform `test_mode`), never baked in:

| | Pre-cutover TEST (`test_mode=true`) | PRODUCTION (`test_mode=false`) |
| --- | --- | --- |
| `APP_ENV` | `preview` | `production` |
| Supabase | **read-only** (all writes blocked in-app, website + Eve agent) | read + write |
| Outbound email | blocked | blocked in stage 1 (stays on Vercel); enabled only with workers in stage 2 |
| Retailer collection | blocked | blocked on AWS (stays on Vercel) until stage-2 worker migration |
| noindex | yes (test host not indexed) | no (production indexable) |

The read-only guard covers **every route** (website service client AND the Eve
agent client) via `src/lib/supabase-readonly-wrap.ts`, so testing against the
real production DB cannot alter customer or trusted-pricing records.

## Background jobs: no duplicates (instructions 5–7)

- Vercel Cron and Vercel Queue delivery target the **Vercel deployment** by
  path, tied to the Vercel project — they do NOT resolve via the public
  `supermarket.ie` DNS. So moving DNS to AWS does **not** redirect them; Vercel
  cron/queues keep firing on Vercel.
- **No customer-facing request path uses Vercel Queues.** Every `@vercel/queue`
  `send()` producer and `handleCallback` consumer lives inside retailer
  collection / cron / workers (all background). The customer website + Eve agent
  have zero queue dependency, so the website move needs no queue replacement.
- AWS cannot self-trigger background jobs: it has no Vercel cron runner and
  Vercel Queues can't deliver to it. Belt-and-braces, the AWS task sets
  `DISABLE_RETAILER_COLLECTION=true`, `DISABLE_OUTBOUND_EMAIL=true` and all
  `*_WORKER_ENABLED=false` during the website migration, so even a direct hit to
  an AWS worker route refuses. Result: retailer collection, price finalisation,
  scheduled emails and background jobs run ONLY on Vercel. No duplication.

Stage 2 (later, controlled) migrates the workers: provision SQS + a consumer
service (or keep queues on Vercel pointing at Vercel), then flip
`enable_retailer_workers_on_aws` / `enable_outbound_email_on_aws` true on AWS AND
disable the Vercel workers in the same change — never both live at once.

## Step 1 — AWS auth, state backend, secrets

Follow `docs/aws-migration-launch.md` §1–§2 for IAM Identity Center login and the
S3 state backend. For secrets, store the **real production** values in Secrets
Manager (the test posture keeps access read-only, so the production key is safe
to supply from the start):

```bash
sm() { aws secretsmanager create-secret --name "$1" --secret-string "$2" --query ARN --output text; }
sm smie-prod/supabase-url        "https://<prod-ref>.supabase.co"
sm smie-prod/supabase-anon       "<prod anon key>"
sm smie-prod/supabase-service    "<prod service-role key>"   # read-only enforced in test_mode
sm smie-prod/magic-link          "<prod MAGIC_LINK_SECRET>"  # must match Vercel for session continuity
sm smie-prod/vendor-magic-link   "<prod VENDOR_MAGIC_LINK_SECRET>"
sm smie-prod/cron-secret         "<prod CRON_SECRET>"
sm smie-prod/revalidate-secret   "<prod REVALIDATE_SECRET>"
sm smie-prod/resend              "<prod RESEND_API_KEY>"
sm smie-prod/anthropic           "<prod ANTHROPIC_API_KEY>"
```

Map NAME -> ARN in `terraform.tfvars` `secret_arns`
(`SUPABASE_SERVICE_ROLE_KEY = <arn of smie-prod/supabase-service>`, etc.).

NOTE on sessions: use the SAME `MAGIC_LINK_SECRET` as Vercel so existing
signed-in `sm_session` cookies keep working across cutover.

## Step 2 — ACM certificate (covers test + production hostnames)

Request ONE cert in eu-west-1 covering all three names, so the same ALB serves
the test host now and the live hosts at cutover without re-issuing:

```bash
CERT_ARN=$(aws acm request-certificate --region eu-west-1 \
  --domain-name www.supermarket.ie \
  --subject-alternative-names supermarket.ie aws-preview.supermarket.ie \
  --validation-method DNS --query CertificateArn --output text)
aws acm describe-certificate --certificate-arn "$CERT_ARN" --region eu-west-1 \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
```

Add ONLY the ACM **validation CNAMEs** to DNS now (ADD-only; touches no existing
www/apex record). Wait for `ISSUED`. Set `acm_certificate_arn = "$CERT_ARN"`.

## Step 3 — Provision + deploy (two-stage), in TEST posture

```bash
# terraform.tfvars:
#   create_resources   = true
#   deploy_application  = false        # stage 1
#   test_mode           = true         # READ-ONLY test against production Supabase
#   name_prefix         = "smie-prod"
#   acm_certificate_arn = "<arn>"
#   public_base_url     = "https://aws-preview.supermarket.ie"
#   secret_arns         = { ... real production ARNs ... }
cd infra/terraform
terraform init -backend-config=backend.hcl
terraform apply                                   # STAGE 1: ECR + net + ALB + IAM
ECR=$(terraform output -raw ecr_repository_url); cd ../..

# Build the DEPLOY image from the repo root (NEXT_PUBLIC_* inlined; service-role
# key via BuildKit secret, never a layer). Use the TEST hostname for now.
SHA=$(git rev-parse --short HEAD)
export SUPABASE_SERVICE_ROLE_KEY="<prod service-role key>"
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin "${ECR%/*}"
DOCKER_BUILDKIT=1 docker build \
  --build-arg BUILD_MODE=deploy \
  --build-arg NEXT_PUBLIC_SITE_URL=https://aws-preview.supermarket.ie \
  --build-arg NEXT_PUBLIC_BASE_URL=https://aws-preview.supermarket.ie \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod-anon> \
  --secret id=supabase_service_role_key,env=SUPABASE_SERVICE_ROLE_KEY \
  -t "$ECR:$SHA" .
docker push "$ECR:$SHA"

cd infra/terraform
# tfvars: deploy_application = true, image_tag = $SHA   (keep test_mode = true)
terraform apply -var "image_tag=$SHA"             # STAGE 2: ECS task + service
terraform output -raw app_url                     # https://aws-preview.supermarket.ie
terraform output -raw alb_dns_name                # CNAME/alias target
```

Add a CNAME `aws-preview -> <alb_dns_name>` (ADD-only). This exposes the TEST
endpoint — read-only, noindex — leaving the live site on Vercel untouched.

## Step 4 — Functional verification (read-only, against production DB)

On `https://aws-preview.supermarket.ie`, verify WITHOUT mutating data:

```bash
H=https://aws-preview.supermarket.ie
curl -sS -o /dev/null -w "%{http_code}\n" $H/                 # 200 homepage
curl -sS -o /dev/null -w "%{http_code}\n" $H/shop             # 200 catalogue
curl -sS "$H/api/products" | head -c 300                      # real product reads
curl -sS -D - -o /dev/null $H/ | grep -i x-robots-tag         # noindex present (test)
curl -sS "$H/robots.txt"                                      # Disallow: /
curl -sS -o /dev/null -w "%{http_code}\n" $H/eve/v1/info      # 200 agent
```

Check: product catalogue + trusted prices render real values; comparisons/deals
load; a signed-in session (existing cookie) can READ household data; the Eve
agent answers. Any write attempt returns `PreviewReadOnlyError` — expected.
Confirm SSL (valid cert chain), security headers, and that no email/retailer
job fired (CloudWatch logs show the guards blocking).

## Step 5 — Flip to PRODUCTION posture (still on the test host)

Once reads look right, switch the app to read/write and re-verify on the test
host BEFORE touching live DNS:

```bash
# Rebuild the image with the PRODUCTION hostname inlined:
DOCKER_BUILDKIT=1 docker build --build-arg BUILD_MODE=deploy \
  --build-arg NEXT_PUBLIC_SITE_URL=https://www.supermarket.ie \
  --build-arg NEXT_PUBLIC_BASE_URL=https://www.supermarket.ie \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<prod-ref>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod-anon> \
  --secret id=supabase_service_role_key,env=SUPABASE_SERVICE_ROLE_KEY \
  -t "$ECR:$SHA-prod" .
docker push "$ECR:$SHA-prod"
# tfvars: test_mode = false, public_base_url = https://www.supermarket.ie,
#         image_tag = $SHA-prod   (enable_retailer_workers_on_aws stays false)
cd infra/terraform && terraform apply -var "image_tag=$SHA-prod"
```

The app is now read/write and indexable, but **still only reachable on the test
host** (live DNS unchanged). Do a careful, minimal authenticated write check
here if desired. Retailer collection + email remain OFF on AWS (Vercel keeps
them). This is the state to demo for cutover approval.

## Step 6 — Cutover (ONLY after approval)

1. Lower TTL on the `www`/apex records (e.g. 60s) ~24h ahead.
2. Repoint DNS:
   - `www.supermarket.ie` -> ALB (`alb_dns_name`) via CNAME/alias.
   - `supermarket.ie` (apex) -> ALB via alias (Route53) or ALIAS/ANAME.
3. Watch: ALB target health, 2xx rate, CloudWatch logs, Supabase connections.
4. Vercel stays deployed and live-capable throughout (workers still running
   there). Do NOT disable Vercel workers yet.

## Rollback (immediate)

Revert the `www`/apex DNS records to the Vercel targets (kept noted before
cutover). With low TTL, traffic returns to Vercel within the TTL window. Nothing
in Supabase changed; AWS can be re-pointed later. `terraform destroy` tears down
AWS entirely if abandoning.

## Shortest remaining path (summary)

1. You: AWS access + confirm production Supabase is the target.
2. Create S3 state backend + Secrets Manager entries (real prod values).
3. Request the ACM cert (3 names) + add validation CNAMEs.
4. Stage-1 apply → build/push deploy image (test host) → stage-2 apply (test_mode=true).
5. Add `aws-preview` CNAME; run read-only functional verification.
6. Flip `test_mode=false` (prod hostname image); re-verify on the test host.
7. Approve → cutover DNS. Rollback = revert DNS to Vercel.

Workers migrate later in a controlled stage 2.
