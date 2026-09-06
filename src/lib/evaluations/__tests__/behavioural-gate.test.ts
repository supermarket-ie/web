import { describe, expect, it } from 'vitest';
import { BEHAVIOURAL_DIMENSIONS, criticalFailures, evaluationCoverage, evaluateBehaviouralFixture } from '../behavioural';
import { behaviouralFixtures } from '../fixtures';

describe('Phase 8 behavioural release gate', () => {
  it.each(behaviouralFixtures)('$id has no critical deterministic failures', fixture => {
    expect(criticalFailures(fixture)).toEqual([]);
  });

  it('covers every required scoring dimension', () => {
    const coverage = evaluationCoverage(behaviouralFixtures);
    expect(Object.keys(coverage)).toEqual([...BEHAVIOURAL_DIMENSIONS]);
    expect(Object.values(coverage).every(count => count > 0)).toBe(true);
  });

  it('keeps qualitative scores visible without making them blocking', () => {
    const reviews = behaviouralFixtures.flatMap(fixture => evaluateBehaviouralFixture(fixture).filter(result => result.status === 'review'));
    expect(reviews.some(result => result.dimension === 'household_coherence')).toBe(true);
    expect(reviews.some(result => result.dimension === 'quantities')).toBe(true);
    expect(reviews.some(result => result.dimension === 'retailer_split')).toBe(true);
  });

  it('detects unsupported checkout claims as a release blocker', () => {
    const unsafe = structuredClone(behaviouralFixtures[0]);
    unsafe.captured.handoff_claim = 'checkout_complete';
    unsafe.captured.handoff_proven = false;
    expect(criticalFailures(unsafe).map(result => result.dimension)).toContain('handoff_truth');
  });
});
