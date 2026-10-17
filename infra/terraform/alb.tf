# Application Load Balancer fronting the Fargate service.
#
# The preview uses the AWS-generated ALB DNS name (no production DNS). HTTPS on
# the raw ALB hostname needs a certificate; ACM will not issue a public cert for
# an *.elb.amazonaws.com name, so for a first bring-up either:
#   (a) provide a cert ARN for a preview subdomain you control (acm_certificate_arn), or
#   (b) start HTTP-only on the ALB hostname for smoke testing, then add the cert.
# When no cert ARN is given, only the HTTP listener is created (noindex is
# enforced in-app, so this is acceptable for a short-lived preview smoke test).

variable "acm_certificate_arn" {
  description = "Optional ACM cert ARN for HTTPS. If empty, only an HTTP listener is created (preview smoke test)."
  type        = string
  default     = ""
}

locals {
  https_enabled = var.create_resources && length(var.acm_certificate_arn) > 0
}

resource "aws_lb" "this" {
  count              = local.create ? 1 : 0
  name               = "${var.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb[0].id]
  subnets            = aws_subnet.public[*].id
  tags               = { Name = "${var.name_prefix}-alb" }
}

resource "aws_lb_target_group" "app" {
  count       = local.create ? 1 : 0
  name        = "${var.name_prefix}-tg"
  port        = var.container_port
  protocol    = "HTTP"
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

# HTTP listener. When HTTPS is enabled it redirects to HTTPS; otherwise it
# forwards directly (preview smoke test over HTTP on the ALB hostname).
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
      type             = "forward"
      target_group_arn = aws_lb_target_group.app[0].arn
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
