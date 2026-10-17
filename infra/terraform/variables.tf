variable "aws_region" {
  description = "AWS region for the preview. Ireland per the migration brief."
  type        = string
  default     = "eu-west-1"
}

variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
  default     = "smie-preview"
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
  description = "Fargate task CPU units (256 = 0.25 vCPU)."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory (MiB). 1024 is the preview baseline; bump to 2048 if the 2-process container OOMs."
  type        = number
  default     = 1024
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

variable "app_env" {
  description = "APP_ENV value. MUST be 'preview' for the isolated preview so safety guards engage."
  type        = string
  default     = "preview"
}

variable "public_base_url" {
  description = <<-EOT
    Public base URL for the preview. Leave empty to use the ALB DNS name output
    (set NEXT_PUBLIC_SITE_URL/BASE_URL to the ALB hostname after first apply).
    No production DNS is used.
  EOT
  type        = string
  default     = ""
}

variable "secret_arns" {
  description = <<-EOT
    Map of container env var name -> Secrets Manager / SSM Parameter ARN. Values
    are injected at runtime; NO secret values live in Terraform. The preview MUST
    use a RESTRICTED/READ-ONLY Supabase key here, never the production
    service-role key. Example keys: NEXT_PUBLIC_SUPABASE_URL,
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
