output "preview_url" {
  description = <<-EOT
    Public URL to use for the preview.
    - Stage 2 (app deployed, HTTPS): the hostname the ACM certificate covers,
      i.e. public_base_url. The raw ALB hostname is NOT valid for HTTPS (the
      cert does not cover *.elb.amazonaws.com); point that hostname at the ALB
      via a CNAME/alias (alb_dns_name) in a zone you control — not production DNS.
    - Stage 1 (appless HTTP smoke test only): http:// on the raw ALB hostname.
  EOT
  value = (
    local.deploy_app ? var.public_base_url :
    local.http_smoke_only ? "http://${aws_lb.this[0].dns_name}" :
    null
  )
}

output "alb_dns_name" {
  description = "Raw ALB DNS name. Use as the CNAME/alias target for the preview hostname; do not serve the app over HTTPS on this name directly."
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
