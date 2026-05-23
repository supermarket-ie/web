# Smart Same Again — Spec

## Problem

Users plan groceries once and never return. The second visit requires explaining everything again from scratch. There's no reason to come back next week.

## Solution: "Same Again" with Smart Diff

When a returning user opens the app, they see their last list **already re-priced** against this week's data — with clear callouts on what changed. One tap to accept, or chat to modify.

## User Flow

### Returning User (has saved list + household profile)

1. User opens supermarket.ie → detected as returning (has session token)
2. Instead of blank chat, they see a **"This week's update"** card:
   - "Based on your last shop (€87.50)..."
   - 🟢 3 items cheaper this week (−€4.20)
   - 🔴 2 items more expensive (+€1.80)
   - 🟡 1 item now on promotion at a different store
   - **Net: €85.10 this week** (you save €2.40)
3. Two CTAs:
   - **"Same again →"** — generates full updated list with today's best prices
   - **"Let me change things"** — opens chat with context pre-loaded
4. "Same again" triggers the agent with a pre-built prompt:
   - Agent calls `get_last_list` → `reprice_list` → outputs updated list
   - Swaps in promotions automatically
   - Flags substitutions clearly ("Dunnes chicken thighs were €5.99, now €4.49 at Tesco this week")

### New User (no history)

Unchanged — current intake flow.

---

## Technical Implementation

### 1. New API Route: `/api/plan/refresh` (GET)

Returns the "smart diff" summary for the dashboard/homepage card.

```typescript
// GET /api/plan/refresh?token=xxx
// Returns: { lastList, priceDiff, netChange, promotionSwaps, totalThisWeek }
```

Logic:
1. Load last `saved_lists` entry for subscriber
2. Load `list_items` for that list
3. For each item, query current best price (reuse `queryProduct`)
4. For each item, check if there's a promotion at any store
5. Return structured diff

### 2. New Agent Tool: `get_last_list`

```typescript
get_last_list: tool({
  description: 'Returns the user\'s most recent saved grocery list with all items, stores, and prices paid.',
  inputSchema: z.object({}),
  execute: async () => {
    if (!subscriberId) return { items: [], found: false };
    const { data } = await supabaseAdmin
      .from('saved_lists')
      .select('items, name, generated_at, store_totals')
      .eq('subscriber_id', subscriberId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    return data ?? { items: [], found: false };
  },
})
```

### 3. New Agent Tool: `reprice_list`

```typescript
reprice_list: tool({
  description: 'Takes a list of product names and returns current best prices + any promotions. Use after get_last_list to build an updated "same again" list.',
  inputSchema: z.object({
    items: z.array(z.string()).describe('Array of canonical_name values from the previous list'),
  }),
  execute: async ({ items }) => {
    const results = [];
    for (const name of items) {
      const prices = await queryProduct(name);
      const promos = await queryProductPromotions(name); // new helper
      results.push({ canonical_name: name, prices, promotions: promos });
    }
    return results;
  },
})
```

### 4. Updated System Prompt (returning user mode)

Add to `buildIntakePrompt` when `returningUser && hasLastList`:

```
## Returning User — "Same Again" Mode

The user wants their usual list updated with this week's prices. Their last list is available via get_last_list.

Your job:
1. Call get_last_list to get their previous items
2. Call reprice_list with those item names
3. Present the updated list with clear callouts:
   - ✅ Items that got cheaper (show saving)
   - ⚠️ Items that got more expensive (show increase)
   - 🏷️ Items with new promotions at a different store (suggest swap)
   - ❌ Items no longer available (suggest alternative)
4. Show the new total vs last time
5. Ask if they want any changes

Keep it brief. They know what they want — just show what's different.
```

### 5. Frontend: Smart Dashboard Card

In `Dashboard.tsx`, replace the static "Plan this week" CTA with a dynamic card:

```tsx
// If returning user with saved list:
<SmartRefreshCard
  lastTotal={85.50}
  thisWeekTotal={83.10}
  cheaper={3}
  dearer={1}
  promoSwaps={2}
  onSameAgain={() => startChat({ mode: 'same-again' })}
  onModify={() => startChat({ mode: 'modify' })}
/>
```

### 6. Frontend: Homepage Detection

In `HomePlanner.tsx`, on mount:
1. Check if user has a session token
2. If yes, fetch `/api/plan/refresh?token=xxx`
3. If they have a recent list (< 14 days), show the "same again" card instead of the blank chat
4. If no recent list, show normal intake flow

---

## Data Flow

```
User opens app
  → loadSession() → has token?
    → YES: fetch /api/plan/refresh
      → has recent list?
        → YES: show SmartRefreshCard
          → "Same again" → POST /api/plan { messages: [{role: 'user', content: 'Same again please'}], intakeMode: true, returningUser: true }
          → "Change things" → open chat with household context pre-loaded
        → NO: show normal intake
    → NO: show normal intake
```

---

## What Already Exists (reuse)

- `queryProduct()` — price lookup per canonical name ✅
- `queryPriceChanges()` — compares user's history vs current ✅
- `queryUserHistory()` — fetches list_items ✅
- `queryPromotions()` — all current promos ✅
- `saved_lists` table with items array ✅
- `households` table with preferences ✅
- `list_items` table tracking what they bought ✅
- Session token + JWT auth ✅
- `returningUser` flag already passed to agent ✅

## What's New to Build

1. `/api/plan/refresh` route (~60 lines)
2. `get_last_list` tool (add to `makePlannerTools`, ~15 lines)
3. `reprice_list` tool (add to `makePlannerTools`, ~25 lines)
4. `queryProductPromotions()` helper (~15 lines)
5. `SmartRefreshCard` component (~80 lines)
6. Homepage returning-user detection (~30 lines in HomePlanner)
7. Updated system prompt for "same again" mode (~20 lines)

**Total: ~250 lines of new code.** No new dependencies. No new tables. No new infra.

---

## Build Order

1. **Backend first:** Add tools + `/api/plan/refresh` route
2. **Test via curl:** Verify the refresh endpoint returns correct diffs
3. **Frontend:** SmartRefreshCard + homepage detection
4. **Polish:** Loading states, edge cases (empty list, all items unavailable)

---

## Success Metric

A returning user can get their updated grocery list in **< 30 seconds** (vs 3-5 minutes today). The agent remembers them and proactively shows value (savings found, promotions relevant to their list).

---

## Edge Cases

- **First-time user with household profile but no list:** Show normal intake, but pre-fill from profile
- **List older than 14 days:** Still offer "same again" but note "It's been a while — want to update anything?"
- **Items discontinued:** Agent suggests alternatives from same category
- **All items same price:** "Good news — your usual shop is stable at €X this week. Same again?"
