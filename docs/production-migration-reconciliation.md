# Production Supabase migration reconciliation

Last verified: 2026-08-17
Production project: `ytyzwiqnobxehdqrnzhx`

## Rule

Production migration history predates consistent repository migration tracking. Do **not** replay an old repository migration solely because its timestamp is absent from `supabase_migrations.schema_migrations`. Verify the target objects/state first and use a new forward-only reconciliation migration when a change is actually required.

## Verified production history

The production migration table currently records the scrape-observability sequence and subsequent security hardening, including:

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

Some hardening names occur more than once because equivalent idempotent remediation was recorded during production reconciliation. The verified schema is authoritative; do not delete or rewrite those history rows.

## Known repository/history mismatch

Older repository migrations such as the March-June list, household, agent-event, saved-list, refresh-cache, performance-index and list-item-check migrations are not consistently represented by matching production history timestamps. Their resulting production objects were observed during the security audit. Treat these as historical drift, not pending migrations.

Several scrape migrations also have repository timestamps that differ from the production-generated migration versions while representing the same logical change.

## Current security boundary

Production was directly verified after hardening:

- RLS is enabled on browser-exposed legacy tables.
- `anon` and `authenticated` have no direct write/delete/truncate access to protected catalogue/private tables.
- private subscriber/list and scrape-operational tables are service-role only.
- scrape and Tesco egress RPC execution is restricted to `service_role`.
- `public.latest_prices` uses `security_invoker=true`, excludes Lidl until a live refresh pipeline exists, and excludes invalid SuperValu search-result URLs.

Future database work should be forward-only, idempotent where practical, committed to `supabase/migrations/`, and verified against production before application.
