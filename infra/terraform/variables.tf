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

# --- High availability / autoscaling ---------------------------------------

variable "enable_autoscaling" {
  description = "Register the ECS service for target-tracking autoscaling (CPU + ALB request count)."
  type        = bool
  default     = false
}

variable "autoscale_min" {
  description = "Minimum task count when autoscaling is enabled (>=2 for AZ redundancy)."
  type        = number
  default     = 2
}

variable "autoscale_max" {
  description = "Maximum task count under load."
  type        = number
  default     = 6
}

variable "autoscale_cpu_target" {
  description = "Target average CPU % for scaling."
  type        = number
  default     = 60
}

variable "autoscale_requests_per_target" {
  description = "Target ALB requests per task before scaling out."
  type        = number
  default     = 800
}

variable "deployment_min_healthy_percent" {
  description = "ECS rolling-deploy minimum healthy percent. 50 (with >=2 tasks) keeps a task serving during deploys."
  type        = number
  default     = 50
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
    Controls DISABLE_OUTBOUND_EMAIL on the AWS task. This is a GLOBAL email
    switch in the app (src/lib/resend.ts): when DISABLE_OUTBOUND_EMAIL=true it
    short-circuits ALL Resend sends, including TRANSACTIONAL auth email
    (magic-link sign-in, registration verification), not just scheduled
    notifications.

    Keep false ONLY while AWS is a non-customer-facing preview. At production
    cutover (when www points at AWS) set this TRUE, otherwise sign-in and
    registration emails are silently suppressed and customers cannot
    authenticate. There is no duplicate-email risk for transactional mail: it is
    triggered by the user hitting whichever host serves them, and once www is on
    AWS, Vercel no longer serves those users. Duplicate SCHEDULED/notification
    email is prevented separately — AWS has no cron runner and the queue
    consumers/`*_WORKER_ENABLED` stay off, so scheduled sends are never triggered
    on AWS regardless of this flag.
  EOT
  type        = bool
  default     = false
}

variable "enable_workers" {
  description = <<-EOT
    Provision the AWS background-worker stack: SQS queues (+DLQs), the SQS
    consumer ECS service, and EventBridge Scheduler cron jobs (as scheduled ECS
    tasks). DEFAULT FALSE — the website can run on AWS with zero workers while
    Vercel still runs them, avoiding duplicate retailer collection / emails.

    Provisioning the queues/service/schedules is safe on its own, but the
    SCHEDULES ARE CREATED DISABLED (schedule_state=DISABLED) and the consumer
    service desired_count is `worker_desired_count` (default 0), so nothing
    actually runs until explicitly enabled AND Vercel workers are disabled in the
    same controlled change.
  EOT
  type        = bool
  default     = false
}

variable "worker_desired_count" {
  description = "Desired count for the SQS consumer service. 0 keeps it provisioned-but-idle until cutover of the background stage."
  type        = number
  default     = 0
}

variable "worker_schedule_state" {
  description = "Default EventBridge Scheduler state for cron jobs NOT listed in enabled_schedules: DISABLED (default, safe) or ENABLED."
  type        = string
  default     = "DISABLED"
  validation {
    condition     = contains(["ENABLED", "DISABLED"], var.worker_schedule_state)
    error_message = "worker_schedule_state must be ENABLED or DISABLED."
  }
}

variable "enabled_schedules" {
  description = <<-EOT
    Per-job allowlist of EventBridge schedules to ENABLE (by job key, matching
    workers.tf cron_jobs). Any job NOT listed uses worker_schedule_state
    (default DISABLED). Lets us stage the cron cutover: enable the low-risk jobs
    first and keep the retailer-scrape triggers (dunnes-scrape-trigger,
    supervalu-scrape-trigger, pepesto-tesco-retrieve) disabled until each
    retailer is canaried. Enable a schedule only AFTER the matching Vercel cron
    is disabled, to avoid duplicate execution.
  EOT
  type        = list(string)
  default     = []
}

variable "enabled_retailers" {
  description = <<-EOT
    Per-retailer allowlist controlling the *_WORKER_ENABLED flags, so retailer
    collection can be canaried one retailer at a time (Dunnes/SuperValu first,
    Tesco separately). Valid entries: "tesco", "dunnes", "supervalu". A retailer's
    worker runs only if it is in this list AND enable_retailer_workers_on_aws is
    true AND not test_mode. Empty = no retailer workers (collection still gated by
    enable_retailer_workers_on_aws for DISABLE_RETAILER_COLLECTION).
  EOT
  type        = list(string)
  default     = []
}

variable "image_tag_worker" {
  description = "Image tag for the worker/scheduler tasks (usually same as image_tag)."
  type        = string
  default     = ""
}

variable "website_queue_backend" {
  description = <<-EOT
    The queue backend the PRODUCTION WEBSITE (producer) routes customer-triggered
    jobs to: "vercel" (default) or "sqs". DELIBERATELY decoupled from
    enable_workers so provisioning the SQS queues/consumer does NOT by itself
    redirect live producer traffic. Flip to "sqs" ONLY once the SQS consumer is
    running (worker_desired_count>=1) and healthy, so no message is enqueued to a
    queue nothing is draining. Must be "vercel" while Vercel still delivers queue
    messages, to avoid split producer routing.
  EOT
  type        = string
  default     = "vercel"
  validation {
    condition     = contains(["vercel", "sqs"], var.website_queue_backend)
    error_message = "website_queue_backend must be \"vercel\" or \"sqs\"."
  }
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
