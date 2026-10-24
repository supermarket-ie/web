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
  # Base: the app calls no AWS APIs directly. SQS producer rights are added
  # (below) only when the worker stack exists, so the website can enqueue to SQS
  # once website_queue_backend=sqs.
}

# The website (producer) needs SQS SendMessage on the topic queues so it can
# route customer-triggered jobs to SQS when website_queue_backend=sqs. Added
# only when the queues exist (enable_workers=true); harmless before the routing
# switch since the website still routes to Vercel until then.
data "aws_iam_policy_document" "task_sqs_produce" {
  count = local.workers ? 1 : 0
  statement {
    sid       = "WebsiteSqsProduce"
    actions   = ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"]
    resources = local.queue_arns
  }
}

resource "aws_iam_role_policy" "task_sqs_produce" {
  count  = local.workers ? 1 : 0
  name   = "${var.name_prefix}-task-sqs-produce"
  role   = aws_iam_role.task[0].id
  policy = data.aws_iam_policy_document.task_sqs_produce[0].json
}
