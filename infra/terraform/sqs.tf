# SQS queues replacing Vercel Queues. One main queue + DLQ per topic. Gated by
# enable_workers (default false) so the website can deploy with NO workers and
# no duplicate background processing while Vercel still runs them.

locals {
  # Topics must match src/lib/queue/topics.ts QUEUE_TOPICS exactly.
  queue_topics = [
    "tesco-scrape-batches",
    "pepesto-tesco-products-batches",
    "dunnes-scrape-batches",
    "dunnes-discovery-batches",
    "supervalu-scrape-batches",
    "agent-product-changes",
  ]
  workers   = var.create_resources && var.enable_workers
  queue_set = local.workers ? toset(local.queue_topics) : toset([])

  # Env var name the app expects per topic: SQS_URL_<TOPIC_UPPER_SNAKE>
  queue_url_env = { for t in local.queue_topics : t => "SQS_URL_${upper(replace(t, "-", "_"))}" }
}

resource "aws_sqs_queue" "dlq" {
  for_each                  = local.queue_set
  name                      = "${var.name_prefix}-${each.key}-dlq"
  message_retention_seconds = 1209600 # 14 days, for inspection of poison messages
  tags                      = { Name = "${var.name_prefix}-${each.key}-dlq" }
}

resource "aws_sqs_queue" "topic" {
  for_each                   = local.queue_set
  name                       = "${var.name_prefix}-${each.key}"
  message_retention_seconds  = 86400 # 24h, matches the app's retentionSeconds
  visibility_timeout_seconds = 600   # >= the largest consumer visibilityTimeoutSeconds
  receive_wait_time_seconds  = 20    # long polling
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    # Generous maxReceiveCount: the app's own per-topic retry closures decide
    # when to give up (ack). This DLQ is a backstop for truly stuck messages.
    maxReceiveCount = 10
  })
  tags = { Name = "${var.name_prefix}-${each.key}" }
}

# Map of topic -> queue URL, consumed by ecs.tf to inject SQS_URL_* env vars.
locals {
  queue_urls = { for t, q in aws_sqs_queue.topic : local.queue_url_env[t] => q.url }
  queue_arns = [for q in aws_sqs_queue.topic : q.arn]
  dlq_arns   = [for q in aws_sqs_queue.dlq : q.arn]
}
