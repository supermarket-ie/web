# AWS preview — launch runbook

The exact, minimal steps to bring up the Supermarket.ie AWS preview.

| Decision | Value |
| --- | --- |
| Account | `Supermarket-Prod` |
| Region | `eu-west-1` |
| Preview hostname | `aws-preview.supermarket.ie` |
| Hosting | ECS Fargate (1 task) |
| Database | isolated Supabase **dev project/branch**, read-only — never production |
| Terraform state | S3 backend with locking |
| Budget target | ~$55–65 / month |

Guardrails still in force: no merge to `main`, no production Supabase, no
retailer collection, no emails, no live DNS changes, no billable AWS resources
until you run the applies yourself after approval.

---

## 1. AWS auth — IAM Identity Center (SSO) for Supermarket-Prod

```bash
# One-time SSO profile setup (interactive).
aws configure sso
#   SSO start URL : https://<your-sso-portal>.awsapps.com/start
#   SSO region    : eu-west-1
#   Account       : Supermarket-Prod  (choose from the list)
#   Role          : a role with admin/power-user for the first bring-up
#   Default region: eu-west-1
#   Profile name  : smie-prod

# Each session:
aws sso login --profile smie-prod
export AWS_PROFILE=smie-prod
export AWS_REGION=eu-west-1

# Verify identity (should show the Supermarket-Prod account id):
aws sts get-caller-identity
```

All later commands assume `AWS_PROFILE=smie-prod` and `AWS_REGION=eu-west-1`.

## 2. Terraform state backend (S3 + locking)

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="smie-preview-tfstate-${ACCOUNT_ID}"

# State bucket: versioned, encrypted, private.
aws s3api create-bucket --bucket "$BUCKET" --region eu-west-1 \
  --create-bucket-configuration LocationConstraint=eu-west-1
aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Locking: native S3 lockfile (Terraform >= 1.10 / OpenTofu >= 1.9) needs no
# DynamoDB. For older CLIs, create a lock table instead and use dynamodb_table:
# aws dynamodb create-table --table-name smie-preview-tflock \
#   --attribute-definitions AttributeName=LockID,AttributeType=S \
#   --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST

# Point Terraform at the backend:
cd infra/terraform
cp backend.hcl.example backend.hcl        # set bucket = $BUCKET
terraform init -backend-config=backend.hcl
```

## 3. Secrets Manager — minimal required set

Only what the **first read-only preview actually exercises** needs a real value.
Everything the preview does NOT exercise gets a harmless placeholder so nothing
real (or production) is present.

```bash
sm() { aws secretsmanager create-secret --name "$1" --secret-string "$2" \
  --query ARN --output text; }

# --- REAL values required (isolated preview only) ---
# Isolated Supabase DEV project/branch — NOT production:
sm smie-preview/supabase-url        "https://<preview-ref>.supabase.co"
sm smie-preview/supabase-anon       "<preview anon key>"
sm smie-preview/supabase-readonly   "<preview RESTRICTED READ-ONLY key>"   # NOT prod service-role
# Anthropic: the Eve agent's read/explain path uses it. Use a low-limit/dev key.
sm smie-preview/anthropic           "<anthropic api key>"
# Session signing — any strong random value (preview-only, lets signed-in READS work):
sm smie-preview/magic-link          "$(openssl rand -hex 32)"

# --- PLACEHOLDERS (features disabled/unexercised in a read-only preview) ---
# Email is hard-disabled (APP_ENV=preview); Resend never called:
sm smie-preview/resend              "re_preview_placeholder"
# Cron/worker triggers are blocked; value just satisfies the route guard:
sm smie-preview/cron-secret         "$(openssl rand -hex 16)"
# On-demand revalidation not exercised:
sm smie-preview/revalidate-secret   "$(openssl rand -hex 16)"
# Vendor signup is a write (blocked in read-only preview):
sm smie-preview/vendor-magic-link   "preview-placeholder-not-used"
```

Why these and not more: SCRAPINGBEE / GOOGLE_ANALYTICS are not needed (no
scraping, no analytics writes in preview), and the Pepesto credential RPC is
blocked, so no Pepesto key is required. See §6 of `aws-migration-phase3.md`.

Put the resulting ARNs into `infra/terraform/terraform.tfvars` `secret_arns`
(map NAME -> ARN), e.g. `SUPABASE_SERVICE_ROLE_KEY = <arn of supabase-readonly>`.

## 4. ACM certificate + DNS for aws-preview.supermarket.ie

This adds ONE new record; it does not touch existing website records.

```bash
# Request a public cert in eu-west-1 (same region as the ALB):
CERT_ARN=$(aws acm request-certificate \
  --domain-name aws-preview.supermarket.ie \
  --validation-method DNS \
  --region eu-west-1 \
  --query CertificateArn --output text)

