import { describe, it, expect } from 'vitest';
import {
  classifyIdentityOutcome,
  CONTINUE_REASONS,
  STOP_REASONS,
  BENIGN_REASON,
  MAX_CONSECUTIVE_HOLDS,
} from '../tesco-identity-disposition';

// PROPOSAL test evidence for docs/tesco-batch-continuation-proposal.md.
// Proves the classification policy over every real reason token + fail-closed
// default. Does NOT exercise the collector (behaviour unchanged in production).

describe('classifyIdentityOutcome — accept', () => {
  it('accepts only when there are no effective reasons and the product was found', () => {
    expect(classifyIdentityOutcome([], true)).toBe('accept');
  });
  it('treats a lone benign "no regular price" as not-accepted but also not an identity stop', () => {
    // benign-only + product found: effective is empty -> accept (price path handles
    // the no-price case separately; this classifier never fabricates an acceptance).
    expect(classifyIdentityOutcome([BENIGN_REASON], true)).toBe('accept');
  });
});

describe('classifyIdentityOutcome — hold_continue (ordinary product mismatches)', () => {
  for (const reason of CONTINUE_REASONS) {
    it(`holds and continues on "${reason}"`, () => {
      expect(classifyIdentityOutcome([reason], true)).toBe('hold_continue');
    });
    it(`holds and continues on "${reason}" even alongside the benign no-price reason`, () => {
      expect(classifyIdentityOutcome([reason, BENIGN_REASON], true)).toBe('hold_continue');
    });
  }

  it('holds when ALL effective reasons are ordinary (e.g. measure + pack)', () => {
    expect(classifyIdentityOutcome(['measureConflict', 'packCountConflict'], true)).toBe('hold_continue');
  });
});

describe('classifyIdentityOutcome — stop (systemic / fail-closed)', () => {
  for (const reason of STOP_REASONS) {
    it(`stops on "${reason}"`, () => {
      expect(classifyIdentityOutcome([reason], true)).toBe('stop');
    });
  }

  it('stops when the requested SKU was not found, regardless of reasons', () => {
    expect(classifyIdentityOutcome(['missing_exact_product'], false)).toBe('stop');
    expect(classifyIdentityOutcome([], false)).toBe('stop');
  });

  it('stops (fail-closed) on any unknown/novel reason token', () => {
    expect(classifyIdentityOutcome(['some_future_reason'], true)).toBe('stop');
  });

  it('stops if ANY effective reason is systemic, even mixed with ordinary ones', () => {
    expect(classifyIdentityOutcome(['measureConflict', 'different_sku_requires_mapping_review'], true)).toBe('stop');
    expect(classifyIdentityOutcome(['brandConflict', 'urlSkuConflict'], true)).toBe('stop');
  });
});

describe('policy invariants', () => {
  it('CONTINUE and STOP reason sets are disjoint', () => {
    for (const r of CONTINUE_REASONS) expect(STOP_REASONS.has(r)).toBe(false);
  });
  it('a sane circuit-breaker threshold is defined', () => {
    expect(MAX_CONSECUTIVE_HOLDS).toBeGreaterThan(0);
    expect(MAX_CONSECUTIVE_HOLDS).toBeLessThanOrEqual(10);
  });
  it('never returns accept for a non-empty effective reason set', () => {
    for (const r of [...CONTINUE_REASONS, ...STOP_REASONS]) {
      expect(classifyIdentityOutcome([r], true)).not.toBe('accept');
    }
  });
});
