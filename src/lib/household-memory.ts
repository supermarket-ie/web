export const MEMORY_SCHEMA_VERSION = 'household_memory.v2' as const;
export const INFERENCE_RETENTION_DAYS = 180;

export type MemorySource = 'user' | 'shopping_history';

export type ExplicitMemoryFact = {
  value: unknown;
  source: 'user';
  created_at: string;
  updated_at: string;
};

export type InferredProductFact = {
  canonical_name: string;
  usual_quantity: number;
  likely_replenishment_days: number | null;
  confidence: number;
  supporting_observations: number;
  last_observed_at: string;
  source: 'shopping_history';
  updated_at: string;
};

export type HouseholdMemoryV2 = {
  schema_version: typeof MEMORY_SCHEMA_VERSION;
  revision: number;
  explicit: Record<string, ExplicitMemoryFact>;
  inferred_products: Record<string, InferredProductFact>;
  tombstones: Record<string, { deleted_at: string; revision: number }>;
  updated_at: string;
};

export type InferredProductInput = Omit<InferredProductFact, 'source' | 'updated_at'>;

const SENSITIVE = /(?:password|passcode|pps(?:n| number)?|credit card|card number|cvv|iban|@|\b\+?\d[\d\s()-]{7,}\d\b)/i;
const ALLOWED_EXPLICIT_KEYS = new Set([
  'household_composition', 'dietary', 'weekly_budget', 'preferred_stores',
  'dislikes', 'stopped_products',
]);

export function productMemoryKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function emptyHouseholdMemory(now = new Date().toISOString()): HouseholdMemoryV2 {
  return { schema_version: MEMORY_SCHEMA_VERSION, revision: 0, explicit: {}, inferred_products: {}, tombstones: {}, updated_at: now };
}

export function normaliseHouseholdMemory(raw: unknown, now = new Date().toISOString()): HouseholdMemoryV2 {
  if (!raw || typeof raw !== 'object') return emptyHouseholdMemory(now);
  const value = raw as Partial<HouseholdMemoryV2> & { droppedItems?: unknown };
  if (value.schema_version === MEMORY_SCHEMA_VERSION) {
    return {
      schema_version: MEMORY_SCHEMA_VERSION,
      revision: Number.isInteger(value.revision) ? Number(value.revision) : 0,
      explicit: value.explicit && typeof value.explicit === 'object' ? value.explicit : {},
      inferred_products: value.inferred_products && typeof value.inferred_products === 'object' ? value.inferred_products : {},
      tombstones: value.tombstones && typeof value.tombstones === 'object' ? value.tombstones : {},
      updated_at: typeof value.updated_at === 'string' ? value.updated_at : now,
    };
  }

  // Legacy stopped/dropped items are user-protective, so retain them as explicit facts.
  const stopped = Array.isArray(value.droppedItems) ? value.droppedItems.map(String) : [];
  const memory = emptyHouseholdMemory(now);
  if (stopped.length) memory.explicit.stopped_products = { value: stopped, source: 'user', created_at: now, updated_at: now };
  return memory;
}

function safeExplicitValue(value: unknown): boolean {
  return !SENSITIVE.test(JSON.stringify(value));
}

export function setExplicitMemoryFact(memory: HouseholdMemoryV2, key: string, value: unknown, now: string): HouseholdMemoryV2 {
  if (!ALLOWED_EXPLICIT_KEYS.has(key)) throw new Error(`Unsupported durable memory key: ${key}`);
  if (!safeExplicitValue(value)) throw new Error('Sensitive information cannot be stored in household memory');
  const revision = memory.revision + 1;
  return {
    ...memory,
    revision,
    explicit: { ...memory.explicit, [key]: { value, source: 'user', created_at: memory.explicit[key]?.created_at ?? now, updated_at: now } },
    tombstones: Object.fromEntries(Object.entries(memory.tombstones).filter(([factKey]) => factKey !== key)),
    updated_at: now,
  };
}

export function forgetMemoryKey(memory: HouseholdMemoryV2, key: string, now: string): HouseholdMemoryV2 {
  const revision = memory.revision + 1;
  const explicit = { ...memory.explicit };
  const inferred = { ...memory.inferred_products };
  delete explicit[key];
  delete inferred[key.replace(/^product:/, '')];
  return { ...memory, revision, explicit, inferred_products: inferred, tombstones: { ...memory.tombstones, [key]: { deleted_at: now, revision } }, updated_at: now };
}

export function mergeInferredProducts(
  memory: HouseholdMemoryV2,
  facts: InferredProductInput[],
  inferenceStartedAt: string,
  now: string,
): HouseholdMemoryV2 {
  const inferred = { ...memory.inferred_products };
  const stopped = new Set(Array.isArray(memory.explicit.stopped_products?.value)
    ? (memory.explicit.stopped_products.value as unknown[]).map(value => productMemoryKey(String(value)))
    : []);
  for (const fact of facts) {
    const key = productMemoryKey(fact.canonical_name);
    const tombstone = memory.tombstones[`product:${key}`];
    if (!key || stopped.has(key) || (tombstone && tombstone.deleted_at >= inferenceStartedAt)) continue;
    inferred[key] = { ...fact, canonical_name: fact.canonical_name, confidence: Math.max(0, Math.min(1, fact.confidence)), source: 'shopping_history', updated_at: now };
  }
  const cutoff = Date.parse(now) - INFERENCE_RETENTION_DAYS * 86_400_000;
  for (const [key, fact] of Object.entries(inferred)) {
    if (Date.parse(fact.last_observed_at) < cutoff) delete inferred[key];
  }
  return { ...memory, revision: memory.revision + 1, inferred_products: inferred, updated_at: now };
}

export function inspectHouseholdMemory(memory: HouseholdMemoryV2) {
  return { schema_version: memory.schema_version, revision: memory.revision, explicit: memory.explicit, inferred_products: memory.inferred_products, updated_at: memory.updated_at };
}
