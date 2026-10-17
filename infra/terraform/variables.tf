variable "aws_region" {
  description = "AWS region for the preview. Ireland per the migration brief."
  type        = string
  default     = "eu-west-1"
}

variable "name_prefix" {
  description = "Prefix for all resource names (e.g. smie-prod for the production deployment)."
  type        = string
  default     = "smie-prod"
}

# --- Networking ------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR for the preview VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "az_count" {
  description = "Number of AZs to spread public/private subnets across."
  type        = number
  default     = 2
}

variable "enable_nat_gateway" {
  description = <<-EOT
    Create a NAT Gateway for private-subnet egress. The PREVIEW does not need it
    (web tier is public-subnet + ALB; no Tesco static egress in preview). Leaving
    this false avoids the ~$32/mo NAT cost. Set true only for the later production
    phase that needs controlled outbound egress.
  EOT
  type        = bool
  default     = false
}

# --- Container / service ---------------------------------------------------

variable "container_port" {
  description = "Port the Next.js server listens on inside the container."
  type        = number
  default     = 3000
}

variable "task_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU, 1024 = 1 vCPU). 1024 pairs with 2048 MiB for the 2-process container."
  type        = number
  default     = 1024
}

variable "task_memory" {
  description = "Fargate task memory (MiB). 2048 (1 vCPU/2GB) gives the 2-process container headroom and fits the ~$55-65/mo target; drop to 1024 to save ~$17/mo."
  type        = number
  default     = 2048
}

variable "desired_count" {
  description = "Number of Fargate tasks. Single-task preview."
  type        = number
  default     = 1
}

variable "image_tag" {
  description = "Container image tag to deploy (e.g. a git SHA). Image is built/pushed by CI."
  type        = string
  default     = "preview"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the service."
  type        = number
  default     = 14
}

# --- Application configuration --------------------------------------------

variable "test_mode" {
  description = <<-EOT
    Pre-cutover TEST mode. When true, the task runs with APP_ENV=preview, which
    forces the in-app guards ON: Supabase is READ-ONLY (no writes from any
    route), outbound email is suppressed, and retailer collection is blocked.
    Use this to verify the AWS deployment against the EXISTING PRODUCTION
    Supabase without altering any customer or trusted-pricing data.

    When false (production mode, APP_ENV=production), the app reads AND writes
    production Supabase normally — set this only once functional verification has
    passed and cutover is approved.
  EOT
  type        = bool
  default     = true
}

variable "app_env_production" {
  description = "APP_ENV value used when test_mode = false (production)."
  type        = string
  default     = "production"
}

variable "enable_retailer_workers_on_aws" {
  description = <<-EOT
    Keep false during the website migration. Retailer collection + cron stay on
    VERCEL (instruction: preserve existing Vercel workers; prevent duplicate
    jobs). When false, the AWS task sets DISABLE_RETAILER_COLLECTION=true and all
    *_WORKER_ENABLED=false so AWS cannot run any retailer/background job even if
    a worker route is hit. Flip true only in the controlled stage-2 worker
    migration, after Vercel workers are disabled.
  EOT
  type        = bool
  default     = false
}

variable "enable_outbound_email_on_aws" {
  description = <<-EOT
    Keep false during stage 1. Scheduled/notification email stays on Vercel. When
    false, the AWS task sets DISABLE_OUTBOUND_EMAIL=true so AWS never sends mail,
    preventing duplicate customer emails across AWS and Vercel.
  EOT
  type        = bool
  default     = false
}

variable "public_base_url" {
  description = <<-EOT
    Public base URL the app advertises (links/cookies/metadata) and that the ACM
    cert must cover. For the pre-cutover test use the test hostname
    (e.g. https://aws-preview.supermarket.ie). For production cutover this
    becomes https://www.supermarket.ie once DNS is switched.
  EOT
  type        = string
  default     = ""
}

variable "secret_arns" {
  description = <<-EOT
    Map of container env var name -> Secrets Manager / SSM Parameter ARN. Values
    are injected at runtime; NO secret values live in Terraform. This deployment
    uses the EXISTING PRODUCTION Supabase, so SUPABASE_SERVICE_ROLE_KEY is the
    real production key — the app's own `test_mode` (APP_ENV=preview) guard makes
    access read-only during pre-cutover testing, so the production key is safe to
    supply from the start. Expected keys: NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, MAGIC_LINK_SECRET,
    VENDOR_MAGIC_LINK_SECRET, CRON_SECRET, REVALIDATE_SECRET, RESEND_API_KEY,
    ANTHROPIC_API_KEY.
  EOT
  type        = map(string)
  default     = {}
}

variable "create_resources" {
  description = <<-EOT
    Master guard. When false (default), Terraform plans no real infrastructure,
    so the code can be reviewed and `terraform plan` run safely without creating
    billable resources. Set true ONLY after explicit approval to provision the
    preview in the Supermarket-Prod account.
  EOT
  type        = bool
  default     = false
}

variable "deploy_application" {
  description = <<-EOT
    Two-stage deploy guard (requires create_resources = true to have any effect).

    Stage 1 (deploy_application = false): provisions ECR, networking, ALB, IAM,
    logs — everything EXCEPT the ECS task definition and service. This lets CI
    push the image to the now-existing ECR repo before any task tries to pull it.

    Stage 2 (deploy_application = true): adds the ECS task definition + service,
    which pull the already-pushed image tag. This removes the race where ECS
    starts before the image exists.

    Default false so a first apply never starts a task against a missing image.
  EOT
  type        = bool
  default     = false
}
