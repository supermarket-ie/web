import { describe, expect, it, vi } from 'vitest';
import { DependencyUnavailableError, isTransientSupabaseError, withSupabaseRetry } from '../supabase-resilience';

describe('Supabase dependency resilience', () => {
  it('classifies gateway timeouts as transient', () => {
    expect(isTransientSupabaseError({ status: 504, message: 'Gateway Timeout' })).toBe(true);
    expect(isTransientSupabaseError({ message: 'upstream request timed out' })).toBe(true);
    expect(isTransientSupabaseError({ code: '23505', message: 'duplicate key' })).toBe(false);
  });

  it('retries a transient failure and returns recovered data', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { status: 504, message: 'Gateway Timeout' } })
      .mockResolvedValueOnce({ data: ['ok'], error: null });

    await expect(withSupabaseRetry('latest_prices.test', run, { attempts: 3, baseDelayMs: 0 }))
      .resolves.toEqual({ data: ['ok'], error: null });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry deterministic database errors', async () => {
    const result = { data: null, error: { code: '23505', message: 'duplicate key' } };
    const run = vi.fn().mockResolvedValue(result);

    await expect(withSupabaseRetry('write.test', run, { attempts: 3, baseDelayMs: 0 })).resolves.toEqual(result);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('throws an explicit dependency error after bounded transient retries', async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: { status: 504, message: 'Gateway Timeout' } });

    await expect(withSupabaseRetry('latest_prices.test', run, { attempts: 2, baseDelayMs: 0 }))
      .rejects.toBeInstanceOf(DependencyUnavailableError);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