# Get the DNS validation CNAME to add:
aws acm describe-certificate --certificate-arn "$CERT_ARN" --region eu-west-1 \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'
```

DNS actions (in the `supermarket.ie` zone, ADD-only — do not edit/remove any
existing record):
1. Add the ACM **validation CNAME** from the command above. Wait until the cert
   status is `ISSUED`.
2. After Terraform stage 2, add ONE record for the preview host pointing at the
   ALB (output `alb_dns_name`):
   - Route53: an **A/ALIAS** to the ALB, or
   - any DNS: a **CNAME** `aws-preview` -> `<alb_dns_name>`.

No `www`, apex, or other existing records are modified.

Set `acm_certificate_arn = "$CERT_ARN"` in `terraform.tfvars`.

## 5. Two-stage deploy (ECR → image → ECS)

All commands run from the **repository root**.

```bash
cd infra/terraform
# terraform.tfvars: create_resources=true, deploy_application=false,
#   acm_certificate_arn=<arn>, public_base_url=https://aws-preview.supermarket.ie,
#   secret_arns={...}, task_memory=2048 (see cost note)
terraform apply                                  # STAGE 1: ECR + net + ALB + IAM
ECR=$(terraform output -raw ecr_repository_url)
cd ../..

# Build the DEPLOY image from the repo root. NEXT_PUBLIC_* are inlined; the
# read-only Supabase key is passed as a BuildKit SECRET (not a layer/ARG).
SHA=$(git rev-parse --short HEAD)
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin "${ECR%/*}"
DOCKER_BUILDKIT=1 docker build \
  --build-arg BUILD_MODE=deploy \
  --build-arg NEXT_PUBLIC_SITE_URL=https://aws-preview.supermarket.ie \
  --build-arg NEXT_PUBLIC_BASE_URL=https://aws-preview.supermarket.ie \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<preview-ref>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<preview-anon-key> \
  --secret id=supabase_service_role_key,env=SUPABASE_SERVICE_ROLE_KEY \
  -t "$ECR:$SHA" .
# ^ export SUPABASE_SERVICE_ROLE_KEY=<preview READ-ONLY key> in your shell first.
docker push "$ECR:$SHA"

cd infra/terraform
# terraform.tfvars: deploy_application=true, image_tag=$SHA
terraform apply -var "image_tag=$SHA"            # STAGE 2: ECS task + service
terraform output -raw app_url                # https://aws-preview.supermarket.ie
terraform output -raw alb_dns_name               # CNAME/alias target for DNS
```

Then add the DNS record (§4 step 2) and smoke test:

```bash
curl -i https://aws-preview.supermarket.ie/           # 200
curl -i https://aws-preview.supermarket.ie/terms      # 200
curl -i https://aws-preview.supermarket.ie/robots.txt # Disallow: /
curl -i https://aws-preview.supermarket.ie/eve/v1/info # 200 (agent)
```

## Cost at the chosen sizing (~$55–65/mo target)

Preview baseline is ~$45–55/mo at 0.5 vCPU / 1 GB. For headroom on the
two-process container we set **task_memory = 2048 (1 vCPU / 2 GB)**, which lands
the total at roughly **$58–66/mo** — within the target. Drop back to 1 GB to
save ~$17/mo if the container proves comfortable.

## Rollback

`terraform destroy` removes all preview resources (nothing production is
touched). Vercel remains the live system. The only DNS additions are the ACM
validation CNAME and the `aws-preview` record — remove those to fully revert.
