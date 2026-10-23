# AWS Global Accelerator in front of the ALB, to give the apex (and www) two
# STATIC anycast IPs. Register365 uses plain DNS and the apex must be an A
# record; an ALB has no stable IP, so the apex A records point at the
# accelerator's static IPs instead. This keeps Register365 as the DNS host (no
# nameserver migration) while removing the Vercel apex dependency.
#
# BILLABLE: a provisioned accelerator incurs a fixed hourly fee + 2 static IPv4
# address charges + a DT-Premium data surcharge (~$25/mo fixed at low traffic).
# Guarded behind enable_global_accelerator (default false) so it is only created
# on explicit opt-in.

variable "enable_global_accelerator" {
  description = <<-EOT
    Provision an AWS Global Accelerator fronting the ALB to obtain two static
    anycast IPs for the apex A records. BILLABLE (fixed hourly fee + static IPv4
    charges + DT-Premium). Default false. The accelerator forwards to the same
    HTTPS listener on the ALB, so TLS/SNI and the apex->www redirect behave
    identically to hitting the ALB directly.
  EOT
  type        = bool
  default     = false
}

locals {
  # local.https_enabled is defined in alb.tf; Terraform locals are module-global,
  # so it is referenceable here. The accelerator only makes sense once the ALB
  # HTTPS listener exists.
  ga_enabled = local.https_enabled && var.enable_global_accelerator
}

resource "aws_globalaccelerator_accelerator" "this" {
  provider        = aws.global_accelerator
  count           = local.ga_enabled ? 1 : 0
  name            = "${var.name_prefix}-ga"
  ip_address_type = "IPV4"
  enabled         = true

  tags = { Name = "${var.name_prefix}-ga" }
}

resource "aws_globalaccelerator_listener" "https" {
  provider        = aws.global_accelerator
  count           = local.ga_enabled ? 1 : 0
  accelerator_arn = aws_globalaccelerator_accelerator.this[0].id
  client_affinity = "NONE"
  protocol        = "TCP"

  port_range {
    from_port = 443
    to_port   = 443
  }
}

# Also forward port 80 so the ALB's HTTP->HTTPS 301 still works through the
# accelerator (e.g. a bare http://supermarket.ie request).
resource "aws_globalaccelerator_listener" "http" {
  provider        = aws.global_accelerator
  count           = local.ga_enabled ? 1 : 0
  accelerator_arn = aws_globalaccelerator_accelerator.this[0].id
  client_affinity = "NONE"
  protocol        = "TCP"

  port_range {
    from_port = 80
    to_port   = 80
  }
}

resource "aws_globalaccelerator_endpoint_group" "https" {
  provider     = aws.global_accelerator
  count        = local.ga_enabled ? 1 : 0
  listener_arn = aws_globalaccelerator_listener.https[0].id

  # Health is checked against the ALB listener itself.
  endpoint_configuration {
    endpoint_id = aws_lb.this[0].arn
    weight      = 128
    # Preserve the real client IP to the ALB (needed for correct logging and any
    # IP-based logic). Requires the ALB SG to allow the GA managed prefix, which
    # it does via the existing 0.0.0.0/0 :443 ingress.
    client_ip_preservation_enabled = true
  }
}

resource "aws_globalaccelerator_endpoint_group" "http" {
  provider     = aws.global_accelerator
  count        = local.ga_enabled ? 1 : 0
  listener_arn = aws_globalaccelerator_listener.http[0].id

  endpoint_configuration {
    endpoint_id                    = aws_lb.this[0].arn
    weight                         = 128
    client_ip_preservation_enabled = true
  }
}

output "global_accelerator_static_ips" {
  description = "The two static anycast IPv4 addresses for the apex A records. Null until enable_global_accelerator=true."
  value       = local.ga_enabled ? aws_globalaccelerator_accelerator.this[0].ip_sets[0].ip_addresses : null
}

output "global_accelerator_dns_name" {
  description = "The accelerator's DNS name (alternative to the static IPs)."
  value       = local.ga_enabled ? aws_globalaccelerator_accelerator.this[0].dns_name : null
}
