export type SupabaseLikeError = {
  message?: string | null;
  code?: string | null;
  status?: number | null;
  statusCode?: number | null;
};

export class DependencyUnavailableError extends Error {
  readonly dependency = 'supabase';
  readonly code = 'DEPENDENCY_UNAVAILABLE';

  constructor(public readonly operation: string, public readonly causeError: SupabaseLikeError) {
    super(`${operation} temporarily unavailable: ${causeError.message ?? 'Supabase request failed'}`);
    this.name = 'DependencyUnavailableError';
  }
}

export function isTransientSupabaseError(error: SupabaseLikeError | null | undefined): boolean {
  if (!error) return false;
  const status = error.status ?? error.statusCode ?? null;
  if (status != null && [429, 502, 503, 504].includes(status)) return true;

  const text = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
  return /gateway|timeout|timed out|temporar|connection|fetch failed|econnreset|econnrefused|rate limit|too many requests|502|503|504/.test(text);
}

export async function withSupabaseRetry<T>(
  operation: string,
  run: () => PromiseLike<{ data: T; error: SupabaseLikeError | null }>,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<{ data: T; error: SupabaseLikeError | null }> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 120);

  let last: { data: T; error: SupabaseLikeError | null } | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await run();
    if (!last.error || !isTransientSupabaseError(last.error)) return last;

    console.warn('[supabase_dependency_retry]', {
      operation,
      attempt,
      attempts,
      code: last.error.code ?? null,
      status: last.error.status ?? last.error.statusCode ?? null,
      message: last.error.message ?? null,
    });

    if (attempt < attempts && baseDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));
    }
  }

  if (last?.error && isTransientSupabaseError(last.error)) {
    console.error('[supabase_dependency_unavailable]', {
      operation,
      attempts,
      code: last.error.code ?? null,
      status: last.error.status ?? last.error.statusCode ?? null,
      message: last.error.message ?? null,
    });
    throw new DependencyUnavailableError(operation, last.error);
  }

  return last as { data: T; error: SupabaseLikeError | null };
}
