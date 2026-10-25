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

## Step 1 — AWS access (IAM Identity Center) — DONE

- AWS CLI v2 installed; SSO profile `smie-prod` configured against start URL
  `https://d-936780964e.awsapps.com/start/`, SSO region `eu-west-1`.
- Authenticated to account **611622961299 (Supermarket-Prod)**,
  `AdministratorAccess`. Re-auth each session with
  `aws sso login --sso-session smie` then `export AWS_PROFILE=smie-prod`.

## Step 2 — GitHub → ECR via OIDC (no local Docker) — DONE (hardened)

Image build/push runs in GitHub Actions, not on a local Docker.

Provisioned and locked down:
- GitHub OIDC provider in `Supermarket-Prod`.
- IAM role `smie-prod-gha-ecr-push` with ECR-push permissions scoped to the
  `smie-prod` repo. **Trust is restricted to a protected environment**, not the
  whole repo: `token.actions.githubusercontent.com:sub =
  repo:supermarket-ie/web:environment:aws-prod` (no wildcard).
- Protected GitHub environment `aws-prod`: required reviewer + deployments
  allowed only from branch `infra/aws-migration`. The deploy workflow declares
  `environment: aws-prod`, so credentials are only issuable from an approved run
  on the approved branch.
- GitHub secret `AWS_DEPLOY_ROLE_ARN` and variables `ECR_REPOSITORY=smie-prod`,
  `PROD_SUPABASE_URL=https://ytyzwiqnobxehdqrnzhx.supabase.co` set.

**Making the workflow dispatchable without merging PR #265:** GitHub only shows
a `workflow_dispatch` workflow if it exists on the default branch. PR #266 adds
ONLY `aws-ecr-deploy-image.yml` to `main` (no app/infra change). Merge #266,
then run the workflow choosing ref `infra/aws-migration` to build the migration
code. PR #265 (the migration) stays unmerged.

### You still need to add (GitHub repo settings)
- Variable `PROD_SUPABASE_ANON_KEY` (non-secret anon key).
- Secret `PROD_SUPABASE_SERVICE_ROLE_KEY` (service-role key; used ONLY via the
  BuildKit secret mount — never inlined, never logged).

### Original (pre-hardening) notes retained for reference:
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
