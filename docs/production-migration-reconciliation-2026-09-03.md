# Production Supabase migration reconciliation — 2026-09-03

Production project: `ytyzwiqnobxehdqrnzhx`

## Reconciliation rule

Production migration history predates consistent repository timestamp tracking. Historical rows must not be rewritten or replayed merely because a repository filename uses a different timestamp. The verified production schema is authoritative for historical drift; all future database work is forward-only from the shared checkpoint below.

## Shared checkpoint

Production successfully applied:

- `20260903224007 production_schema_reconciliation_checkpoint`

The repository contains the same migration version and SQL. The checkpoint asserts that the following current production objects exist:

- `trusted_retailer_offers`
- `latest_prices`
- `agent_tasks`
- `product_search_embeddings`
- `product_embedding_jobs`
- `ops_manual_dispatches`
- `store_product_alternative_candidates`
- `pepesto_tesco_sessions`

It also fails if RLS is disabled on the protected operational/agent tables checked by the migration.

## Verified production migration history before the checkpoint

Production currently records the following historical migrations. Their versions are retained exactly as recorded by Supabase:

- `20260815092602 add_scrape_observability`
- `20260815115646 add_tesco_queue_idempotency`
- `20260816094338 add_tesco_egress_pool`
- `20260816114237 add_generic_scrape_finalizer`
- `20260816114605 add_store_refresh_selector`
- `20260816114615 add_refresh_selection_index`
- `20260817171450 harden_public_table_access`
- `20260817171507 exclude_invalid_supervalu_search_urls`
- `20260817171841 fix_update_updated_at_search_path`
- `20260817171842 harden_public_table_access`
- `20260817171846 filter_active_stores_from_latest_prices`
- `20260817171853 exclude_invalid_supervalu_search_urls`
- `20260817172034 fix_update_updated_at_search_path`
- `20260817174555 add_missing_foreign_key_indexes`
- `20260818104153 create_agent_tasks`
- `20260818123545 add_household_agent_relevance`
- `20260818162528 add_shop_decision_trace`
- `20260821104440 add_pepesto_tesco_sessions`
- `20260821122233 add_pepesto_tesco_promotion_finalizer`
- `20260822085344 add_price_observation_source`
- `20260822160651 add_dunnes_discovery_target_selector`
- `20260822172510 add_store_product_alternative_candidates`
- `20260822184635 add_dunnes_alternative_pack_ratio`
- `20260822215622 dunnes_discovery_queue_finalizer`
- `20260822220357 guard_inactive_dunnes_discovery_runs`
- `20260823113847 trusted_retailer_offers`

## Known historical filename drift

Some repository migrations represent the same logical changes under different timestamps. Older March–June objects also predate consistent migration-history tracking. These are historical aliases, not pending production migrations.

Do not run an old repository migration against production solely to make the timestamp lists look identical. If a historical schema discrepancy is found, fix it with a new forward-only migration after `20260903224007`.

## Current security boundary

At reconciliation time, RLS was verified enabled on the newer protected agent, semantic-search, operations, Pepesto-session and Dunnes-alternative tables. The checkpoint migration preserves a fail-fast assertion for those objects.

## Going forward

1. Every production DDL change must first exist under `supabase/migrations/`.
2. Apply it through the Supabase migration mechanism so the repository version and production history match exactly.
3. Never mutate historical migration rows to hide drift.
4. Use a new forward-only migration for any future correction.
