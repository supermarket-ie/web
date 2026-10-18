import type { CallbackHandler, HandleCallbackOptions } from './types';

/**
 * Registry of consumer handlers keyed by topic.
 *
 * `handleCallback` records its (handler, options) here when invoked. The
 * standalone SQS worker imports all consumer route modules (which call
 * handleCallback at module load) and then looks the handler up by topic to
 * drive it from SQS — reusing the exact same handler the Vercel route uses.
 *
 * The topic a given route serves is resolved via `topicForModule` so a single
 * registry works even though route files don't pass their topic to
 * handleCallback. We register under an incrementing key and expose a setter the
 * route modules call explicitly in SQS mode (see queue/index.ts).
 */

export type RegisteredConsumer = {
  topic: string;
  handler: CallbackHandler<unknown>;
  options: HandleCallbackOptions;
};

const consumers = new Map<string, RegisteredConsumer>();

export function registerConsumer(entry: RegisteredConsumer): void {
  consumers.set(entry.topic, entry);
}

export function getConsumer(topic: string): RegisteredConsumer | undefined {
  return consumers.get(topic);
}

export function allConsumers(): RegisteredConsumer[] {
  return [...consumers.values()];
}
