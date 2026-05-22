# Phase 3c: Weekly Proactive Agent — Spec

## Overview

Transform the grocery agent from reactive (user visits → gets list) to proactive (agent reaches out weekly with personalised insights). This is the feature that makes the "agent" promise real.

## Current State

- **35 active subscribers** (email captured via signup gate)
- **0 households** (`households` table doesn't exist yet — code references it but never created)
- **0 list_items** (save-items API exists but no users have triggered it post-gate)
- **0 saved_lists / conversations / price_alerts** (dashboard features built but no adoption yet)
- **Weekly digest cron exists** (`/api/cron/weekly-digest`) — sends same generic top-5 deals to everyone
- **Check-alerts cron exists** (`/api/cron/check-alerts`) — price alert emails, but no alerts set
- **Resend configured** (API key live, domain: `mail.supermarket.ie`)
- **Vercel cron configured** (weekly-digest runs Monday 07:00 UTC)
- **`queryUserHistory` / `queryPriceChanges`** tools already built in planner-agent.ts

## The Problem

1. User completes planner → gets list → bounces → never returns
2. No reason to come back without a prompt
3. Homepage promises "works for you 24/7" and "gets smarter every week" — currently fiction

## Solution: Personalised Weekly Agent Email

Every Monday morning, each subscriber gets an email **from their agent** — not a generic newsletter. The email is short, personal, and useful.

### Email Structure

```
Subject: "Your agent found 3 savings this week 🛒"

Hey [name/there],

I checked this week's prices across Tesco, Dunnes & SuperValu.
Here's what I spotted for you:

📉 PRICE DROPS ON YOUR ITEMS
• Chicken Fillets — €6.49 at Dunnes (was €8.49 last time you bought)
• Brennans Bread — €1.69 at Tesco (€0.25 cheaper than Dunnes this week)

🏷️ DEALS YOU'D LIKE
• 2-for-1 on Kerrygold Butter at SuperValu
• Pringles €2.00 at Tesco (usually €3.50)

[Build my list this week →]  (CTA button → dashboard with pre-filled context)

Or just reply to this email and tell me what meals you're planning.
I'll build your full list.

—
Your grocery agent at supermarket.ie
```

### Personalisation Tiers

**Tier 1: New subscriber (no history)** — ~35 users currently
- Generic top deals (what we do now, but better written as "from your agent")
- Invite them to build their first list ("Tell me about your household and I'll personalise next week's email")

**Tier 2: Has built a list before** (list_items populated)
- Price changes on their specific items
- Deals in their usual categories
- "Same again?" one-click link

**Tier 3: Has household profile** (households table populated)
- Fully personalised: budget-aware, dietary-aware deal selection
- Meal suggestions based on what's cheap this week + their preferences
- Store-split recommendation

## Technical Implementation

### 1. Create `households` table in Supabase

```sql
CREATE TABLE households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE CASCADE,
  adults INTEGER DEFAULT 2,
  children INTEGER DEFAULT 0,
  child_ages TEXT[], -- ['toddler', 'young', 'older', 'teen']
  weekly_budget NUMERIC,
  preferred_stores TEXT[] DEFAULT ARRAY['tesco', 'dunnes', 'supervalu'],
  dietary TEXT[] DEFAULT ARRAY[]::TEXT[],
  dislikes TEXT,
  meals JSONB DEFAULT '{"breakfast":true,"lunch":true,"dinner":true,"snacks":false}',
  batch_cooking BOOLEAN DEFAULT false,
  skip_days TEXT,
  extra_context TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subscriber_id)
);
```

### 2. Persist household profile via planner agent tool

Add a `save_household_profile` tool to the planner agent's toolset. The AI agent calls it naturally during conversation when it has enough info (budget, dietary needs, household size). This avoids fragile "completion detection" in an AI-driven conversation — the agent decides when it knows enough.

Tool schema:
```typescript
save_household_profile: {
  description: "Save the user's household profile for future personalisation",
  parameters: z.object({
    adults: z.number().optional(),
    children: z.number().optional(),
    child_ages: z.array(z.string()).optional(),
    weekly_budget: z.number().optional(),
    preferred_stores: z.array(z.string()).optional(),
    dietary: z.array(z.string()).optional(),
    dislikes: z.string().optional(),
    batch_cooking: z.boolean().optional(),
    skip_days: z.string().optional(),
    extra_context: z.string().optional(),
  })
}
```

The agent is instructed to call this tool once it's gathered household details, before or during list generation.

### 3. Persist list items on list generation

Auto-save list items on signup success — the user demonstrated intent by signing up *for this list*. Don't require an additional click. For signed-in returning users, auto-save on every list generation.

Ensure an index exists: `CREATE INDEX idx_list_items_subscriber ON list_items(subscriber_id);`

### 4. Rewrite `/api/cron/weekly-digest`

New logic:
1. Fetch all active subscribers
2. For each subscriber:
   a. Check `list_items` — do they have purchase history?
   b. Check `households` — do they have a profile?
   c. Based on tier, generate personalised content:
      - **Tier 1**: Top 5 deals this week + "build your first list" CTA
      - **Tier 2**: Run `queryPriceChanges(subscriberId)` → price drops on their items + relevant category deals
      - **Tier 3**: AI-generated summary (call Claude with household context + deals) — or templated if we want to keep costs down
   d. Generate magic link JWT (7-day expiry) → link to `/dashboard`
   e. Send via Resend

3. Rate limit: max 50 emails/batch, 200ms delay between sends
4. **Per-subscriber error isolation**: try/catch each subscriber individually — one failure must not kill the batch. Log failures to Vercel logs (v1) for debugging.

### 5. "Same again" one-click flow

The Tier 2 email includes a "Same again?" CTA linking to:
`/dashboard?intent=same-again&list_id=xxx&source=weekly-email`

Dashboard logic:
- Detects `intent=same-again`
- Loads the subscriber's most recent saved list
- Auto-starts planner with: "Here's your list from last time. Want the same this week? I'll check for price changes and flag any good deals."
- User can confirm or modify

### 6. Unsubscribe handling

Every email includes a one-click unsubscribe link (Resend handles `List-Unsubscribe` header automatically). The cron must:
- Skip subscribers where `unsubscribed_at IS NOT NULL` (or use Resend's suppression list API)
- Respect Resend bounce/complaint suppressions

### 7. Tracking & Metrics (v1)

Use Resend's built-in analytics dashboard for open rate / CTR tracking. No custom tracking infrastructure in v1. Revisit when subscriber count > 500.

### 8. Send time

**Sunday 09:00 Dublin time** (08:00 UTC in summer, 09:00 UTC in winter). Most Irish grocery shopping happens Saturday/Sunday — a Sunday morning send catches people while they're planning their shop.

### ~~5. "Reply to this email" flow~~ (REMOVED — out of scope for Phase 3c)

Deferred to Phase 3c+. Inbound webhooks, address matching, and email-to-agent routing is a separate feature with its own complexity.

### 6. One-click "Build my list" link

The CTA in the email generates a JWT linking to:
`/dashboard?intent=plan-week&source=weekly-email`

The dashboard detects this intent and auto-starts the planner conversation with context:
"Based on your agent's email, here are this week's best deals for you. Want me to build your list around them?"

## File Changes

| File | Change |
|------|--------|
| `supabase/migrations/xxx_create_households.sql` | New migration |
| `src/app/api/cron/weekly-digest/route.ts` | Complete rewrite — personalised per subscriber |
| `src/lib/planner-agent.ts` | Add `save_household_profile` tool + export `queryPriceChanges`/`queryUserHistory` for cron use |
| `src/app/api/list/save-items/route.ts` | Auto-trigger on signup success + every list gen for signed-in users |
| `src/lib/weekly-email-templates.ts` | New — HTML templates for 3 tiers |
| `vercel.json` | Update cron schedule to Sunday 08:00 UTC (09:00 Dublin summer) |

## Success Metrics

- **Open rate > 40%** (personalised emails from "your agent" should beat generic newsletter benchmarks)
- **Click-through > 15%** (users clicking "Build my list")
- **Return rate > 30%** (subscribers who come back at least once in 4 weeks)
- **List generation from email > 10%** (users who actually build a list from the email CTA)

## Estimates

- **Day 1**: Create households table, add `save_household_profile` tool to planner agent, auto-save list_items on signup + list gen
- **Day 2**: Rewrite weekly-digest (personalised tiers), email templates, "same again" link, test end-to-end

## Dependencies

- Resend API key (✅ configured)
- Resend sending domain (✅ `mail.supermarket.ie`)
- `CRON_SECRET` in Vercel env (check if set)
- `MAGIC_LINK_SECRET` in Vercel env (✅ used by existing digest)

## Open Questions — RESOLVED

1. **AI-generated vs templated?** → YES, use AI (Haiku) for Tier 3. Cost is negligible (~€0.18/week at 35 subs). The personalisation is the product.

2. **Send time** → **Sunday 09:00 Dublin** (catches people planning their weekly shop)

3. **Frequency** → Start weekly (Sunday). Mid-week top-up considered for Phase 3d.

---

_Status: SPEC FINALISED — Building now_
_Priority: P0 — This is the core differentiator_
_Estimate: 2 days_
_Last updated: 2026-05-22_
