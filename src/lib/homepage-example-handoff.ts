export const HOMEPAGE_EXAMPLE_ID = 'household-essentials-v1';
export const EXAMPLE_PREFILL_EVENT = 'sm:example-shop-prefill';

export function examplePrefillAction(input: string, busy: boolean, gated: boolean) {
  if (busy || gated) return 'unavailable';
  return input.trim() ? 'confirm' : 'replace';
}
