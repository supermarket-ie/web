/**
 * Transport-neutral queue facade. Import `{ send, handleCallback }` from here
 * instead of `@vercel/queue`. Backend is chosen at runtime:
 *
 *   QUEUE_BACKEND=vercel (default) -> delegate to @vercel/queue (unchanged).
 *   QUEUE_BACKEND=sqs              -> produce to Amazon SQS; register the
 *                                     consumer handler so the standalone SQS
 *                                     worker can drive it.
 *
 * The handler/option shapes are identical to @vercel/queue, so producer and
 * consumer business logic is untouched. All existing safeguards (idempotent
 * Supabase receipts, Tesco egress lease/cooldown/canary, per-store spacing,
 * unresolved holds) live INSIDE the handlers and are therefore preserved on
 * both backends.
 */
import type {
  SendOptions,
  SendResult,
  CallbackHandler,
  HandleCallbackOptions,
} from './types';
import { registerConsumer } from './registry';

export type { SendOptions, SendResult, CallbackHandler, HandleCallbackOptions, CallbackMetadata, RetryDecision } from './types';

function backend(): 'vercel' | 'sqs' {
  return process.env.QUEUE_BACKEND === 'sqs' ? 'sqs' : 'vercel';
}

/** Produce a message to a topic. */
export async function send(topic: string, payload: unknown, options: SendOptions = {}): Promise<SendResult> {
  if (backend() === 'sqs') {
    const { sqsSend } = await import('./sqs-backend');
    return sqsSend(topic, payload, options);
  }
  // Vercel backend: delegate unchanged. Dynamic import keeps @vercel/queue out
  // of the SQS worker's module graph entirely.
  const vercel = await import('@vercel/queue');
  const result = await vercel.send(topic, payload, {
    idempotencyKey: options.idempotencyKey,
    retentionSeconds: options.retentionSeconds,
    delaySeconds: options.delaySeconds,
  });
  return { messageId: (result as { messageId?: string })?.messageId ?? 'unknown' };
}

/**
 * Register a consumer for a topic and return the HTTP POST route handler.
 *
 * On BOTH backends this returns a Next.js POST handler (so the `/api/queues/*`
 * routes still export POST and behave identically under Vercel delivery). On
 * the SQS backend it ALSO registers (topic, handler, options) so the standalone
 * worker can poll SQS and invoke the same handler.
 *
 * `topic` is required so the SQS worker can map a queue to its handler. Existing
 * routes pass their topic explicitly.
 */
export function handleCallback<T>(
  topic: string,
  handler: CallbackHandler<T>,
  options: HandleCallbackOptions = {},
): (request: Request) => Promise<Response> {
  if (backend() === 'sqs') {
    registerConsumer({ topic, handler: handler as CallbackHandler<unknown>, options });
  }

  // Return a POST route that works under Vercel Queue HTTP delivery. Under SQS
  // the worker drives the handler directly, but keeping the route exported is
  // harmless and preserves identical route surface.
  return async (request: Request): Promise<Response> => {
    // On Vercel, @vercel/queue's own handleCallback wraps delivery (signature
    // verification, metadata). To preserve that exactly, delegate to it when on
    // the Vercel backend.
    if (backend() === 'vercel') {
      const vercel = await import('@vercel/queue');
      const route = vercel.handleCallback(handler as never, options as never);
      return route(request as never) as Promise<Response>;
    }
    // SQS backend: the HTTP route is not the delivery path. Reject direct POSTs
    // so nothing accidentally invokes a consumer over HTTP.
    return new Response(JSON.stringify({ error: 'Queue consumer is driven by the SQS worker, not HTTP' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  };
}
