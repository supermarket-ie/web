export class OptimisticConcurrencyError extends Error {
  constructor(message = 'The resource changed while this action was running.') {
    super(message);
    this.name = 'OptimisticConcurrencyError';
  }
}

export async function retryOptimisticMutation<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 25);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const isConflict = error instanceof OptimisticConcurrencyError;
      if (!isConflict || attempt === attempts) throw error;
      if (baseDelayMs > 0) await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));
    }
  }

  throw new OptimisticConcurrencyError('Optimistic retry budget exhausted.');
}
