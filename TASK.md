# Task: Replace Wizard Planner with AI-Driven Conversation

## Goal
Replace the hard-coded wizard flow in `src/components/HomePlanner.tsx` with a fully AI-driven conversation from message 1. The AI handles intake, asks smart follow-up questions when needed, and produces the grocery list — all in a single conversational stream.

## Current Problem
- `HomePlanner.tsx` has a rigid `FlowStep` state machine: greeting → household → dietary → meals → budget → extras → generating
- The AI only kicks in at the very end to produce the list
- Users who type "family of 4, €100 budget, vegetarian, plan my week" still go through every step
- Feels like a form, not an intelligent assistant

## Architecture

### API: `/api/plan/route.ts`
- Already supports `createAgentUIStreamResponse` with tools
- Already has `planner-agent.ts` with tools (get_promotions, get_categories, get_prices_by_category, get_product, get_user_history, get_price_changes)
- Keep the conversation-based flow (conversationId path) and adapt the legacy path

### New Frontend Approach
Replace the wizard state machine with a `useChat`-like streaming conversation:

1. **First message from AI** — a friendly greeting that asks what they need (NOT a button-only wizard step)
2. **User can type anything** — "family of 4, vegetarian, €100 budget" or just "hi"
3. **AI responds intelligently** — if enough info, goes straight to generating the list. If not, asks ONLY what's missing in a natural way
4. **Buttons as suggestions** — keep inline buttons as quick-reply suggestions (not the only way to answer)
5. **Streaming** — stream the AI response in real-time like the current generation does
6. **Price gate** — keep the blur/unlock gate on store prices for non-signed-in users
7. **Post-list chat** — after the list, users can ask to modify it (this already works via handleModification)

### System Prompt (for the conversational intake)
The AI needs a NEW system prompt that covers both intake AND list generation in one flow:

```
You are the supermarket.ie grocery planning assistant. Your job is to understand what the user needs and produce a complete, priced weekly grocery list.

**Conversation rules:**
- If the user gives you enough info in one message (household size + what they need), go straight to building the list
- If info is missing, ask naturally — max 2-3 questions total, combining related topics
- Be brief and friendly. Irish audience. Use emoji sparingly.
- Always suggest quick-reply options in your questions (format: [option1|option2|option3])
- Never ask more than one question per message

**Info you need (minimum):**
- Household size (how many people)
- What meals to cover (or assume "full week" if they don't specify)

**Nice to have (ask if not volunteered):**
- Dietary needs / things to avoid
- Budget
- Store preference

**When you have enough info:**
1. Call get_promotions first
2. Call get_categories, then get_prices_by_category for relevant categories
3. Build a complete grocery list
4. Format output with the standard format (categories, store prices, totals, best value split)

**Returning users:**
- If get_user_history returns data, personalise the list
- Mention items they buy regularly
- Highlight price changes
```

### Key Implementation Details

1. **Remove FlowStep state machine** — replace with simple `messages` array + streaming state
2. **Keep the UI chrome** — the chat bubble layout, FormattedMessage renderer, BlurredText, store totals display, UnlockCTA, AnimatedPrice — all stay
3. **Button suggestions from AI** — parse `[option1|option2|option3]` from AI messages and render as clickable buttons
4. **Returning user flow** — if profile exists, prepend context to first AI message: "Returning user with profile: {profile}. Greet them and offer to do the same again or update."
5. **Keep parseSSETextDelta** — still needed for streaming
6. **Keep the unlock gate** — non-signed-in users get blurred prices, UnlockCTA shown after list generation
7. **Keep auto-save** — after generation + unlock, save conversation + list to Supabase

### Files to Modify

1. **`src/components/HomePlanner.tsx`** — Major rewrite. Remove wizard flow, add useChat-style streaming from message 1.
2. **`src/lib/planner-agent.ts`** — Update system prompt to handle both intake AND generation. Add a "conversational intake" mode.
3. **`src/app/api/plan/route.ts`** — Ensure the legacy flow (no conversationId) works with multi-turn messages from the new frontend.

### Button Format Convention
AI messages can include button suggestions using this format at the end of a message:
```
Who's eating this week?
[[Just me|2 adults|Family|Let me type it]]
```

The frontend parses `[[option1|option2|...]]` and renders as clickable buttons. When clicked, the option text is sent as the user's message.

### What NOT to Change
- The unlock/blur gate mechanism
- The auto-save to conversations/lists
- The store totals display and AnimatedPrice
- The overall visual design (chat bubbles, colors, M3 design system)
- The `/api/plan` route's conversation-based path (for dashboard ConversationChat)
- The `parseStoreTotals` logic
- The share button functionality

### Testing
After implementation:
1. New user types "hi" → AI asks who's eating → user responds → AI asks one more Q or generates
2. New user types "family of 4, vegetarian, €100 budget, full week" → AI generates immediately (no questions)
3. Returning user sees "same again" option
4. List generates with streaming, prices are blurred until signup
5. Post-list modification chat still works

## Important Notes
- Use AI SDK v6 patterns (the project already uses `ai` ^6.0.184)
- Model: `claude-haiku-4-5-20251001` (from `@ai-sdk/anthropic`) — same as current
- Keep the component export name `HomePlanner` so imports don't break
- The `page2/page.tsx` and `HeroSection.tsx` import HomePlanner — don't break those
