# Deploy Supermarket.ie to AWS — today

The shortest safe path to the website + Eve agent on AWS, given Docker and the
AWS CLI are not available locally. The image is built and pushed to ECR by
**GitHub Actions** (workflow `aws-ecr-deploy-image.yml`), so you do not need
Docker locally. Account `Supermarket-Prod`, region `eu-west-1`, existing
production Supabase.

Everything in the branch is committed, pushed, and CI-green. No code redesign
needed — this is provisioning + configuration only.

---

## FIRST ACTION (do this now, while Vercel is accessible)

**Export the Vercel production environment and keep it outside Vercel.** This is
the only truly-irrecoverable thing if the account is suspended.

```bash
# From a trusted machine with the Vercel CLI, logged into the project:
vercel env pull .env.vercel.backup --environment=production
```

Then immediately move `.env.vercel.backup` into a password manager (and later
into AWS Secrets Manager — step 3). **Do not commit it** (`.env*` is gitignored;
keep it that way). Confirm it contains values for at least:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `MAGIC_LINK_SECRET`, `VENDOR_MAGIC_LINK_SECRET`,
`CRON_SECRET`, `REVALIDATE_SECRET`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`
(plus `SCRAPINGBEE_API_KEY`, `SCRAPE_ALERT_EMAIL`, Google Analytics vars if set).

Also record, outside Vercel: the current DNS records/targets for
`www.supermarket.ie` and `supermarket.ie` (so rollback is possible), and your
DNS registrar login.

> `MAGIC_LINK_SECRET` must be reused verbatim on AWS or every signed-in user is
> logged out at cutover.

---

## Step 1 — AWS access (IAM Identity Center)

1. In IAM Identity Center for `Supermarket-Prod`, ensure you have a permission
   set with admin/power-user for the first bring-up, assigned to your user.
2. Install the AWS CLI on your machine (needed for the Terraform applies and
   secret creation — NOT for building the image):
   - macOS: `brew install awscli` (or the official pkg installer).
3. Configure SSO and verify:
   ```bash
   aws configure sso            # start URL, region eu-west-1, account Supermarket-Prod
   aws sso login --profile smie-prod
   export AWS_PROFILE=smie-prod AWS_REGION=eu-west-1
   aws sts get-caller-identity  # must show the Supermarket-Prod account id
   ```

## Step 2 — GitHub → ECR via OIDC (no local Docker)

This is how the image gets built and pushed without local Docker (answers
"should we use GitHub Actions to build & publish to ECR" — yes).

1. Create a GitHub OIDC identity provider + an IAM role in `Supermarket-Prod`
   that trusts this repo and allows ECR push. Minimal policy actions:
   `ecr:GetAuthorizationToken` (resource `*`) and, on the app repo ARN,
   `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`,
   `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage`,
   `ecr:BatchGetImage`. Trust policy conditions:
   `token.actions.githubusercontent.com:sub = repo:supermarket-ie/web:*`.
2. In the GitHub repo settings add:
   - Secret `AWS_DEPLOY_ROLE_ARN` = that role's ARN.
   - Secret `PROD_SUPABASE_SERVICE_ROLE_KEY` = the production service-role key
     (used ONLY via a BuildKit secret mount — never inlined into the image).
   - Variables `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY`, `ECR_REPOSITORY`
     (the repo name; `smie-prod` by default — available after step 3's stage 1).
   - (Optional) protect the `aws-prod` Actions **environment** with a required
     reviewer so the push needs your approval.

## Step 3 — Provision + first deploy (test posture)

Follow `docs/aws-migration-production.md`. In brief, from the repo root with the
`smie-prod` AWS profile:

1. Create the S3 state backend (see `docs/aws-migration-launch.md` §2), then
   store the exported secrets in Secrets Manager (`docs/aws-migration-production.md`
   Step 1) and request the ACM cert for `www` + apex + `aws-preview` (Step 2).
2. `terraform.tfvars`: `create_resources=true`, `deploy_application=false`,
   `test_mode=true`, `name_prefix="smie-prod"`, `acm_certificate_arn`,
   `public_base_url="https://aws-preview.supermarket.ie"`, `secret_arns={…}`.
3. Stage 1 — create ECR/network/ALB/IAM:
   ```bash
   cd infra/terraform
   terraform init -backend-config=backend.hcl
   terraform apply
   terraform output -raw ecr_repository_url   # note the repo for the GH variable ECR_REPOSITORY
   ```
4. Build & push the image **in GitHub Actions** (no local Docker):
   - Actions → "Build & push deploy image to ECR" → Run workflow →
     `image_mode = test`. It assumes the OIDC role, builds `BUILD_MODE=deploy`
     with the test hostname, and pushes `:<sha>` to ECR. The run prints the tag.
5. Stage 2 — point the ECS service at that tag:
   ```bash
   # tfvars: deploy_application=true, image_tag="<sha from the workflow>"  (test_mode stays true)
   terraform apply -var "image_tag=<sha>"
   terraform output -raw app_url        # https://aws-preview.supermarket.ie
   terraform output -raw alb_dns_name   # CNAME/alias target
   ```
6. Add ONE DNS record `aws-preview -> <alb_dns_name>` (ADD-only). Verify per
   `docs/aws-migration-production.md` Step 4 (read-only, against production DB).

## Step 4 — Flip to production posture, then cutover (approval-gated)

1. Re-run the GitHub workflow with `image_mode = prod` (inlines
   `www.supermarket.ie`); it pushes `:<sha>-prod`.
2. `terraform apply -var image_tag=<sha>-prod` with `test_mode=false`,
   `public_base_url=https://www.supermarket.ie`. Re-verify on the test host.
3. **Only after your approval:** cut `www` + apex DNS to the ALB
   (`docs/aws-migration-production.md` Step 6). Rollback = revert DNS to Vercel.

---

## Real remaining blockers (what actually stops a deploy)

These are environmental/access items, not code — the application, image,
Terraform, and workflows are built and green:

1. **AWS access** to `Supermarket-Prod` (IAM Identity Center permission set) —
   needed for the Terraform applies and secret creation. *You.*
2. **Production secrets exported** from Vercel + loaded into Secrets Manager /
   GitHub secrets (the FIRST ACTION above). *You.*
3. **GitHub OIDC role + repo secrets/variables** (Step 2) so Actions can push to
   ECR without local Docker. *You* (one-time).
4. **ACM certificate** for `www`/apex/`aws-preview` + the validation CNAMEs
   added to DNS. *You* (DNS add-only).
5. **Approval to create billable resources** (ECS/ALB/etc.) and, separately, to
   cut DNS. *You.*

Not blockers (already done): Docker image builds (CI-green, pushable via the new
ECR workflow), Terraform validated, SQS/EventBridge worker replacements prepared
(kept OFF), app build + 592 tests + behavioural gate green.

## What I cannot do from here

I have no AWS credentials, no Docker locally, and must not provision billable
resources, change DNS, or access production secrets without your approval. So
steps 1–5 above require you. Once the OIDC role + GitHub secrets exist, the image
build/push is a one-click GitHub Actions run; the only CLI work left is the two
`terraform apply`s.
