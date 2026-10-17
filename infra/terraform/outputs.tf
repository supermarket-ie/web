output "preview_url" {
  description = "Public URL for the preview (ALB DNS). No production DNS is used."
  value       = local.create ? (local.https_enabled ? "https://${aws_lb.this[0].dns_name}" : "http://${aws_lb.this[0].dns_name}") : null
}

output "alb_dns_name" {
  description = "Raw ALB DNS name."
  value       = local.create ? aws_lb.this[0].dns_name : null
}

output "ecr_repository_url" {
  description = "ECR repository to push the image to (used by CI)."
  value       = local.create ? aws_ecr_repository.app[0].repository_url : null
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = local.create ? aws_ecs_cluster.this[0].name : null
}

output "ecs_service_name" {
  description = "ECS service name (for forced redeploys)."
  value       = local.create ? aws_ecs_service.app[0].name : null
}

output "log_group" {
  description = "CloudWatch log group for service logs."
  value       = local.create ? aws_cloudwatch_log_group.app[0].name : null
}
