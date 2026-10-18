import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import type { SendOptions, SendResult, CallbackMetadata } from './types';
import { resolveQueueUrl, queueUrlEnvVar } from './topics';
import { getConsumer } from './registry';

// SQS DelaySeconds hard cap.
const SQS_MAX_DELAY_SECONDS = 900;

let _client: SQSClient | null = null;
function client(): SQSClient {
  if (!_client) {
    _client = new SQSClient({ region: process.env.AWS_REGION || 'eu-west-1' });
  }
  return _client;
}

export async function sqsSend(topic: string, payload: unknown, options: SendOptions = {}): Promise<SendResult> {
  const queueUrl = resolveQueueUrl(topic);
  if (!queueUrl) {
    throw new Error(`SQS queue URL not configured for topic "${topic}" (expected env ${queueUrlEnvVar(topic)})`);
  }

  const delay = Math.max(0, Math.min(Math.floor(options.delaySeconds ?? 0), SQS_MAX_DELAY_SECONDS));
  if ((options.delaySeconds ?? 0) > SQS_MAX_DELAY_SECONDS) {
    // Large staggers can't be expressed as a single SQS delay. Clamp and log;
    // the consumer's idempotent receipt check keeps this safe (work is simply
    // eligible sooner, never duplicated or skipped).
    console.warn('[queue:sqs] delaySeconds exceeds SQS max; clamped', {
      topic,
      requested: options.delaySeconds,
      clamped: SQS_MAX_DELAY_SECONDS,
    });
  }

  const out = await client().send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(payload),
      DelaySeconds: delay,
      // Carry the idempotency key as an attribute for observability. True dedup
      // remains the durable Supabase receipts, exactly as on Vercel.
      MessageAttributes: options.idempotencyKey
        ? { idempotencyKey: { DataType: 'String', StringValue: options.idempotencyKey } }
        : undefined,
    }),
  );

  return { messageId: out.MessageId ?? 'unknown' };
}

/**
 * Long-poll one topic's queue and drive its registered handler.
 *
 * Re-implements the @vercel/queue retry contract against SQS:
 *  - deliveryCount = ApproximateReceiveCount
 *  - on success: DeleteMessage (acknowledge)
 *  - on handler throw: consult the topic's retry() closure
 *      { acknowledge: true }  -> DeleteMessage (give up / permanently handled)
 *      { afterSeconds: n }     -> ChangeMessageVisibility(n) to redeliver later
 *  - visibilityTimeoutSeconds is applied on receive so a slow handler keeps the
 *    message hidden while it runs (matches the Vercel visibility semantics).
 *
 * Returns the number of messages processed in this poll cycle.
 */
export async function sqsPollOnce(topic: string, maxMessages = 5): Promise<number> {
  const consumer = getConsumer(topic);
  if (!consumer) throw new Error(`No registered consumer for topic "${topic}"`);
  const queueUrl = resolveQueueUrl(topic);
  if (!queueUrl) throw new Error(`SQS queue URL not configured for topic "${topic}"`);

  const visibility = consumer.options.visibilityTimeoutSeconds ?? 300;

  const received = await client().send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: Math.max(1, Math.min(maxMessages, 10)),
      WaitTimeSeconds: 20, // long poll
      VisibilityTimeout: visibility,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      MessageAttributeNames: ['All'],
    }),
  );

  const messages = received.Messages ?? [];
  for (const m of messages) {
    const deliveryCount = Number(m.Attributes?.ApproximateReceiveCount ?? '1');
    const metadata: CallbackMetadata = { deliveryCount, messageId: m.MessageId ?? 'unknown' };
    let payload: unknown;
    try {
      payload = m.Body ? JSON.parse(m.Body) : null;
    } catch {
      // Unparseable message: delete so it doesn't poison the queue.
      console.error('[queue:sqs] dropping unparseable message', { topic, messageId: m.MessageId });
      await client().send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
      continue;
    }

    try {
      await consumer.handler(payload, metadata);
      await client().send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
    } catch (error) {
      const decision = consumer.options.retry
        ? consumer.options.retry(error, metadata)
        : { afterSeconds: 30 };
      if ('acknowledge' in decision && decision.acknowledge) {
        await client().send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
        console.warn('[queue:sqs] handler failed; acknowledged per retry policy', {
          topic, messageId: m.MessageId, deliveryCount,
        });
      } else {
        const afterSeconds = Math.max(0, Math.min(Math.floor((decision as { afterSeconds: number }).afterSeconds), SQS_MAX_DELAY_SECONDS));
        await client().send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: m.ReceiptHandle!,
            VisibilityTimeout: afterSeconds,
          }),
        );
        console.warn('[queue:sqs] handler failed; will redeliver', {
          topic, messageId: m.MessageId, deliveryCount, afterSeconds,
        });
      }
    }
  }

  return messages.length;
}
