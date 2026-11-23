# Tesco Apify collector: daily RENEWAL schedule + 7-day coverage tracking.
#
# The collector task definition family (smie-prod-tesco-apify-collect) is
# registered outside Terraform (one revision per image). This file schedules a
# PINNED revision of it, so a schedule never silently picks up a new image.
#
# Retries before expiry: a price leaves latest_prices after 7 days and is due
# for renewal after 4. Renewal runs daily, so a held/failed renewal is retried
# on days 5, 6 and 7 (the 24h request exclusion prevents same-day repeats).
# Spend stays inside the durable $10 campaign cap enforced in the database.

variable "tesco_apify_task_definition" {
  description = "Pinned family:revision of the Tesco Apify collector to schedule, e.g. smie-prod-tesco-apify-collect:13. Empty = no schedule."
  type        = string
  # Version-controlled production pin (bump together with a new image).
  default = "smie-prod-tesco-apify-collect:20"
}

variable "tesco_renewal_schedule_state" {
  description = "ENABLED or DISABLED for the daily Tesco renewal schedule."
  type        = string
  default     = "ENABLED"
  validation {
    condition     = contains(["ENABLED", "DISABLED"], var.tesco_renewal_schedule_state)
    error_message = "tesco_renewal_schedule_state must be ENABLED or DISABLED."
  }
}

data "aws_caller_identity" "current" {}

locals {
  tesco_apify_on     = local.workers && var.tesco_apify_task_definition != ""
  tesco_apify_family = split(":", var.tesco_apify_task_definition)[0]
}

data "aws_ecs_task_definition" "tesco_apify" {
  count           = local.tesco_apify_on ? 1 : 0
  task_definition = var.tesco_apify_task_definition
}

data "aws_iam_policy_document" "scheduler_tesco_apify" {
  count = local.tesco_apify_on ? 1 : 0
  statement {
    actions   = ["ecs:RunTask"]
    resources = ["arn:aws:ecs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:task-definition/${local.tesco_apify_family}:*"]
  }
  statement {
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution[0].arn, aws_iam_role.task[0].arn]
  }
}

resource "aws_iam_role_policy" "scheduler_tesco_apify" {
  count  = local.tesco_apify_on ? 1 : 0
  name   = "${var.name_prefix}-scheduler-tesco-apify"
  role   = aws_iam_role.scheduler[0].id
  policy = data.aws_iam_policy_document.scheduler_tesco_apify[0].json
}

resource "aws_scheduler_schedule" "tesco_renewal" {
  count = local.tesco_apify_on ? 1 : 0
  name  = "${var.name_prefix}-tesco-renewal-daily"
  state = var.tesco_renewal_schedule_state

  flexible_time_window {
    mode = "OFF"
  }

  # 03:40 UTC: before the 05:10/05:20 Dunnes/SuperValu triggers, so fresh peer
  # data is at most a day old when renewal identity checks run.
  schedule_expression          = "cron(40 3 * * ? *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_ecs_cluster.this[0].arn
    role_arn = aws_iam_role.scheduler[0].arn

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }

    ecs_parameters {
      task_definition_arn = data.aws_ecs_task_definition.tesco_apify[0].arn
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
          name = "tesco-apify-collect"
          environment = [
            { name = "APIFY_MODE", value = "renewal" },
            { name = "APIFY_MAX_BATCHES", value = "20" },
          ]
        }
      ]
    })
  }
}

# --- 7-day coverage tracking (from the collector's coverage_snapshot events) --
resource "aws_cloudwatch_log_metric_filter" "tesco_fresh_total" {
  count          = local.tesco_apify_on ? 1 : 0
  name           = "${var.name_prefix}-tesco-fresh-total"
  log_group_name = aws_cloudwatch_log_group.app[0].name
  pattern        = "{ $.event = \"coverage_snapshot\" && $.freshTotal = * }"
  metric_transformation {
    name      = "TescoFreshTotal"
    namespace = "Supermarket/Tesco"
    value     = "$.freshTotal"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "tesco_expiring_24h" {
  count          = local.tesco_apify_on ? 1 : 0
  name           = "${var.name_prefix}-tesco-expiring-24h"
  log_group_name = aws_cloudwatch_log_group.app[0].name
  pattern        = "{ $.event = \"coverage_snapshot\" && $.expiring24h = * }"
  metric_transformation {
    name      = "TescoExpiring24h"
    namespace = "Supermarket/Tesco"
    value     = "$.expiring24h"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "tesco_renewals_accepted" {
  count          = local.tesco_apify_on ? 1 : 0
  name           = "${var.name_prefix}-tesco-renewals-accepted"
  log_group_name = aws_cloudwatch_log_group.app[0].name
  pattern        = "{ $.event = \"campaign_summary\" && $.mode = \"renewal\" }"
  metric_transformation {
    name      = "TescoRenewalsAccepted"
    namespace = "Supermarket/Tesco"
    value     = "$.accepted"
    unit      = "Count"
  }
}

# Alarm if the daily renewal did not run (no coverage snapshot in ~26h).
resource "aws_cloudwatch_metric_alarm" "tesco_renewal_missed" {
  count               = local.tesco_apify_on && var.tesco_renewal_schedule_state == "ENABLED" ? 1 : 0
  alarm_name          = "${var.name_prefix}-tesco-renewal-missed"
  namespace           = "Supermarket/Tesco"
  metric_name         = "TescoFreshTotal"
  statistic           = "SampleCount"
  period              = 93600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_description   = "No Tesco coverage snapshot for 26h: the daily renewal schedule did not run."
}
