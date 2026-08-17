-- Add covering indexes for production foreign keys identified by the Supabase
-- performance advisor. These are additive and preserve existing application
-- behaviour while avoiding full child-table scans during parent updates/deletes.

create index if not exists conversations_list_id_idx
  on public.conversations (list_id);

create index if not exists list_item_checks_list_id_idx
  on public.list_item_checks (list_id);

create index if not exists list_items_list_id_idx
  on public.list_items (list_id);

create index if not exists price_alerts_product_id_idx
  on public.price_alerts (product_id);

create index if not exists saved_lists_conversation_id_idx
  on public.saved_lists (conversation_id);

create index if not exists scrape_failures_store_product_id_idx
  on public.scrape_failures (store_product_id);

create index if not exists scrape_fetch_attempts_store_product_id_idx
  on public.scrape_fetch_attempts (store_product_id);

create index if not exists scrape_product_receipts_store_product_id_idx
  on public.scrape_product_receipts (store_product_id);
