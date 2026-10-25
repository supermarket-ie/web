import { describe, it, expect } from 'vitest';
import {
  classifyIdentityOutcome,
  holdCircuitTripped,
  CONTINUE_REASONS,
  STOP_REASONS,
  BENIGN_REASON,
  MAX_CONSECUTIVE_HOLDS,
  HOLD_RATE_MIN_ATTEMPTS,
  HOLD_RATE_THRESHOLD,
} from '../tesco-identity-disposition';

// Classification-policy evidence for docs/tesco-batch-continuation-proposal.md,
// with review refinements: strict accept, ambiguous->stop, skip_no_price,
// consecutive + rate circuit breakers.

describe('classifyIdentityOutcome — accept (strict invariant)', () => {
  it('accepts ONLY when the product was found and reasons is empty', () => {
    expect(classifyIdentityOutcome([], true)).toBe('accept');
  });
  it('does NOT accept when the product was not found, even with no reasons', () => {
    expect(classifyIdentityOutcome([], false)).toBe('stop');
  });
  it('never accepts when any reason is present', () => {
    for (const r of [...CONTINUE_REASONS, ...STOP_REASONS, BENIGN_REASON]) {
      expect(classifyIdentityOutcome([r], true)).not.toBe('accept');
    }
  });
});

describe('classifyIdentityOutcome — benign no-price (non-accepting, non-terminal)', () => {
  it('skips a lone benign no-price without accepting or stopping', () => {
    expect(classifyIdentityOutcome([BENIGN_REASON], true)).toBe('skip_no_price');
  });
  it('a benign no-price with the product not found still stops', () => {
    expect(classifyIdentityOutcome([BENIGN_REASON], false)).toBe('stop');
  });
});

describe('classifyIdentityOutcome — hold_continue (ordinary product mismatches)', () => {
  for (const reason of CONTINUE_REASONS) {
    it(`holds and continues on "${reason}"`, () => {
      expect(classifyIdentityOutcome([reason], true)).toBe('hold_continue');
    });
    it(`holds on "${reason}" even alongside the benign no-price reason`, () => {
      expect(classifyIdentityOutcome([reason, BENIGN_REASON], true)).toBe('hold_continue');
    });
  }
  it('holds when ALL effective reasons are ordinary (measure + pack)', () => {
    expect(classifyIdentityOutcome(['measureConflict', 'packCountConflict'], true)).toBe('hold_continue');
  });
});

describe('classifyIdentityOutcome — stop (systemic / ambiguous / fail-closed)', () => {
  for (const reason of STOP_REASONS) {
    it(`stops on "${reason}"`, () => {
      expect(classifyIdentityOutcome([reason], true)).toBe('stop');
    });
  }
  it('keeps the ambiguous-generic reason as STOP (refinement 2)', () => {
    expect(classifyIdentityOutcome(['candidate does not establish full exact canonical identity'], true)).toBe('stop');
    expect(CONTINUE_REASONS.has('candidate does not establish full exact canonical identity')).toBe(false);
  });
  it('stops (fail-closed) on any unknown/novel reason token', () => {
    expect(classifyIdentityOutcome(['some_future_reason'], true)).toBe('stop');
  });
  it('stops if ANY effective reason is systemic, even mixed with ordinary ones', () => {
    expect(classifyIdentityOutcome(['measureConflict', 'different_sku_requires_mapping_review'], true)).toBe('stop');
    expect(classifyIdentityOutcome(['brandConflict', 'urlSkuConflict'], true)).toBe('stop');
  });
});

describe('holdCircuitTripped — consecutive breaker (3)', () => {
  it('trips at exactly MAX_CONSECUTIVE_HOLDS consecutive holds', () => {
    expect(MAX_CONSECUTIVE_HOLDS).toBe(3);
    expect(holdCircuitTripped(2, 2, 2)).toBe(false);
    expect(holdCircuitTripped(3, 3, 3)).toBe('consecutive');
  });
  it('does not trip on consecutive<3 even with holds present', () => {
    expect(holdCircuitTripped(1, 5, 9)).toBe(false);
  });
});

describe('holdCircuitTripped — rate breaker (40% after 10 attempts)', () => {
  it('ignores the rate below the minimum attempts', () => {
    expect(HOLD_RATE_MIN_ATTEMPTS).toBe(10);
    expect(HOLD_RATE_THRESHOLD).toBe(0.4);
    // 4/9 = 44% but only 9 attempts -> not yet evaluated
    expect(holdCircuitTripped(1, 4, 9)).toBe(false);
  });
  it('does not trip at exactly the threshold (must EXCEED 40%)', () => {
    // 4/10 = 40% exactly -> not tripped
    expect(holdCircuitTripped(1, 4, 10)).toBe(false);
  });
  it('trips once the rate exceeds 40% after >=10 attempts', () => {
    // 5/10 = 50%
    expect(holdCircuitTripped(1, 5, 10)).toBe('rate');
    // 7/15 = 46.7%
    expect(holdCircuitTripped(2, 7, 15)).toBe('rate');
  });
  it('consecutive breaker takes precedence when both would trip', () => {
    expect(holdCircuitTripped(3, 9, 12)).toBe('consecutive');
  });
});

describe('policy invariants', () => {
  it('CONTINUE and STOP reason sets are disjoint', () => {
    for (const r of CONTINUE_REASONS) expect(STOP_REASONS.has(r)).toBe(false);
  });
});
