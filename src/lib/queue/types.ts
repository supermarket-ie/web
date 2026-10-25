/**
 * Transport-neutral queue contract.
 *
 * Mirrors the subset of `@vercel/queue` the app uses so producers/consumers can
 * import from `@/lib/queue` and run on EITHER Vercel Queues OR Amazon SQS,
 * selected at runtime by QUEUE_BACKEND. The handler and option shapes are
 * IDENTICAL to @vercel/queue so no business logic changes.
 */

export type SendOptions = {
  /** Deduplication key. On Vercel -> idempotencyKey; on SQS -> used as a hint
   *  only (true dedup is the durable Supabase receipts, as today). */
  idempotencyKey?: string;
  /** Message retention (seconds). Vercel -> retentionSeconds; SQS -> informational
   *  (queue-level MessageRetentionPeriod is set on the queue by Terraform). */
  retentionSeconds?: number;
  /** Delivery delay (seconds). Vercel -> delaySeconds; SQS -> DelaySeconds
   *  (capped at 900s by SQS; the adapter clamps and logs if exceeded). */
  delaySeconds?: number;
};

export type SendResult = { messageId: string };

/** Metadata passed to a consumer handler. Matches @vercel/queue's shape for the
 *  fields the handlers actually read. */
export type CallbackMetadata = {
  deliveryCount: number;
  messageId: string;
};

export type CallbackHandler<T> = (message: T, metadata: CallbackMetadata) => Promise<void> | void;

/** Return value of the per-topic retry closure (identical to @vercel/queue). */
export type RetryDecision = { acknowledge: true } | { afterSeconds: number };

export type HandleCallbackOptions = {
  visibilityTimeoutSeconds?: number;
  retry?: (error: unknown, metadata: CallbackMetadata) => RetryDecision;
};
