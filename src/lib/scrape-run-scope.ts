export const RETAILER_RUN_SCOPES = [
  'scheduled_full',
  'targeted_validation',
  'canary',
  'catch_up',
  'discovery',
  'manual',
] as const;

export type RetailerRunScope = (typeof RETAILER_RUN_SCOPES)[number];

type ResolveScopeInput = {
  requested: string | null;
  limit: number;
  query?: string;
};

export function resolveRetailerRunScope(input: ResolveScopeInput):
  | { scope: RetailerRunScope; error?: never }
  | { scope?: never; error: string } {
  const requested = input.requested?.trim().toLowerCase();
  if (requested) {
    if (!RETAILER_RUN_SCOPES.includes(requested as RetailerRunScope)) {
      return { error: `Unsupported run scope: ${requested}` };
    }
    if (requested === 'scheduled_full' && (input.limit < 1000 || Boolean(input.query))) {
      return { error: 'scheduled_full requires an unfiltered run of at least 1,000 products' };
    }
    return { scope: requested as RetailerRunScope };
  }

  return {
    scope: input.limit >= 1000 && !input.query ? 'scheduled_full' : 'targeted_validation',
  };
}
