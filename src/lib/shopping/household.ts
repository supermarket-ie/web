import type { HouseholdContext } from './contracts';
import { normaliseHouseholdMemory, productMemoryKey } from '../household-memory';

export type RawHouseholdContext = {
  subscriber_id: string;
  family_size?: string | number | null;
  weekly_budget?: number | null;
  dietary?: string[] | null;
  dislikes?: string | null;
  preferred_stores?: string[] | null;
  memory?: Record<string, unknown> | null;
};

export function normaliseHouseholdContext(input: RawHouseholdContext): HouseholdContext {
  return {
    subscriber_id: input.subscriber_id,
    family_size: input.family_size ?? null,
    weekly_budget: input.weekly_budget ?? null,
    dietary: input.dietary ?? [],
    dislikes: input.dislikes ?? null,
    preferred_stores: input.preferred_stores ?? [],
    memory: input.memory ?? {},
  };
}

export function householdHasStoppedBuying(
  canonicalName: string,
  context: HouseholdContext,
): boolean {
  const memory = context.memory ?? {};
  const governed = normaliseHouseholdMemory(memory);
  const explicitStopped = Array.isArray(governed.explicit.stopped_products?.value)
    ? governed.explicit.stopped_products.value
    : [];
  const candidates = [
    explicitStopped,
    memory.stoppedItems,
    memory.stopped_items,
    memory.droppedItems,
    memory.dropped_items,
  ].flatMap(value => (Array.isArray(value) ? value : []));

  return candidates.some(value => productMemoryKey(String(value)) === productMemoryKey(canonicalName));
}

export function householdDislikesProduct(
  canonicalName: string,
  dislikes?: string | null,
): boolean {
  if (!dislikes) return false;
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const name = normalise(canonicalName);
  return dislikes
    .split(/[,;\n]/)
    .map(normalise)
    .filter(Boolean)
    .some(value => name.includes(value) || value.includes(name));
}
