import { stepCountIs } from 'ai';

/**
 * Model-usage caps for the lightweight stateless agent PoC.
 *
 * These are intentionally conservative — the PoC is a cost- and
 * abuse-bounded surface, not the full Eve session runtime. Every value here
 * caps a single HTTP turn; there is NO per-session accumulation in process
 * (all durable state lives in Supabase, see safeguards.ts).
 */

/** Hard ceiling on tokens the model may generate in a single turn. */
export const MAX_OUTPUT_TOKENS = 2000;

/**
 * Maximum tool/model steps per turn. `streamText` stops once this many steps
 * have run, which bounds tool-call fan-out (e.g. price lookup -> present shop).
 */
export const MAX_STEPS = 5;

/** Per-request wall-clock budget. The turn aborts if the model/tools exceed it. */
export const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Input budget (characters) used to trim the oldest conversation turns before
 * sending to the model. ~4 chars/token, so ~24k chars ≈ 6k input tokens — a
 * sane bound for a single lightweight turn well under the model window.
 */
export const MAX_INPUT_CHARS = 24_000;

/** Rough chars-per-token ratio for pre-call token estimation. */
export const CHARS_PER_TOKEN = 4;

/** `stopWhen` predicate passed to `streamText`. */
export const stopWhenMaxSteps = stepCountIs(MAX_STEPS);

/**
 * Build an AbortSignal that fires after {@link REQUEST_TIMEOUT_MS}. Callers pass
 * the returned `signal` to `streamText({ abortSignal })` and call `clear()` in
 * `onFinish`/`onError` so the timer never leaks.
 */
export function requestTimeout(ms: number = REQUEST_TIMEOUT_MS): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

type TrimmableMessage = { role: string; parts?: Array<{ type?: string; text?: string }> };

/** Approximate the character length of a UIMessage for budgeting. */
function messageChars(message: TrimmableMessage): number {
  if (!Array.isArray(message.parts)) return 0;
  return message.parts.reduce((sum, part) => sum + (part?.text ? part.text.length : 0), 0);
}

/**
 * Trim a UIMessage array to the input budget by dropping the OLDEST messages
 * first while always keeping the most recent user turn. Pure and deterministic
 * so it is safe across concurrent stateless tasks.
 */
export function trimMessagesToBudget<T extends TrimmableMessage>(
  messages: T[],
  maxChars: number = MAX_INPUT_CHARS,
): T[] {
  if (messages.length <= 1) return messages;
  let total = messages.reduce((sum, message) => sum + messageChars(message), 0);
  if (total <= maxChars) return messages;

  const trimmed = [...messages];
  // Always preserve the final message (the current user turn).
  while (trimmed.length > 1 && total > maxChars) {
    const removed = trimmed.shift();
    if (!removed) break;
    total -= messageChars(removed);
  }
  return trimmed;
}

/**
 * Estimate the spend (in cents) a turn may cost BEFORE the model call, from the
 * trimmed input size plus the full output ceiling. Deliberately pessimistic —
 * the reservation is reconciled down to actuals in `onFinish`.
 *
 * Priced against Claude Sonnet on Bedrock (order-of-magnitude): $3 / 1M input
 * tokens, $15 / 1M output tokens. Expressed in cents.
 */
export function estimateTurnCostCents(inputChars: number): number {
  const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);
  const inputCents = (inputTokens / 1_000_000) * 300;
  const outputCents = (MAX_OUTPUT_TOKENS / 1_000_000) * 1500;
  // Never reserve less than a tenth of a cent so a tiny turn still debits the ledger.
  return Math.max(0.1, Number((inputCents + outputCents).toFixed(4)));
}

/** Convert settled model usage (tokens) into actual spend in cents. */
export function actualTurnCostCents(inputTokens: number, outputTokens: number): number {
  const inputCents = (inputTokens / 1_000_000) * 300;
  const outputCents = (outputTokens / 1_000_000) * 1500;
  return Math.max(0, Number((inputCents + outputCents).toFixed(4)));
}
