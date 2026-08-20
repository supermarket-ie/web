// Snapshot of the existing Dunnes queue worker implementation.
// The public wrapper in dunnes-queue-worker.ts overrides only product selection so
// previous-price lookups can be chunked without changing matching/fetch behaviour.

export * from './dunnes-queue-worker-legacy';
