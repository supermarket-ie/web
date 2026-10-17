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
- Belt-and-braces env: `DISABLE_RETAILER_COLLECTION=true`,
  `DISABLE_OUTBOUND_EMAIL=true`, all `*_WORKER_ENABLED=false`.
- No EventBridge/cron schedules are created, so no scheduled job can run.
- No NAT / static egress, so no Tesco egress identity exists.
- `SUPABASE_SERVICE_ROLE_KEY` must map to a RESTRICTED/READ-ONLY key via
  `secret_arns` — never the production service-role key.
- No secret values live in Terraform; only ARNs pointing at Secrets Manager/SSM.

## Usage

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in ARNs; keep create_resources=false

terraform init -backend=false   # review/validate without remote state
terraform fmt -check -recursive
terraform validate

# Plan with the guard off → zero resources (safe to run anywhere):
terraform plan

# ---- Only after explicit approval, in Supermarket-Prod creds ----
# 1) Create secrets in Secrets Manager/SSM (read-only Supabase key included).
# 2) Set create_resources = true and fill secret_arns in terraform.tfvars.
# 3) terraform apply
```

## Deploy flow (with CI building the image)

1. CI builds the Docker image and pushes it to the ECR repo
   (`ecr_repository_url` output) tagged with the git SHA.
2. `terraform apply` with `image_tag = <sha>` rolls the service.
3. Smoke test the `preview_url` output.

A force redeploy without Terraform:
`aws ecs update-service --cluster <ecs_cluster_name> --service <ecs_service_name> --force-new-deployment`.

## Teardown / rollback

`terraform destroy` removes every preview resource. Nothing here touches Vercel,
Supabase data, or production DNS, so destroying the preview has no production
impact. See `docs/aws-migration-phase3.md` for the full rollback matrix.
