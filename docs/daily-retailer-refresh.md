# Daily SuperValu and Dunnes refresh

## Production finding — 7 November 2026

Both retailers last ran on 5 November. The AWS schedules are configured for
Monday/Thursday, and their runner requests only 1,000 products. SQL chooses
missing coverage and shopper demand ahead of observation age. As a result,
repeated successful runs do not imply that every displayed price was checked.

The current eligible resolved inventories are 1,851 SuperValu and 1,053 Dunnes
products. Production displays 1,083 and 908 trusted fresh prices respectively.
Of the 360 SuperValu prices still checked on 2 November, 356 fall outside the
current 1,000-product selection. Dunnes has 75 prices checked on 2 November.
These measurements are a dated baseline, not a claim of new collections.

## Change

- Use the existing AWS EventBridge schedules every day: Dunnes 05:10 UTC,
  SuperValu 05:20 UTC and scrape-watchdog 07:45 UTC. These are 05:10, 05:20 and
  07:45 Irish winter time; Irish summer time is one hour later.
- Request up to 2,500 products per retailer, covering both current eligible
  inventories. The existing SQL resolution/URL/SKU rules still determine
  eligibility. This bound is not an instruction to collect an unresolved SKU.
- Page the selector and failure cohorts in 500-row requests so the Data API
  cannot silently truncate the inventory to its default result limit. Select
  all pages before enqueueing any work; reject a page error or duplicate ID.
  SQL chooses the bounded priority cohort; a unique outer product-ID order
  makes page offsets deterministic.
- Keep the existing small batches, SQS consumer concurrency, receipt
  idempotency, retries, matching thresholds and trusted-price provenance.
  SQS already clamps message delivery delays to its 900-second maximum.
- Make missed-run detection daily, with the correct per-retailer slot and a
  two-hour completion margin. Before today's margin expires, yesterday remains
  accountable. Intentionally unscheduled retailers do not get daily-run alerts.
- Independently count displayed `latest_prices` observations older than 30
  hours. Report a high-severity `daily_refresh_overdue` issue even when the
  last run succeeded. Use exact HEAD counts, not a capped row response.

The operational objective is a check every day for every eligible displayed
price. The 30-hour warning allows a daily cycle plus completion margin. A
failed identity/availability check never advances the old observation time.
Existing seven-day trusted-price expiry and truthful customer check dates stay
in place. Missing or ambiguous retailer products still require mapping repair.
Tesco's separate supervised collector and request allowance are unchanged.

## Activation — existing authorised AWS workspace

Merging the change does not deploy it. This change requires both the updated
scheduled-worker image and the Terraform schedule expressions. Merely changing
cron frequency would keep the deployed 1,000-product selection bug.

1. Build the merged main commit using the existing **Build & push deploy image
   to ECR** workflow, `image_mode=prod`. Retain the exact resulting SHA tag.
2. In the existing production Terraform workspace, retain its actual tfvars,
   backend, account 611622961299 and region eu-west-1. Record the current web
   and worker tags. Plan with `image_tag` pinned to that current web tag and
   `image_tag_worker` set to the new image. Never reconstruct production tfvars
   from defaults. Review the saved plan: only the worker task definitions,
   consumer service reference, schedules' task-definition references and the
   three daily cron expressions should change. Stop on unrelated changes.
3. Apply that reviewed saved plan. Verify the consumer becomes stable and the
   enabled Dunnes/SuperValu/watchdog schedules reference the updated scheduled
   task definition and show the intended daily expressions. The protected
   **web-image-only** release workflow deliberately rejects worker/schedule
   changes; do not widen its policy to force this release through.
4. If today's daily slot has passed, inspect current runs, SQS and DLQs, then
   run one catch-up per retailer through the existing `smie-prod-scheduled`
   task using the corresponding `CRON_JOB`. Do not overlap an active run.
5. Reconcile terminal runs, receipts and `latest_prices` observation ages.
   Expected current targets are 1,053 and 1,851, not two 1,000-product runs.
   Report successful checks separately from rejected/unavailable products and
   actual displayed prices still overdue. Verify the watchdog's
   `priceFreshness`, `channelConfigured` and delivery result; missing recipient
   configuration must never be described as delivered alerting.

Rollback uses the recorded previous worker tag and previous three cron
expressions, with a reviewed Terraform plan. Never rewrite observations or
clear pending receipts as part of rollback.

## Release state

Implementation and tests are prepared in the repository. This session has no
authenticated AWS deployment identity; the AWS console also returned Site
Unavailable. No live schedule, ECS task definition, retailer request or price
observation was changed. Production activation and catch-up remain outstanding.
