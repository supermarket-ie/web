/**
 * The full set of queue topics and their SQS queue-URL env var names.
 *
 * Topic names are the SAME strings used with @vercel/queue today, so the Vercel
 * backend is unaffected. For the SQS backend, each topic maps to a queue whose
 * URL is provided by an env var (set by Terraform / ECS). If a topic's env var
 * is missing in SQS mode, producing to it fails loudly rather than silently
 * dropping retailer work.
 */

export const QUEUE_TOPICS = [
  'tesco-scrape-batches',
  'pepesto-tesco-products-batches',
  'dunnes-scrape-batches',
  'dunnes-discovery-batches',
  'supervalu-scrape-batches',
  'agent-product-changes',
] as const;

export type QueueTopic = (typeof QUEUE_TOPICS)[number];

/** Env var carrying the SQS queue URL for a topic, e.g.
 *  tesco-scrape-batches -> SQS_URL_TESCO_SCRAPE_BATCHES */
export function queueUrlEnvVar(topic: string): string {
  return 'SQS_URL_' + topic.toUpperCase().replace(/-/g, '_');
}

export function resolveQueueUrl(topic: string): string | undefined {
  return process.env[queueUrlEnvVar(topic)];
}
