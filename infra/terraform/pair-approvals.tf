# Continuous machine pair approvals (policy barcode-exact-v1, migration 20261122090000).
# Daily one-off task on the scheduled task definition: governed evidence captures for associated offers that lack
# a fresh one (CAPTURE=1), then the machine approval policy over every active barcode association (APPLY=1).
# Approvals are written only through record_machine_pair_approval; nothing changes prices or mappings.

variable "machine_pair_approvals_state" {
  description = "ENABLED or DISABLED for the daily machine pair-approval run."
  type        = string
  default     = "ENABLED"
  validation {
    condition     = contains(["ENABLED", "DISABLED"], var.machine_pair_approvals_state)
    error_message = "machine_pair_approvals_state must be ENABLED or DISABLED."
  }
}

resource "aws_scheduler_schedule" "machine_pair_approvals" {
  count = local.workers ? 1 : 0
  name  = "${var.name_prefix}-machine-pair-approvals-daily"
  state = var.machine_pair_approvals_state

  flexible_time_window {
    mode = "OFF"
  }

  # 06:30 UTC: after the 03:40 Tesco renewal and the 05:10/05:20 Dunnes/SuperValu refreshes, so the newest
  # Tesco pages and SuperValu observations are already recorded.
  schedule_expression          = "cron(30 6 * * ? *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_ecs_cluster.this[0].arn
    role_arn = aws_iam_role.scheduler[0].arn

    retry_policy {
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 3600
    }

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.scheduled[0].arn
      launch_type         = "FARGATE"
      network_configuration {
        subnets          = aws_subnet.public[*].id
        security_groups  = [aws_security_group.service[0].id]
        assign_public_ip = true
      }
    }

    input = jsonencode({
      containerOverrides = [
        {
          name    = "scheduled"
          command = ["node", "--conditions=react-server", "--import", "tsx", "scripts/machine-pair-approvals.ts"]
          environment = [
            { name = "APPLY", value = "1" },
            { name = "CAPTURE", value = "1" },
            { name = "CAPTURE_LIMIT", value = "300" },
          ]
        }
      ]
    })
  }
}
