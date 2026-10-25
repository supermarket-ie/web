# ECS service autoscaling (target tracking). Enabled with enable_autoscaling.
# Requires the ECS service to exist (stage 2). Scales on average CPU and on ALB
# requests-per-task, between autoscale_min (>=2 for AZ redundancy) and
# autoscale_max.

locals {
  autoscaling = local.deploy_app && var.enable_autoscaling
}

resource "aws_appautoscaling_target" "ecs" {
  count              = local.autoscaling ? 1 : 0
  max_capacity       = var.autoscale_max
  min_capacity       = var.autoscale_min
  resource_id        = "service/${aws_ecs_cluster.this[0].name}/${aws_ecs_service.app[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# Scale on average CPU.
resource "aws_appautoscaling_policy" "cpu" {
  count              = local.autoscaling ? 1 : 0
  name               = "${var.name_prefix}-cpu-tt"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.autoscale_cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# Scale on ALB request count per task.
resource "aws_appautoscaling_policy" "requests" {
  count              = local.autoscaling ? 1 : 0
  name               = "${var.name_prefix}-req-tt"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      # resource_label ties the metric to this ALB + target group.
      resource_label = "${aws_lb.this[0].arn_suffix}/${aws_lb_target_group.app[0].arn_suffix}"
    }
    target_value       = var.autoscale_requests_per_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
