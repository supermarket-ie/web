# Event-driven household agent

Supermarket.ie now treats catalogue refreshes as durable household-agent events.

Flow:

1. A retailer worker finalises a product refresh in Supabase.
2. If the canonical product has an active price/promotion/availability watch, the worker publishes a compact `agent-product-changes` event to Vercel Queues.
3. The queue consumer re-reads the current canonical cross-store snapshot and evaluates only the matching active tasks.
4. Existing notification deduplication, cooldowns and Resend delivery remain the source of truth.
5. The daily `/api/cron/agent-tasks` run remains as a recovery/safety-net sweep.

The queue event is deliberately a hint, not authoritative price state. This prevents stale or redelivered scrape messages from making notification decisions directly.

Queue sends are best-effort after the catalogue transaction has committed: an agent-event failure must never roll back or fail a successful retailer refresh. The daily sweep recovers any missed event.
