# Supermarket.ie — AWS preview infrastructure (Terraform)

Single-task ECS Fargate preview for the Vercel → AWS migration. Account
`Supermarket-Prod`, region `eu-west-1`. **Review-only until approved** — every
resource is gated behind `create_resources` (default `false`), so a default
`terraform plan` creates nothing.

## What this provisions (when `create_resources = true`)

- VPC with public + private subnets across 2 AZs, IGW, route tables.
  (NAT Gateway is optional and OFF — the preview doesn't need egress control.)
- Security groups: ALB (443/80 from internet) and service (app port from ALB only).
- ECR repository (scan on push, untagged-image lifecycle expiry).
- IAM: ECS execution role (pull image, logs, read ONLY the mapped secret ARNs)
  and a task role with no policies (the app calls no AWS APIs).
- ALB + target group (health check on `/terms`) + HTTP listener
  (+ HTTPS listener when `acm_certificate_arn` is set).
- ECS Fargate cluster, CloudWatch log group, task definition (two-process
  container via the image entrypoint), and a 1-task service.

## Safety properties baked in

- `APP_ENV=preview` engages the in-app preview guard (no retailer collection,
  no outbound email) — see `src/lib/preview-guard.ts`.
- **Supabase read-only isolation**: `SUPABASE_READ_ONLY=true` makes the shared
  service-role client reject every write (`insert/update/upsert/delete` and
  mutating RPCs) from ANY route — not just workers/email. This is enforced
  in-app on top of using a restricted/read-only key; either control alone
  prevents production writes.
- **HTTPS required for the app**: the ECS task/service only exist in stage 2,
  and stage 2 requires `acm_certificate_arn`. Plain HTTP is only ever an appless
  stage-1 smoke test (fixed 200, forwards nothing).
- Belt-and-braces env: `DISABLE_RETAILER_COLLECTION=true`,
  `DISABLE_OUTBOUND_EMAIL=true`, all `*_WORKER_ENABLED=false`.
- No EventBridge/cron schedules are created, so no scheduled job can run.
- No NAT / static egress, so no Tesco egress identity exists.
- `SUPABASE_SERVICE_ROLE_KEY` must map to a RESTRICTED/READ-ONLY key via
  `secret_arns` — never the production service-role key.
- No secret values live in Terraform; only ARNs pointing at Secrets Manager/SSM.

## Usage (review / validate — safe anywhere)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in ARNs; keep create_resources=false

terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform plan                                 # guard off → zero resources
```

## Ordered deploy flow (after approval, Supermarket-Prod creds)

The deploy is **two staged applies** so ECS never starts before its image
exists, and so the app is only ever served over HTTPS.

```bash
# 0) Create secrets in Secrets Manager/SSM (read-only Supabase key included)
#    and an ACM cert for the preview subdomain.

# --- Stage 1: ECR + network + ALB + IAM (NO ECS task yet) ---
#   create_resources=true, deploy_application=false in terraform.tfvars
terraform apply
ECR=$(terraform output -raw ecr_repository_url)

# --- Build & push the image to the now-existing ECR repo ---
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin "${ECR%/*}"
docker build -t "$ECR:$(git rev-parse --short HEAD)" .
docker push "$ECR:$(git rev-parse --short HEAD)"

# --- Stage 2: add the ECS task + service pointing at the pushed tag ---
#   deploy_application=true, image_tag=<sha>, acm_certificate_arn=<arn>,
#   public_base_url=https://<preview-host> in terraform.tfvars
terraform apply
terraform output -raw preview_url    # HTTPS
```

A force redeploy of a new image without a Terraform change:
`aws ecs update-service --cluster <ecs_cluster_name> --service <ecs_service_name> --force-new-deployment`.

## Teardown / rollback

`terraform destroy` removes every preview resource. Nothing here touches Vercel,
Supabase data, or production DNS, so destroying the preview has no production
impact. See `docs/aws-migration-phase3.md` for the full rollback matrix.
