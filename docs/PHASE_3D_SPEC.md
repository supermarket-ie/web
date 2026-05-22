# Phase 3d: Price Watchdog

## Overview

A daily background cron that monitors each household's usual items against latest prices and sends a proactive email when significant savings are found. This transforms the agent from a weekly newsletter sender into a real-time advocate that catches price drops and store-switch opportunities as they happen.

## How It Differs From Existing Features

| Feature | check-alerts | weekly-digest | **price-watchdog (3d)** |
|---------|--------------|---------------|--------------------------|
| Trigger | User manually sets price target | Fixed schedule (Sunday) | Automatic — based on purchase history |
| Scope | Single product | All subscribers, all tiers | Tier 2+ only (have history) |
| When sent | When target hit | Every Sunday | Daily — only when savings > threshold |
| Content | "Product X hit €Y" | Newsletter/overview | "Your usual items are cheaper — save €Z" |

## Architecture

### Cron Endpoint
- **Path**: `/api/cron/price-watchdog`
- **Schedule**: `30 7 * * *` (07:30 UTC = 08:30 Dublin, before morning shopping)
- **Auth**: `CRON_SECRET` bearer token (same as other crons)
- **Max duration**: 300s

### Logic Flow

```
1. Fetch all subscribers with list_items OR household profile (Tier 2+)
2. For each subscriber:
   a. Get their usual items (from list_items — last 30 items by frequency)
   b. Get current best prices for those items across all stores
   c. Compare to what they last paid
   d. Calculate total potential savings
   e. Generate optimal store-split recommendation
   f. If total savings > €2.00 → send email
   g. Track last_watchdog_sent to avoid spamming (max 1 per 3 days)
3. Log stats and return summary
```

### Savings Threshold
- Minimum €2.00 total savings to trigger email
- At least 2 items cheaper (don't send for one item saving 5c)
- Maximum 1 watchdog email per subscriber per 3 days (cooldown)

### Store-Split Recommendation
The key value-add: "If you split your shop between Tesco and Aldi, you'd save €X.XX vs shopping at just [their usual store]."

Algorithm:
1. For each item in their usual basket, find cheapest current price across stores
2. Group by cheapest-store to get optimal split
3. Compare optimal split total vs their usual single-store total
4. Only recommend split if savings > €3 (not worth the hassle for small amounts)

## Database Changes

### New column on `subscribers`
```sql
ALTER TABLE subscribers ADD COLUMN last_watchdog_sent TIMESTAMPTZ;
```

No new tables needed — reuses `list_items` and `price_observations`.

## Email Template

Subject line options (AI picks based on content):
- "💰 Your agent found €X.XX savings on your usual items"
- "🔔 Price drops on X items from your last shop"

Content:
- Brief summary: "X items from your usual shop are cheaper right now"
- Top 3-5 savings listed (item, was price, now price, store)
- Store-split CTA: "Save €X.XX by splitting between [Store A] and [Store B]"
- "Plan this week" button → `/dashboard?source=watchdog`
- Unsubscribe link

## Files to Create/Modify

1. **NEW**: `src/app/api/cron/price-watchdog/route.ts` — main cron handler
2. **NEW**: `src/lib/watchdog-email-template.ts` — HTML email template
3. **MODIFY**: `vercel.json` — add cron entry
4. **MIGRATION**: `supabase/migrations/20260522100000_add_watchdog_column.sql`

## Non-Goals (Phase 3d)
- No in-app notifications (email only)
- No user-configurable thresholds (hardcoded €2 minimum)
- No mid-week top-up list generation (just savings alert)
- No AI-generated content (simple template — save Haiku credits for weekly digest)
