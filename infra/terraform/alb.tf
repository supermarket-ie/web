# Application Load Balancer fronting the Fargate service.
#
# HTTPS policy (review finding #2): the application — anything that can touch
# authentication or non-public data — is ONLY ever served over HTTPS. Plain HTTP
# is permitted exclusively for a harmless, appless smoke test (stage 1, before
# the app is deployed) and even then it does not forward to the app: it returns
# a fixed 200 string so no auth/data route is reachable over HTTP.
#
# ACM will not issue a public cert for an *.elb.amazonaws.com name, so HTTPS
# requires a certificate for a preview subdomain you control (acm_certificate_arn).

variable "acm_certificate_arn" {
  description = "ACM cert ARN for HTTPS. REQUIRED before deploying the application (deploy_application = true)."
  type        = string
  default     = ""
}

variable "allow_http_only_smoke_test" {
  description = <<-EOT
    Permit an HTTP-only ALB with NO application behind it, for a harmless
    infrastructure smoke test (returns a fixed 200 string, forwards nothing).
    Only usable in stage 1 (deploy_application = false). It is an error to set
    this together with deploy_application = true.
  EOT
  type        = bool
  default     = false
}

locals {
  https_enabled = local.create && length(var.acm_certificate_arn) > 0
  # HTTP-only is allowed only for the appless stage-1 smoke test.
  http_smoke_only = local.create && !local.deploy_app && var.allow_http_only_smoke_test && !local.https_enabled
}

resource "aws_lb" "this" {
  count              = local.create ? 1 : 0
  name               = "${var.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb[0].id]
  subnets            = aws_subnet.public[*].id
  tags               = { Name = "${var.name_prefix}-alb" }

  lifecycle {
    precondition {
      # Enforce HTTPS whenever the application is deployed.
      condition     = !local.deploy_app || length(var.acm_certificate_arn) > 0
      error_message = "acm_certificate_arn is required when deploy_application = true: the application must be served over HTTPS before any authentication or non-public data access."
    }
    precondition {
      # HTTP-only smoke test and app deployment are mutually exclusive.
      condition     = !(var.allow_http_only_smoke_test && local.deploy_app)
      error_message = "allow_http_only_smoke_test cannot be combined with deploy_application = true. HTTP is only for the appless smoke test."
    }
  }
}

resource "aws_lb_target_group" "app" {
  count       = local.create ? 1 : 0
  name        = "${var.name_prefix}-tg"
  port        = var.container_port
  protocol    = "HTTP" # ALB->task hop inside the VPC; public edge is HTTPS
  vpc_id      = aws_vpc.this[0].id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/terms" # static page, no DB dependency — reliable health signal
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${var.name_prefix}-tg" }
}

# HTTP listener (port 80).
# - When HTTPS is enabled: 301-redirect everything to HTTPS.
# - When HTTP-only smoke test: return a fixed 200 string, forward NOTHING.
# The app target group is never served over plain HTTP.
resource "aws_lb_listener" "http" {
  count             = local.create ? 1 : 0
  load_balancer_arn = aws_lb.this[0].arn
  port              = 80
  protocol          = "HTTP"

  dynamic "default_action" {
    for_each = local.https_enabled ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = local.https_enabled ? [] : [1]
    content {
      type = "fixed-response"
      fixed_response {
        content_type = "text/plain"
        message_body = "preview smoke test ok (HTTP). The application is served over HTTPS only."
        status_code  = "200"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = local.https_enabled ? 1 : 0
  load_balancer_arn = aws_lb.this[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app[0].arn
  }
}
