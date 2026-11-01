import './setup-env';
import { describe, expect, it } from 'vitest';
import {
  MAX_OUTPUT_TOKENS,
  MAX_STEPS,
  actualTurnCostCents,
  estimateTurnCostCents,
  trimMessagesToBudget,
  MAX_INPUT_CHARS,
} from '../limits';

describe('estimateTurnCostCents (spend-breaker reservation)', () => {
  it('reserves for the WORST CASE of a multi-step tool loop, not a single call', () => {
    const inputChars = 4000; // ~1000 input tokens
    const reserved = estimateTurnCostCents(inputChars);

    // A single-call estimate would have been ~ (1000/1e6*300) + (2000/1e6*1500)
    // = 0.3 + 3.0 = 3.3 cents. The worst case across MAX_STEPS must be larger.
    const singleCallCents = (1000 / 1_000_000) * 300 + (MAX_OUTPUT_TOKENS / 1_000_000) * 1500;
    expect(reserved).toBeGreaterThan(singleCallCents);
  });

  it('reservation >= the maximum the turn can actually cost (reserve >= any real settle)', () => {
    const inputChars = 8000; // ~2000 input tokens
    const reserved = estimateTurnCostCents(inputChars);

    // Worst realistic settle: every one of MAX_STEPS steps re-sends the input and
    // emits the full output ceiling. (Our reservation bounds input growth by
    // MAX_STEPS x initial input, which upper-bounds accumulating tool results.)
    const initialInputTokens = Math.ceil(inputChars / 4);
    const worstSettle = actualTurnCostCents(initialInputTokens * MAX_STEPS, MAX_OUTPUT_TOKENS * MAX_STEPS);
    expect(reserved).toBeGreaterThanOrEqual(worstSettle);
  });

  it('never reserves below a floor so tiny turns still debit the ledger', () => {
    expect(estimateTurnCostCents(0)).toBeGreaterThanOrEqual(0.1);
  });

  it('scales with MAX_STEPS (loop cost, not single-shot)', () => {
    // output component alone must equal MAX_STEPS x per-step ceiling priced at $15/1M
    const reserved = estimateTurnCostCents(0);
    const outputComponent = (MAX_OUTPUT_TOKENS * MAX_STEPS / 1_000_000) * 1500;
    expect(reserved).toBeGreaterThanOrEqual(outputComponent);
  });
});

describe('actualTurnCostCents (settle)', () => {
  it('prices input and output per Bedrock Sonnet rates', () => {
    // 1M input + 1M output = $3 + $15 = $18 = 1800 cents
    expect(actualTurnCostCents(1_000_000, 1_000_000)).toBeCloseTo(1800, 0);
  });
  it('never negative', () => {
    expect(actualTurnCostCents(0, 0)).toBe(0);
  });
});

describe('trimMessagesToBudget (input bound)', () => {
  it('keeps the most recent message and trims oldest first', () => {
    const big = 'x'.repeat(MAX_INPUT_CHARS);
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: big }] },
      { role: 'assistant', parts: [{ type: 'text', text: big }] },
      { role: 'user', parts: [{ type: 'text', text: 'latest question' }] },
    ];
    const trimmed = trimMessagesToBudget(messages);
    expect(trimmed[trimmed.length - 1].parts![0].text).toBe('latest question');
    expect(trimmed.length).toBeLessThan(messages.length);
  });
});
