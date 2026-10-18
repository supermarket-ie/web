# ECS Fargate cluster, log group, task definition and service for the preview.
# Single task. Runs the two-process container (Eve + Next) via the image's
# entrypoint. Safety-critical: APP_ENV=preview engages the in-app preview guard
# (no retailer collection, no outbound email), and NO scheduled jobs are created.

resource "aws_cloudwatch_log_group" "app" {
  count             = local.create ? 1 : 0
  name              = "/ecs/${var.name_prefix}"
  retention_in_days = var.log_retention_days
  tags              = { Name = "${var.name_prefix}-logs" }
}

resource "aws_ecs_cluster" "this" {
  count = local.create ? 1 : 0
  name  = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled" # keep preview cost down
  }

  tags = { Name = "${var.name_prefix}-cluster" }
}

locals {
  # test_mode => APP_ENV=preview, which forces the in-app guards ON (read-only
  # Supabase, no email, no retailer collection) for safe pre-cutover testing
  # against the EXISTING PRODUCTION database. Otherwise APP_ENV=production and
  # the app reads+writes normally.
  effective_app_env = var.test_mode ? "preview" : var.app_env_production

  # Retailer collection + outbound email stay on VERCEL during the website
  # migration. They are blocked on AWS unless explicitly enabled (stage 2),
  # and always blocked in test_mode. This prevents duplicate jobs/emails.
  retailer_blocked = var.test_mode || !var.enable_retailer_workers_on_aws
  email_blocked    = var.test_mode || !var.enable_outbound_email_on_aws

  # In test_mode the Supabase client is read-only. In production mode writes are
  # allowed (customer-facing functionality needs them).
  supabase_read_only = var.test_mode

  # Non-secret environment for the task. In production mode (test_mode=false,
  # workers enabled in stage 2) these guards become no-ops in-app as well.
  container_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "APP_ENV", value = local.effective_app_env },
    { name = "PORT", value = tostring(var.container_port) },
    { name = "EVE_NEXT_PRODUCTION_PORT", value = "4274" },
    { name = "NEXT_TELEMETRY_DISABLED", value = "1" },
    { name = "NEXT_PUBLIC_SITE_URL", value = var.public_base_url },
    { name = "NEXT_PUBLIC_BASE_URL", value = var.public_base_url },
    # Queue backend: 'sqs' once the AWS worker stack exists, else 'vercel'.
    { name = "QUEUE_BACKEND", value = local.workers ? "sqs" : "vercel" },
    { name = "DISABLE_RETAILER_COLLECTION", value = local.retailer_blocked ? "true" : "false" },
    { name = "DISABLE_OUTBOUND_EMAIL", value = local.email_blocked ? "true" : "false" },
    { name = "SUPABASE_READ_ONLY", value = local.supabase_read_only ? "true" : "false" },
    # Retailer worker flags: OFF on AWS unless stage-2 worker migration enables them.
    { name = "TESCO_VERCEL_WORKER_ENABLED", value = (var.enable_retailer_workers_on_aws && !var.test_mode) ? "true" : "false" },
    { name = "DUNNES_VERCEL_WORKER_ENABLED", value = (var.enable_retailer_workers_on_aws && !var.test_mode) ? "true" : "false" },
    { name = "SUPERVALU_VERCEL_WORKER_ENABLED", value = (var.enable_retailer_workers_on_aws && !var.test_mode) ? "true" : "false" },
    { name = "NON_TESCO_VERCEL_WORKERS_ENABLED", value = (var.enable_retailer_workers_on_aws && !var.test_mode) ? "true" : "false" },
  ]

  # SQS queue URL env vars (SQS_URL_*), present only when the worker stack exists.
  queue_url_environment = local.workers ? [for name, url in local.queue_urls : { name = name, value = url }] : []

  # Full website env = base + queue URLs.
  web_environment = concat(local.container_environment, local.queue_url_environment)

  # Secrets injected from Secrets Manager / SSM at runtime (names -> ARNs).
  container_secrets = [for name, arn in var.secret_arns : { name = name, valueFrom = arn }]

  worker_image_tag = var.image_tag_worker != "" ? var.image_tag_worker : var.image_tag
}

resource "aws_ecs_task_definition" "app" {
  count                    = local.deploy_app ? 1 : 0
  family                   = var.name_prefix
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.execution[0].arn
  task_role_arn            = aws_iam_role.task[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  lifecycle {
    precondition {
      # The app must know its own HTTPS URL for links/cookies/metadata. Require
      # an explicit https:// public_base_url (the subdomain the ACM cert covers).
      condition     = can(regex("^https://", var.public_base_url))
      error_message = "public_base_url must be set to the https:// preview URL (matching the ACM cert) before deploying the application."
    }
  }

  container_definitions = jsonencode([
    {
      name         = "web"
      image        = "${aws_ecr_repository.app[0].repository_url}:${var.image_tag}"
      essential    = true
      portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]
      environment  = local.web_environment
      secrets      = local.container_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app[0].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "web"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${var.container_port}/terms').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 40
      }
    }
  ])

  tags = { Name = "${var.name_prefix}-task" }
}

resource "aws_ecs_service" "app" {
  count           = local.deploy_app ? 1 : 0
  name            = "${var.name_prefix}-svc"
  cluster         = aws_ecs_cluster.this[0].id
  task_definition = aws_ecs_task_definition.app[0].arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.service[0].id]
    assign_public_ip = true # public subnets, pull from ECR + reach Supabase/Anthropic
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app[0].arn
    container_name   = "web"
    container_port   = var.container_port
  }

  deployment_minimum_healthy_percent = 0 # single-task preview: allow replace
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http]

  tags = { Name = "${var.name_prefix}-svc" }
}
