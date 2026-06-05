# Household Memory System Implementation

The household memory system makes the AI planner genuinely smarter over time by accumulating what it learns about each user.

## What was built

### 1. Database Schema (Migration)
- **File**: `supabase/migrations/20260603000000_add_household_memory.sql`
- **Change**: Added `memory JSONB` column to `households` table
- **Structure**: Stores memory object with user shopping patterns and preferences

### 2. Memory Data Structure

```typescript
interface HouseholdMemory {
  totalShops: number;           // Number of completed grocery lists
  avgWeeklySpend: number;       // Average weekly spending
  usualStore: string;           // Most frequently used store
  frequentItems: string[];      // Items bought 3+ times
  droppedItems: string[];       // Items user removed from lists
  notedPreferences: string[];   // Observed preferences
  lastShopSummary: string;      // Summary of last shopping trip
  updatedAt: string;            // Last update timestamp
}
```

### 3. Memory Computation Function
- **Function**: `updateHouseholdMemory(subscriberId: string)`
- **Location**: `src/lib/planner-agent.ts`
- **What it does**:
  1. Fetches user's `list_items` (shopping history)
  2. Fetches user's `saved_lists` (for weekly spend calculation)
  3. Fetches user's `removed_items` (items they don't want)
  4. Computes memory metrics:
     - `frequentItems`: Items bought 3+ times
     - `usualStore`: Most common store from shopping history
     - `avgWeeklySpend`: Average from `saved_lists.store_totals`
     - `droppedItems`: From `subscribers.removed_items`
     - `lastShopSummary`: Summary of most recent list
  5. Saves to `households.memory`

### 4. AI Integration
- **Function**: `buildIntakePrompt()` enhanced with `householdMemory` parameter
- **Location**: `src/lib/planner-agent.ts`
- **What it adds**: Memory context block prepended to system prompt:

```
## Your Memory of This Household
- 7 shops completed. Average weekly spend: €94.50.
- They usually shop at tesco.
- Items they always buy: Brennans White Bread, Avonmore Milk 2L.
- Items they have removed from past lists (do NOT suggest these): Tuna Chunks in Brine.
- Notes: prefers Aldi for dairy; buys pasta in bulk.
- Last shop: €87.40 · 34 items · Thu 29 May.
Start from this context. Don't mention you have memory — just use it naturally.
```

### 5. Agent Factory Updates
- **Function**: `createPlannerAgent()` made async
- **Location**: `src/lib/planner-agent.ts`
- **What it does**: Fetches household memory from database and passes to `buildIntakePrompt()`

### 6. API Route Integration
- **File**: `src/app/api/plan/route.ts`
- **What was added**:
  1. Import `updateHouseholdMemory`
  2. Handle async `createPlannerAgent()` calls
  3. Added `onFinish` callback that:
     - Detects when a grocery list is generated (looks for "🛒 Your weekly grocery list")
     - Calls `updateHouseholdMemory()` in background (non-blocking)
     - Applied to both intake mode and conversation mode

## How it works

1. **User shops**: Creates lists using the AI planner
2. **Memory update**: After list generation, `updateHouseholdMemory()` runs in background
3. **Memory storage**: Computed memory saved to `households.memory`
4. **Next session**: `createPlannerAgent()` fetches memory and includes in AI context
5. **Personalized planning**: AI uses memory to make better suggestions

## Benefits

- **Remembers preferences**: Won't suggest items user has removed
- **Learns patterns**: Suggests frequent purchases first
- **Store optimization**: Knows user's preferred stores
- **Budget awareness**: Understands typical spending patterns
- **Context continuity**: Remembers what happened last time

## Performance considerations

- Memory update is non-blocking (runs in background after response)
- Memory is only fetched for signed-in users in intake mode
- Database queries are optimized with proper indexes
- Memory object is lightweight JSON (no complex relationships)

## Testing

Run the test script to see the system in action:
```bash
node test-memory-system.js
```

This demonstrates the memory structure and how it integrates with the AI prompts.

## Future enhancements

- **notedPreferences**: Could be populated by analyzing user feedback patterns
- **Seasonal patterns**: Could track seasonal buying patterns
- **Category preferences**: Remember preferred brands per category
- **Shopping day patterns**: Track when users typically shop