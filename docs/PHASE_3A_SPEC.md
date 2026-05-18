# Phase 3a: Persistent Planner — Dashboard, Conversation History, Saved Lists

## Overview

Turn the one-shot AI planner into a persistent experience. Returning users land on a dashboard showing their last list, past conversations, and a "Plan this week" CTA. Conversations persist so users can modify lists via chat after generation.

## What exists today

- **HomePlanner.tsx** (977 lines) — conversational setup flow → AI list generation on homepage
- **`/api/plan/route.ts`** — Anthropic tool-use planner (profile-based + legacy)
- **`/api/lists/route.ts`** — CRUD for `saved_lists` table (GET/POST/DELETE)
- **`/api/lists/save-from-planner/route.ts`** — saves planner items to `list_items`
- **`/api/list/save-items/route.ts`** — another save endpoint
- **`SavedListsPanel.tsx`** — collapsible panel showing saved lists on `/list` page
- **Session/auth** — JWT tokens via magic link, stored in localStorage (`sm_session`)
- **Profile** — `PlannerProfile` stored in localStorage (`sm_planner_profile`)
- **`saved_lists`** table — id, subscriber_id, name, meals_prompt, family_size, items (JSON), store_totals (JSON), is_default, created_at, generated_at
- **`list_items`** table — subscriber_id, canonical_name, category, store, price_paid, quantity, observed_at
- **`subscribers`** table — id, email, family_size, subscribed, created_at

## Database changes (Supabase)

