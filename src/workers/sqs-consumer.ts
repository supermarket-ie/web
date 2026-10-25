/**
 * Standalone SQS consumer worker — the AWS replacement for Vercel Queue
 * delivery. Runs as its own long-lived process (a separate ECS service/task),
 * NOT inside the website container.
 *
 * It imports every queue consumer route module, which (under QUEUE_BACKEND=sqs)
 * registers each topic's handler + options via `handleCallback`. It then
 * long-polls every topic's SQS queue and drives the SAME handler the Vercel
 * route uses, so all business logic and safeguards are identical.
 *
 * Reconciliation: the handlers themselves are idempotent against durable
 * Supabase state (scrape_product_receipts, scrape_runs status, egress
 * lease/cooldown, discovery receipts). They early-return when a run is no longer
 * 'running' and skip already-finalized products, so draining queued messages
 * after a restart resumes work without blind replay.
 *
 * Run with: QUEUE_BACKEND=sqs node --import tsx src/workers/sqs-consumer.ts
 */
import { allConsumers } from '@/lib/queue/registry';
import { sqsPollOnce } from '@/lib/queue/sqs-backend';
import { resolveQueueUrl } from '@/lib/queue/topics';

// Importing the route modules registers their handlers in the queue registry.
// (Side-effect imports — QUEUE_BACKEND must be 'sqs' so handleCallback registers.)
async function importConsumerModules() {
  await Promise.all([
    import('@/app/api/queues/tesco-scrape-batch/route'),
    import('@/app/api/queues/dunnes-scrape-batch/route'),
    import('@/app/api/queues/supervalu-scrape-batch/route'),
    import('@/app/api/queues/dunnes-discovery-batch/route'),
    import('@/app/api/queues/pepesto-tesco-products-batch/route'),
    import('@/app/api/queues/agent-product-change/route'),
  ]);
}

let running = true;

async function main() {
  if (process.env.QUEUE_BACKEND !== 'sqs') {
    throw new Error('sqs-consumer requires QUEUE_BACKEND=sqs');
  }
  await importConsumerModules();

  const consumers = allConsumers();
  // Only poll topics that have a configured queue URL. A missing URL for a topic
  // is logged once and skipped (e.g. a topic intentionally not migrated yet),
  // so the worker still serves the topics that ARE configured.
  const active = consumers.filter((c) => {
    const url = resolveQueueUrl(c.topic);
    if (!url) {
      console.warn('[sqs-consumer] no queue URL for topic; skipping', { topic: c.topic });
      return false;
    }
    return true;
  });

  console.log('[sqs-consumer] started', {
    region: process.env.AWS_REGION || 'eu-west-1',
    topics: active.map((c) => c.topic),
  });

  if (active.length === 0) {
    console.warn('[sqs-consumer] no active topics configured; idling');
  }

  // Poll each active topic concurrently in its own loop. Long-poll (20s) means
  // empty queues cost almost nothing.
  await Promise.all(
    active.map(async (c) => {
      while (running) {
        try {
          await sqsPollOnce(c.topic);
        } catch (error) {
          console.error('[sqs-consumer] poll error', {
            topic: c.topic,
            error: error instanceof Error ? error.message : String(error),
          });
          // Back off briefly on unexpected polling errors (e.g. throttling).
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }),
  );
}

function shutdown(signal: string) {
  console.log('[sqs-consumer] shutting down', { signal });
  running = false;
  // Give in-flight polls a moment to settle, then exit.
  setTimeout(() => process.exit(0), 2000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  console.error('[sqs-consumer] fatal', error);
  process.exit(1);
});
