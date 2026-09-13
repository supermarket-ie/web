import { describe, expect, it } from 'vitest';
import { DependencyUnavailableError } from '../supabase-resilience';

describe('latest_prices dependency contract', () => {
  it('represents exhausted transient failures as dependency unavailable, not empty data', () => {
    const error = new DependencyUnavailableError('latest_prices.test', { status: 504, message: 'Gateway Timeout' });
    expect(error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(error.dependency).toBe('supabase');
    expect(error.message).toContain('temporarily unavailable');
  });
});