### New table: `conversations`

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id),
  title TEXT NOT NULL DEFAULT 'New conversation',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  profile JSONB, -- PlannerProfile snapshot at conversation start
  list_id UUID REFERENCES saved_lists(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_subscriber ON conversations(subscriber_id);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
```

The `messages` column stores the full conversation as a JSON array:
```json
[
  {"role": "user", "content": "...", "timestamp": "..."},
  {"role": "assistant", "content": "...", "timestamp": "..."}
]
```

### Alter `saved_lists` (add conversation_id)

```sql
ALTER TABLE saved_lists ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL;
```

## New API routes

### `POST /api/conversations` — Create conversation
- Auth: JWT token required
- Body: `{ token, title?, profile? }`
- Returns: `{ conversation: { id, title, created_at } }`

### `GET /api/conversations?token=xxx` — List conversations
- Returns: `{ conversations: [{ id, title, updated_at, message_count, list_id }] }`
- Ordered by updated_at DESC, limit 20

### `GET /api/conversations/[id]?token=xxx` — Get conversation with messages
- Returns: `{ conversation: { id, title, messages, profile, list_id, created_at, updated_at } }`

### `PATCH /api/conversations/[id]` — Update conversation (add messages, update title)
- Auth: JWT token required
- Body: `{ token, messages?, title? }`
- Updates `updated_at` automatically

### `DELETE /api/conversations/[id]?token=xxx` — Delete conversation

### `POST /api/plan` — MODIFY existing route
- Add optional `conversationId` param
- When present: load prior messages from DB, append new user message, stream response, then save all messages back
- This enables multi-turn: user sends "swap the chicken for tofu" → AI sees full context and modifies

## New page: `/dashboard`

### Layout
```
┌─────────────────────────────────────────────┐
│  supermarket.ie        [Prices] [Compare] [Blog]  │ (SiteHeader)
├─────────────────────────────────────────────┤
│                                             │
│  👋 Welcome back, [name]                    │
│                                             │
│  ┌───────────────────────────────────┐     │
│  │  🛒 Plan this week               │     │  (Primary CTA — big green button)
│  │  "Get a new AI grocery list"      │     │
│  └───────────────────────────────────┘     │
│                                             │
│  📋 Your last list                          │
│  ┌───────────────────────────────────┐     │
│  │  "Weekly shop - May 12"           │     │
│  │  Tesco €48.20 · Dunnes €52.30    │     │
│  │  [View list] [Modify in chat]     │     │
│  └───────────────────────────────────┘     │
│                                             │
│  💬 Recent conversations                    │
│  ┌───────────────────────────────────┐     │
│  │  "Weekly shop" — 2 days ago       │     │
│  │  "Quick midweek top-up" — 5d ago  │     │
│  │  "Birthday party prep" — 1w ago   │     │
│  └───────────────────────────────────┘     │
│                                             │
│  📦 All saved lists                         │
│  ┌───────────────────────────────────┐     │
│  │  [List card] [List card]          │     │
│  └───────────────────────────────────┘     │
│                                             │
└─────────────────────────────────────────────┘
```

### Behaviour
- **Not signed in** → redirect to homepage (or show sign-in prompt)
- **Signed in, no lists** → show "Plan your first list" CTA
- **Signed in, has data** → show dashboard with last list, recent conversations, saved lists
- "Plan this week" → navigates to homepage planner (or opens inline)
- "Modify in chat" → opens conversation view with that list's conversation, allows multi-turn modifications

## New page: `/dashboard/chat/[conversationId]`

A chat interface for modifying an existing list:
- Shows the conversation history (scrollable)
- Input bar at bottom
- Each user message is sent to `/api/plan` with `conversationId`
- AI response streams in (using Vercel AI SDK `useChat` or existing stream handling)
- The AI sees the full conversation context including the original list
- Users can say things like "swap chicken for tofu", "add more snacks", "what about drinks?"

### Technical approach
- Use the existing `/api/plan` route, extended to accept `conversationId` + `message`
- When `conversationId` is present:
  1. Load conversation from DB
  2. Append new user message to messages array
  3. Send full message history to Anthropic (system prompt + all messages)
  4. Stream response
  5. After stream completes, save updated messages back to DB
- Frontend: `useChat`-like pattern but with manual message management (load from API, append locally, stream, save)

## Modified component: HomePlanner.tsx

After a list is generated:
1. Auto-create a conversation (POST /api/conversations) with the profile + generated messages
2. Auto-save the list (existing /api/lists POST)
3. Link the conversation to the saved list
4. Show a "Continue in chat" button that navigates to `/dashboard/chat/[id]`
5. Also show "Go to dashboard" link

## Auth flow for dashboard

- Check localStorage for `sm_session` token
- If present, validate it's not expired client-side
- API routes verify JWT server-side
- If no token → show sign-in form (email → magic link → redirects to /dashboard with token)

## File structure (new files)

```
src/app/dashboard/
  page.tsx                          — Dashboard page (server component wrapper + client component)
  chat/[id]/page.tsx                — Chat conversation page

src/app/api/conversations/
  route.ts                          — GET (list) + POST (create)
  [id]/route.ts                     — GET (single) + PATCH (update) + DELETE

src/components/
  Dashboard.tsx                     — Main dashboard client component
  ConversationChat.tsx              — Chat UI for conversation modifications
```

## Design notes

- Match existing design system (CSS custom properties: --primary, --on-background, --surface-container-lowest, etc.)
- Mobile-first: dashboard should work great on phones
- Green (#006A35) primary, dark mode support follows existing patterns
- Use existing SiteHeader component
- Keep it simple — no complex state management, just React state + fetch

## Implementation order

1. Run SQL migrations (create conversations table, alter saved_lists)
2. Build API routes (conversations CRUD + modify /api/plan)
3. Build /dashboard page + Dashboard component
4. Build /dashboard/chat/[id] + ConversationChat component
5. Modify HomePlanner to auto-create conversations after list generation
6. Update SiteHeader to add Dashboard link for signed-in users
7. Test full flow: homepage → generate list → dashboard → modify in chat

## Important constraints

- Use existing auth (JWT in localStorage, verified via `jsonwebtoken` in API routes)
- Use existing Supabase client (`supabaseAdmin` from `@/lib/supabase`)
- Use existing `@ai-sdk/anthropic` + `ai` SDK for streaming
- Model: `claude-haiku-4-5-20251001` (same as current planner)
- Keep HomePlanner.tsx changes minimal — don't break the existing flow
- `MAGIC_LINK_SECRET` env var used for JWT verification
- All new pages should be in the sitemap but with `noindex` (personal pages)
