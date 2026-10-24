# ECR repository for the container image. CI builds and pushes here; ECS pulls.

resource "aws_ecr_repository" "app" {
  count                = local.create ? 1 : 0
  name                 = var.name_prefix
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${var.name_prefix}-ecr" }
}

# Keep the repo small: expire untagged images after 14 days.
resource "aws_ecr_lifecycle_policy" "app" {
  count      = local.create ? 1 : 0
  repository = aws_ecr_repository.app[0].name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images after 14 days"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 14
      }
      action = { type = "expire" }
    }]
  })
}
