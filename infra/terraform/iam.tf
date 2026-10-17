# IAM roles for ECS. Two roles:
#  - execution role: lets ECS pull the image, write logs, and read the specific
#    secrets we map in (least privilege; only the ARNs in var.secret_arns).
#  - task role: the app's own runtime identity. The preview needs NO AWS APIs,
#    so it has no attached policies (least privilege).

data "aws_iam_policy_document" "ecs_assume" {
  count = local.create ? 1 : 0
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  count              = local.create ? 1 : 0
  name               = "${var.name_prefix}-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume[0].json
  tags               = { Name = "${var.name_prefix}-exec" }
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  count      = local.create ? 1 : 0
  role       = aws_iam_role.execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow the execution role to read ONLY the mapped secret ARNs.
data "aws_iam_policy_document" "secrets_read" {
  count = local.create && length(var.secret_arns) > 0 ? 1 : 0
  statement {
    sid       = "ReadMappedSecrets"
    actions   = ["secretsmanager:GetSecretValue", "ssm:GetParameters", "ssm:GetParameter"]
    resources = values(var.secret_arns)
  }
}

resource "aws_iam_role_policy" "secrets_read" {
  count  = local.create && length(var.secret_arns) > 0 ? 1 : 0
  name   = "${var.name_prefix}-secrets-read"
  role   = aws_iam_role.execution[0].id
  policy = data.aws_iam_policy_document.secrets_read[0].json
}

resource "aws_iam_role" "task" {
  count              = local.create ? 1 : 0
  name               = "${var.name_prefix}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume[0].json
  tags               = { Name = "${var.name_prefix}-task" }
  # No policies attached: the preview app calls no AWS APIs directly.
}
