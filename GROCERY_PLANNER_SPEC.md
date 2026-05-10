# Grocery Planner v2 — Spec

## Overview

Redesign the HomePlanner from a chat-first "what are you cooking?" meal planner into a **guided grocery planner** that understands the whole household, then builds a complete weekly shop — not just meal ingredients.

The key shift: **grocery planner, not meal planner.** People think about their week, their household, their budget — not individual recipes.

## User Flow

### Step 1: Household Setup (always shown first-time, saved for returning users)

A clean card/form — NOT a chat interface. Fields:

- **Adults** — stepper (1-6, default 2)
- **Children** — stepper (0-6, default 0)
  - If children > 0, show age brackets: toddler (1-3), young (4-8), older (9-12), teen (13-17)
  - This matters: toddler vs teen = completely different food
- **Weekly budget** — optional, preset buttons: €50 / €70 / €100 / €120 / Custom
  - If set, AI actively trades down to stay under budget
- **Preferred stores** — multi-select chips: Tesco / Dunnes / SuperValu / "Don't mind"
  - Default: all stores (don't mind)

### Step 2: Dietary & Preferences

Show as expandable section or second card. Keep it quick — chips/toggles, not text fields.

- **Dietary requirements** — multi-select chips:
  - Vegetarian, Vegan, Gluten-free, Dairy-free, Halal, Low-carb, Diabetic-friendly, Nut-free
  - Can apply per person (e.g. "1 adult is vegetarian") — but keep simple: just ask "Anyone vegetarian/GF/etc?" and the AI handles it
- **Dislikes** — small text field, optional: "anything to avoid?" (e.g. "no fish", "kids hate mushrooms")

### Step 3: What to plan for

Toggles/checkboxes — visual, fast:

- **Meals to include:**
  - Breakfast (Mon-Sun toggle per day, or "every day" shortcut)
  - Lunch / Packed lunches (Mon-Sun or "weekdays only" shortcut)
  - Dinner (Mon-Sun or "every day" shortcut)
  - Snacks (yes/no)
- **Quick presets:**
  - "Full week — all meals" (selects everything)
  - "Dinners only" (just 7 dinners)
  - "Weekday lunches + dinners" (common pattern)
  - "School week" (Mon-Fri breakfasts + packed lunches + dinners)
- **Batch cooking?** — toggle. If yes, AI suggests cook-once-eat-twice meals.
- **Eating out / skip days** — "Any days eating out?" text or day picker

### Step 4: Anything else (free text)

A single text area: "Anything else we should know?"

Examples shown as placeholder/chips:
- "We have leftover chicken in the fridge"
- "Birthday party Saturday — need cake stuff"
- "Already have rice, pasta, and tinned tomatoes"
- "Doing a Costco run too — skip bulk items"
- "Include toilet roll, kitchen roll, bin bags"

This is where non-food household items can be requested too.

### Step 5: Generate

Big CTA button: **"Build my grocery list →"**

All the setup data is sent to `/api/plan` as structured context (not as a chat message). The AI gets a rich prompt with all the household info.

---

## Returning Users

If `loadSession()` returns a token:
- Pre-fill household setup from saved profile
- Show: "Welcome back! Same setup as last week?" with **"Same again" / "Update"** buttons
- "Same again" → skip straight to generation with last week's profile
- The AI calls `get_user_history` to personalise: "You usually get Brennans bread — added that in. Milk is 12% cheaper at Dunnes this week."

---

## AI Prompt Changes (`/api/plan/route.ts`)

The system prompt needs to shift from meal-focused to grocery-focused:

```
You are a grocery planning assistant for Irish households.

You receive structured household data:
- Adults: N, Children: N (ages)
- Budget: €X/week (or no budget)
- Dietary: [requirements]
- Dislikes: [items]
- Meals: [which meals/days]
- Batch cooking: yes/no
- Extra context: [free text]

Your job: produce a COMPLETE weekly grocery list, not just recipe ingredients.

Include:
- All ingredients for the meals they need
- Staples they'll need (bread, milk, butter, eggs — unless they said they have them)
- Snacks if requested (fruit, yoghurts, crisps, biscuits)
- Lunchbox items if packed lunches selected (sandwich bread, ham/cheese, fruit, yoghurt tubes, juice boxes)
- Household items ONLY if they specifically asked

Do NOT:
- List recipes or cooking instructions (unless asked)
- Include items they said they already have
- Exceed the budget — if budget set, actively trade down (own-brand > branded, seasonal veg > expensive imports)

Structure:
- Group by category
- Show cheapest store per item
- Flag this week's promotions
- Show store totals
- If budget set, show "€X under/over budget" at the end
```

---

## Component Architecture

### New Components

1. **`GroceryPlannerSetup.tsx`** — the guided setup form (Steps 1-4)
   - Self-contained, manages its own state
   - On submit, calls parent callback with structured `PlannerProfile` object
   - Saves profile to localStorage for returning users

2. **`GroceryPlannerResults.tsx`** — the results display
   - Receives streaming response from `/api/plan`
   - Shows the formatted grocery list (reuse `FormattedMessage` logic)
   - Share button, email capture, "Edit my plan" button to go back to setup

3. **`HomePlanner.tsx`** — orchestrator (refactored)
   - State machine: `setup` → `loading` → `results`
   - Returning users: `welcome-back` → `setup` or `loading`
   - Manages the API call and streaming

### Types

```typescript
interface PlannerProfile {
  adults: number;
  children: number;
  childAges?: ('toddler' | 'young' | 'older' | 'teen')[];
  weeklyBudget?: number;
  preferredStores: string[]; // ['tesco', 'dunnes', 'supervalu'] or ['all']
  dietary: string[]; // ['vegetarian', 'gluten-free', ...]
  dislikes?: string;
  meals: {
    breakfast: boolean | string[]; // true = every day, or ['mon', 'tue', ...]
    lunch: boolean | string[];
    dinner: boolean | string[];
    snacks: boolean;
  };
  batchCooking: boolean;
  skipDays?: string;
  extraContext?: string;
}
```

---

## UI Design Notes

- Use the existing design system (globals.css tokens)
- Steps should feel like a **single scrollable card**, not a multi-page wizard
  - All visible at once on desktop
  - Scrollable on mobile with sticky "Build my list" CTA at bottom
- Chip selectors for dietary/stores (tap to toggle, filled = selected)
- Stepper components for adults/children (- / number / +)
- Budget buttons as radio-style chips
- Meal grid: simple 7-column (Mon-Sun) × 3-row (B/L/D) toggle grid with preset shortcuts above
- Keep the existing green/fresh design language
- The setup should feel fast — aim for <30 seconds to complete
- Progressive disclosure: household size → dietary only if needed → meals → go

---

## API Changes

`/api/plan/route.ts`:
- Accept new `profile: PlannerProfile` in request body (alongside existing `messages` for backward compat)
- If `profile` present, build the structured prompt from it
- If `messages` present (legacy), keep existing behavior
- The AI still uses the same tools (get_promotions, get_categories, etc.)
- New system prompt focuses on grocery planning, not meal planning

---

## What NOT to change

- Keep the existing streaming response format
- Keep `FormattedMessage` rendering (store totals, categories, etc.)
- Keep email capture flow
- Keep the share button
- Keep LiveDealChip on homepage
- Keep SiteHeader/SiteFooter
- Keep all existing API routes
- Homepage layout (hero left + planner right) stays the same

---

## Files to modify

1. `src/components/HomePlanner.tsx` — major refactor into setup → results flow
2. `src/app/api/plan/route.ts` — accept PlannerProfile, new system prompt
3. `src/lib/session.ts` — extend SessionData to save PlannerProfile

## Files to create

1. `src/components/GroceryPlannerSetup.tsx` — the setup form
2. `src/components/GroceryPlannerResults.tsx` — results display (extracted from current HomePlanner)

---

## Success Criteria

- First-time user can set up household and get a grocery list in <60 seconds
- Returning user can regenerate with 1 tap ("Same again")
- List includes non-meal items (staples, lunchbox, snacks) appropriate to household
- Budget constraint works — AI stays under if set
- Mobile experience is smooth (sticky CTA, no horizontal scroll)
- All existing features still work (email capture, share, promotions, etc.)
