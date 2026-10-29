# AWS background-worker stack: the SQS consumer service (replaces Vercel Queue
# delivery) and EventBridge Scheduler cron jobs (replace Vercel Cron). All gated
# by enable_workers; schedules are created DISABLED and the service can start at
# desired_count 0, so nothing runs until the controlled background cutover.

# --- IAM: worker task role can use its SQS queues + Supabase (via secrets) ----

data "aws_iam_policy_document" "worker_sqs" {
  count = local.workers ? 1 : 0
  statement {
    sid = "WorkerSqs"
    actions = [
      "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes", "sqs:SendMessage",
    ]
    resources = concat(local.queue_arns, local.dlq_arns)
  }
}

resource "aws_iam_role" "worker_task" {
  count              = local.workers ? 1 : 0
  name               = "${var.name_prefix}-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume[0].json
  tags               = { Name = "${var.name_prefix}-worker-task" }
}

resource "aws_iam_role_policy" "worker_sqs" {
  count  = local.workers ? 1 : 0
  name   = "${var.name_prefix}-worker-sqs"
  role   = aws_iam_role.worker_task[0].id
  policy = data.aws_iam_policy_document.worker_sqs[0].json
}

# --- Shared worker environment (SQS mode + guards) ----------------------------

locals {
  worker_environment = local.workers ? concat([
    { name = "NODE_ENV", value = "production" },
    { name = "APP_ENV", value = local.effective_app_env },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "QUEUE_BACKEND", value = "sqs" },
    { name = "NEXT_PUBLIC_SITE_URL", value = var.public_base_url },
    { name = "NEXT_PUBLIC_BASE_URL", value = var.public_base_url },
    # Workers DO the collection/email, so enable per the stage flags. In
    # test_mode these are still forced safe (read-only, blocked) by the app.
    { name = "DISABLE_RETAILER_COLLECTION", value = local.retailer_blocked ? "true" : "false" },
    { name = "DISABLE_OUTBOUND_EMAIL", value = local.email_blocked ? "true" : "false" },
    { name = "SUPABASE_READ_ONLY", value = local.supabase_read_only ? "true" : "false" },
    { name = "TESCO_VERCEL_WORKER_ENABLED", value = local.retailer_on["tesco"] },
    { name = "DUNNES_VERCEL_WORKER_ENABLED", value = local.retailer_on["dunnes"] },
    { name = "SUPERVALU_VERCEL_WORKER_ENABLED", value = local.retailer_on["supervalu"] },
    { name = "NON_TESCO_VERCEL_WORKERS_ENABLED", value = local.non_tesco_on },
    # Retailer-refresh health alerting (scrape-watchdog). The recipient is a
    # non-secret address; delivery uses the existing RESEND_API_KEY secret. When
    # unset, scrape-watchdog reports channelConfigured=false instead of silently
    # not sending. SCHEDULED_RETAILERS tracks the enabled retailer-scrape
    # schedules so a deliberately-disabled retailer is not alerted as "missed".
    { name = "SCRAPE_ALERT_EMAIL", value = var.scrape_alert_email },
    { name = "SCHEDULED_RETAILERS", value = join(",", var.scheduled_retailers) },
  ], local.queue_url_environment) : []
}

# --- SQS consumer service (long-running poller) -------------------------------

resource "aws_ecs_task_definition" "sqs_consumer" {
  count                    = local.workers ? 1 : 0
  family                   = "${var.name_prefix}-sqs-consumer"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution[0].arn
  task_role_arn            = aws_iam_role.worker_task[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "sqs-consumer"
      image     = "${aws_ecr_repository.app[0].repository_url}:${local.worker_image_tag}"
      essential = true
      # Reuse the SAME image; just run the worker entrypoint instead of the web
      # entrypoint. tsx runs the TS worker directly. --conditions=react-server
      # resolves the `server-only` marker (pulled in via the route modules'
      # dependency graph) to its no-op, exactly as Next does server-side; without
      # it the standalone worker throws at import time.
      command     = ["node", "--conditions=react-server", "--import", "tsx", "src/workers/sqs-consumer.ts"]
      environment = local.worker_environment
      secrets     = local.container_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app[0].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "sqs-consumer"
        }
      }
    }
  ])

  tags = { Name = "${var.name_prefix}-sqs-consumer" }
}

