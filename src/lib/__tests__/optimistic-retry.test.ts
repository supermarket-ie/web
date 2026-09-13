import { describe, expect, it, vi } from 'vitest';
import { OptimisticConcurrencyError, retryOptimisticMutation } from '../../../agent/lib/optimistic-retry';

describe('optimistic mutation retry', () => {
  it('reloads/retries after a concurrency conflict', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new OptimisticConcurrencyError())
      .mockResolvedValueOnce('saved');

    await expect(retryOptimisticMutation(operation, { attempts: 3, baseDelayMs: 0 })).resolves.toBe('saved');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry unrelated failures', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('database offline'));
    await expect(retryOptimisticMutation(operation, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow('database offline');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops after the bounded conflict retry budget', async () => {
    const operation = vi.fn().mockRejectedValue(new OptimisticConcurrencyError());
    await expect(retryOptimisticMutation(operation, { attempts: 3, baseDelayMs: 0 })).rejects.toBeInstanceOf(OptimisticConcurrencyError);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
