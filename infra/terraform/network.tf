# Networking for the preview: a small VPC with public subnets for the ALB and
# the Fargate service. Private subnets + optional NAT are defined for the later
# production phase but NAT stays disabled in preview.

locals {
  create = var.create_resources
  # Stage-2 gate: ECS task/service only exist once an image has been pushed.
  deploy_app = var.create_resources && var.deploy_application
  azs        = var.create_resources ? slice(data.aws_availability_zones.available[0].names, 0, var.az_count) : []
}

data "aws_availability_zones" "available" {
  count = local.create ? 1 : 0
  state = "available"
}

resource "aws_vpc" "this" {
  count                = local.create ? 1 : 0
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "this" {
  count  = local.create ? 1 : 0
  vpc_id = aws_vpc.this[0].id
  tags   = { Name = "${var.name_prefix}-igw" }
}

resource "aws_subnet" "public" {
  count                   = local.create ? var.az_count : 0
  vpc_id                  = aws_vpc.this[0].id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.name_prefix}-public-${count.index}", Tier = "public" }
}

resource "aws_subnet" "private" {
  count             = local.create ? var.az_count : 0
  vpc_id            = aws_vpc.this[0].id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  availability_zone = local.azs[count.index]
  tags              = { Name = "${var.name_prefix}-private-${count.index}", Tier = "private" }
}

resource "aws_route_table" "public" {
  count  = local.create ? 1 : 0
  vpc_id = aws_vpc.this[0].id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this[0].id
  }
  tags = { Name = "${var.name_prefix}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = local.create ? var.az_count : 0
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

# --- Optional NAT (production egress only; disabled in preview) ------------

resource "aws_eip" "nat" {
  count  = local.create && var.enable_nat_gateway ? 1 : 0
  domain = "vpc"
  tags   = { Name = "${var.name_prefix}-nat-eip" }
}

resource "aws_nat_gateway" "this" {
  count         = local.create && var.enable_nat_gateway ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = { Name = "${var.name_prefix}-nat" }
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "private" {
  count  = local.create ? 1 : 0
  vpc_id = aws_vpc.this[0].id
  tags   = { Name = "${var.name_prefix}-private-rt" }
}

resource "aws_route" "private_nat" {
  count                  = local.create && var.enable_nat_gateway ? 1 : 0
  route_table_id         = aws_route_table.private[0].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}

resource "aws_route_table_association" "private" {
  count          = local.create ? var.az_count : 0
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

# --- Security groups -------------------------------------------------------

resource "aws_security_group" "alb" {
  count       = local.create ? 1 : 0
  name        = "${var.name_prefix}-alb-sg"
  description = "Preview ALB: allow inbound HTTPS/HTTP from the internet."
  vpc_id      = aws_vpc.this[0].id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP (redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.name_prefix}-alb-sg" }
}

resource "aws_security_group" "service" {
  count       = local.create ? 1 : 0
  name        = "${var.name_prefix}-svc-sg"
  description = "Preview Fargate service: allow traffic only from the ALB."
  vpc_id      = aws_vpc.this[0].id

  ingress {
    description     = "App port from ALB"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb[0].id]
  }
  egress {
    description = "All outbound (Supabase/Anthropic/Resend over HTTPS)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.name_prefix}-svc-sg" }
}