resource "aws_ecs_service" "sqs_consumer" {
  count           = local.workers ? 1 : 0
  name            = "${var.name_prefix}-sqs-consumer"
  cluster         = aws_ecs_cluster.this[0].id
  task_definition = aws_ecs_task_definition.sqs_consumer[0].arn
  desired_count   = var.worker_desired_count # default 0 = provisioned-but-idle
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.service[0].id]
    assign_public_ip = true
  }

  tags = { Name = "${var.name_prefix}-sqs-consumer" }
}

# --- EventBridge Scheduler cron jobs (scheduled one-off ECS tasks) ------------

locals {
  # job key -> cron expression (UTC), mirroring vercel.json crons.
  cron_jobs = {
    "weekly-digest"            = "cron(0 8 ? * SUN *)"
    "check-alerts"             = "cron(30 7 * * ? *)"
    "agent-tasks"              = "cron(35 7 * * ? *)"
    "price-watchdog"           = "cron(30 7 * * ? *)"
    "price-watchdog-thursday"  = "cron(0 9 ? * THU *)"
    "dunnes-scrape-trigger"    = "cron(10 5 ? * MON,THU *)"
    "supervalu-scrape-trigger" = "cron(20 5 ? * MON,THU *)"
    "pepesto-tesco-retrieve"   = "cron(0/10 * * * ? *)"
    "scrape-watchdog"          = "cron(45 7 ? * MON,THU *)"
    "product-embeddings"       = "cron(0 4 ? * SUN *)"
  }
  cron_set = local.workers ? local.cron_jobs : {}
}

# Scheduler needs permission to RunTask and pass the task roles.
data "aws_iam_policy_document" "scheduler_assume" {
  count = local.workers ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  count              = local.workers ? 1 : 0
  name               = "${var.name_prefix}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume[0].json
  tags               = { Name = "${var.name_prefix}-scheduler" }
}

data "aws_iam_policy_document" "scheduler_runtask" {
  count = local.workers ? 1 : 0
  statement {
    actions   = ["ecs:RunTask"]
    resources = ["${aws_ecs_task_definition.scheduled[0].arn_without_revision}:*", aws_ecs_task_definition.scheduled[0].arn]
  }
  statement {
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution[0].arn, aws_iam_role.worker_task[0].arn]
  }
}

resource "aws_iam_role_policy" "scheduler_runtask" {
  count  = local.workers ? 1 : 0
  name   = "${var.name_prefix}-scheduler-runtask"
  role   = aws_iam_role.scheduler[0].id
  policy = data.aws_iam_policy_document.scheduler_runtask[0].json
}

# One scheduled task definition; each schedule overrides CRON_JOB via the
# container env in the RunTask input.
resource "aws_ecs_task_definition" "scheduled" {
  count                    = local.workers ? 1 : 0
  family                   = "${var.name_prefix}-scheduled"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution[0].arn
  task_role_arn            = aws_iam_role.worker_task[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name        = "scheduled"
      image       = "${aws_ecr_repository.app[0].repository_url}:${local.worker_image_tag}"
      essential   = true
      command     = ["node", "--conditions=react-server", "--import", "tsx", "src/workers/scheduled-runner.ts"]
      environment = local.worker_environment
      secrets     = local.container_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app[0].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "scheduled"
        }
      }
    }
  ])

  tags = { Name = "${var.name_prefix}-scheduled" }
}

resource "aws_scheduler_schedule" "cron" {
  for_each = local.cron_set
  name     = "${var.name_prefix}-${each.key}"
  # Per-job state: ENABLED only if this job key is in enabled_schedules;
  # otherwise fall back to worker_schedule_state (default DISABLED). Enable a job
  # only after its Vercel counterpart is off, to avoid duplicate execution.
  state = contains(var.enabled_schedules, each.key) ? "ENABLED" : var.worker_schedule_state

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = each.value
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_ecs_cluster.this[0].arn
    role_arn = aws_iam_role.scheduler[0].arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.scheduled[0].arn
      launch_type         = "FARGATE"
      network_configuration {
        subnets          = aws_subnet.public[*].id
        security_groups  = [aws_security_group.service[0].id]
        assign_public_ip = true
      }
    }

    # Override CRON_JOB for this schedule so one task definition serves all jobs.
    input = jsonencode({
      containerOverrides = [
        {
          name        = "scheduled"
          environment = [{ name = "CRON_JOB", value = each.key }]
        }
      ]
    })
  }
}
