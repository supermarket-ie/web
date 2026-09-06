import { describe, expect, it } from 'vitest';
import { emptyHouseholdMemory, forgetMemoryKey, mergeInferredProducts, normaliseHouseholdMemory, setExplicitMemoryFact } from '../household-memory';

const product = (lastObserved = '2026-08-20T00:00:00.000Z') => ({ canonical_name: 'Whole Milk', usual_quantity: 2, likely_replenishment_days: 7, confidence: 0.8, supporting_observations: 4, last_observed_at: lastObserved });

describe('governed household memory', () => {
  it('keeps explicit facts distinct and correctable', () => {
    const first = setExplicitMemoryFact(emptyHouseholdMemory(), 'weekly_budget', 100, '2026-09-01T00:00:00.000Z');
    const corrected = setExplicitMemoryFact(first, 'weekly_budget', 80, '2026-09-02T00:00:00.000Z');
    expect(corrected.explicit.weekly_budget.value).toBe(80);
    expect(corrected.explicit.weekly_budget.created_at).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rejects sensitive and temporary free-form memory', () => {
    expect(() => setExplicitMemoryFact(emptyHouseholdMemory(), 'extra_context', 'Get stamps today', new Date().toISOString())).toThrow(/Unsupported/);
    expect(() => setExplicitMemoryFact(emptyHouseholdMemory(), 'dislikes', 'email me at me@example.com', new Date().toISOString())).toThrow(/Sensitive/);
  });

  it('does not let delayed inference restore forgotten memory', () => {
    const base = mergeInferredProducts(emptyHouseholdMemory(), [product()], '2026-09-01T00:00:00.000Z', '2026-09-01T00:01:00.000Z');
    const forgotten = forgetMemoryKey(base, 'product:whole milk', '2026-09-02T00:00:00.000Z');
    const raced = mergeInferredProducts(forgotten, [product()], '2026-09-01T23:00:00.000Z', '2026-09-02T00:01:00.000Z');
    expect(raced.inferred_products['whole milk']).toBeUndefined();
  });

  it('expires inferred evidence after the retention window', () => {
    const memory = mergeInferredProducts(emptyHouseholdMemory(), [product('2025-01-01T00:00:00.000Z')], '2026-09-01T00:00:00.000Z', '2026-09-06T00:00:00.000Z');
    expect(memory.inferred_products).toEqual({});
  });

  it('adapts legacy stopped products without preserving ungoverned summaries', () => {
    const memory = normaliseHouseholdMemory({ droppedItems: ['Cola'], lastShopSummary: 'private errand' }, '2026-09-06T00:00:00.000Z');
    expect(memory.explicit.stopped_products.value).toEqual(['Cola']);
    expect(memory).not.toHaveProperty('lastShopSummary');
  });
});
