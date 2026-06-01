# Shopping Lists Redesign — Spec

> **Goal:** Make list management the core post-login experience. Lists are the product; the AI agent is the engine that helps manage them.

## Current State

**What exists:**
- `saved_lists` table — stores list metadata + raw items JSON, linked to conversations
- `list_items` table — historical item observations (for weekly email/watchdog)
- `conversations` table — chat history with AI, can link to a saved_list
- Dashboard shows: last list card, conversation history, household editor
- List page renders AI-generated markdown from conversation, with store totals
- ShoppingList component has: category nav, add/remove items, store overrides (all localStorage-based)
- 10-list cap per subscriber (auto-deletes oldest)
- Items stored as raw markdown in conversation messages OR JSON array in `saved_lists.items`

**Problems:**
1. Lists are a byproduct of conversations — not first-class entities
2. No way to create/manage multiple named lists (BBQ, weekly shop, Costco run)
3. Editing is localStorage-based and doesn't persist across devices
4. No structured item data (it's markdown parsed client-side)
5. Can't push a basket to a retailer (no structured store→items mapping)
6. "Same again" recreates via AI rather than duplicating a list
7. Dashboard is conversation-centric, not list-centric

## New Architecture

### Data Model

```sql
-- Replace saved_lists with a proper lists table
CREATE TABLE lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES subscribers(id),
  name TEXT NOT NULL DEFAULT 'My List',
  status TEXT NOT NULL DEFAULT 'active', -- active | archived | template
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ, -- for sorting "most recent"
  source TEXT DEFAULT 'manual', -- manual | ai_generated | duplicated | shared
  source_conversation_id UUID REFERENCES conversations(id),
  store_totals JSONB, -- cached [{store, total, item_count}]
  metadata JSONB DEFAULT '{}' -- flexible: {family_size, prompt, budget, notes}
);

-- Structured list items (replaces markdown + localStorage hacks)
CREATE TABLE list_items_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id), -- nullable for custom/free-text items
  custom_name TEXT, -- for items not in our catalogue
  category TEXT,
  quantity INTEGER DEFAULT 1,
  unit TEXT, -- kg, pack, each, etc.
  checked BOOLEAN DEFAULT false, -- in-store checkbox
  store_assignment TEXT, -- tesco | dunnes | supervalu | aldi | null (any)
  price_at_add NUMERIC(6,2), -- price when added (snapshot)
  position INTEGER DEFAULT 0, -- drag-to-reorder
  added_at TIMESTAMPTZ DEFAULT now(),
  notes TEXT -- "get the organic one", "any brand", etc.
);

-- For "push to store" — maps our items to retailer SKUs/URLs
CREATE TABLE store_cart_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  store TEXT NOT NULL, -- tesco | dunnes | supervalu
  store_sku TEXT, -- retailer's product ID
  store_url TEXT, -- direct product page or add-to-cart URL
  deeplink_url TEXT, -- mobile app deeplink (Tesco app, etc.)
  last_verified_at TIMESTAMPTZ,
  UNIQUE(product_id, store)
);

-- Indexes
CREATE INDEX idx_lists_subscriber ON lists(subscriber_id, status, last_used_at DESC);
CREATE INDEX idx_list_items_v2_list ON list_items_v2(list_id, position);
```

### List Lifecycle

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ AI Planner  │────▶│  List Created │────▶│  In-Store Use   │
│ generates   │     │  (editable)   │     │  (tick items)   │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │                       │
                     ┌─────▼──────┐          ┌─────▼──────┐
                     │  Duplicate  │          │  Archive   │
                     │  ("again")  │          │  (done)    │
                     └────────────┘          └────────────┘

Entry points:
• AI planner → generates structured items → saves as list
• Manual → "New list" → add items by search/browse
• Duplicate → copies items from existing list
• Shared → received via WhatsApp/link
• Template → "Usual weekly shop" reusable base
```

### Dashboard Redesign

```
┌──────────────────────────────────────────────┐
│ 👋 Welcome back                              │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ 🛒 New list    │    🤖 Ask agent        │ │
│ │ Start fresh    │    "Plan my week"       │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ 📋 MY LISTS                                  │
│ ┌──────────────────────────────────────────┐ │
│ │ Weekly Shop          12 items  €87.40    │ │
│ │ Last used: Today     🟢 Active           │ │
│ │ [Open] [Duplicate] [Push to Tesco →]     │ │
│ ├──────────────────────────────────────────┤ │
│ │ BBQ Saturday          8 items  €34.20    │ │
│ │ Created: 2 days ago  🟢 Active           │ │
│ │ [Open] [Duplicate]                       │ │
│ ├──────────────────────────────────────────┤ │
│ │ 🗂️ Archived (3)                         │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ⚙️ HOUSEHOLD PROFILE                         │
│ [Edit preferences]                           │
└──────────────────────────────────────────────┘
```

### List View (Mobile-First)

```
┌──────────────────────────────────────────────┐
│ ← Weekly Shop                    ⋮ Menu      │
│ 12 items · €87.40 total                      │
│                                              │
│ 🏪 STORE PILLS: [All] [Tesco €42] [Aldi €28]│
│                                              │
│ ── 🥬 Fresh ──────────────────────────────── │
│ ☐ Bananas (6)           Aldi     €1.49      │
│ ☐ Broccoli              Tesco    €1.20      │
│ ☑ Carrots 1kg           Aldi     €0.89  ✓   │
│                                              │
│ ── 🥛 Dairy ─────────────────────────────── │
│ ☐ Milk 2L               Tesco    €1.89      │
│ ☐ Cheddar 200g          Dunnes   €2.49      │
│                                              │
│ ── 🧹 Household ─────────────────────────── │
│ ☐ Washing Tabs 30pk     Aldi     €4.99      │
│                                              │
│ [+ Add item]                                 │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ 🛒 Push to store                        │ │
│ │ Send 6 Tesco items to your Tesco basket  │ │
│ │ [Push to Tesco]  [Push to Aldi*]         │ │
│ │ *Aldi has no online ordering             │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ [Share via WhatsApp]  [Copy as text]         │
└──────────────────────────────────────────────┘
```

### Push to Store

**How it works:**
1. User taps "Push to Tesco" → we have `store_cart_mappings` with Tesco URLs
2. Option A (v1): Open Tesco product page for each item in new tabs (clunky but works now)
3. Option B (v2): Use Tesco Groceries API add-to-basket endpoint (needs research — may require Awin affiliate or direct partnership)
4. Option C (v2): Generate a shareable Tesco list URL (if Tesco supports shared baskets)

**Store compatibility:**
| Store | Online ordering | Push feasibility |
|-------|----------------|-----------------|
| Tesco | ✅ tesco.ie | Possible via product URLs (v1) or API (v2) |
| SuperValu | ✅ supervalu.ie | Same approach — product URLs exist |
| Dunnes | ✅ via DunesStores.com (Buymie/Instacart) | Harder — third-party platform |
| Aldi | ❌ No online grocery | Show "Aldi items — in-store only" section |

**v1 approach (quick):**
- "Push to Tesco" button opens a page listing all Tesco items with direct links
- User can click each to add to their Tesco basket manually
- We already have `store_url` on `store_products` — just filter items by store

**v2 approach (ideal):**
- Browser extension or bookmarklet that auto-adds items to cart
- Or: Tesco/SuperValu affiliate partnership with basket-building API
- Or: Deep links to Tesco app with items pre-filled

### API Routes

```
GET    /api/v2/lists              — all active lists for user
POST   /api/v2/lists              — create new list (manual or from AI)
GET    /api/v2/lists/:id          — single list with items
PATCH  /api/v2/lists/:id          — update name, status, metadata
DELETE /api/v2/lists/:id          — soft delete (archive)
POST   /api/v2/lists/:id/duplicate — deep copy a list

GET    /api/v2/lists/:id/items    — all items in list
POST   /api/v2/lists/:id/items    — add item(s)
PATCH  /api/v2/lists/:id/items/:itemId — update quantity, checked, store, position
DELETE /api/v2/lists/:id/items/:itemId — remove item

POST   /api/v2/lists/:id/push     — generate push-to-store links for a given store
POST   /api/v2/lists/:id/share    — create shareable link/WhatsApp message
```

### AI Integration Changes

Currently the planner generates markdown. New flow:

1. AI planner generates structured output (tool call or JSON):
   ```json
   {
     "list_name": "Weekly Shop - June 1",
     "items": [
       { "product_id": "uuid", "quantity": 1, "store_assignment": "tesco", "price": 1.89 },
       { "product_id": null, "custom_name": "Birthday cake candles", "category": "Baking", "quantity": 1 }
     ]
   }
   ```
2. Frontend creates a `list` + `list_items_v2` records from this
3. User can still chat with agent to modify ("remove the bananas", "add something for the dog")
4. Agent modifications update the list items directly (via tool calls)

### Migration Path

1. **Phase A (this build):** New `lists` + `list_items_v2` tables. New dashboard. New list view. AI planner saves to new schema.
2. **Phase B:** Migrate existing `saved_lists` data to new tables. Deprecate old API routes.
3. **Phase C:** Push-to-store v1 (product URLs), WhatsApp share.
4. **Phase D:** In-store mode (checked items persist, sort by aisle), push-to-store v2.

### What Changes for Users

| Before | After |
|--------|-------|
| "Plan this week" → chat → list appears | Same, but list is now a proper object |
| Can't rename or organise lists | Name lists, archive old ones |
| "Same again" runs AI again | "Duplicate" instantly copies list |
| Edits lost on new device | Edits persist server-side |
| Can't use list in-store | Checkbox mode, persists ticks |
| Can't share easily | WhatsApp share, shareable link |
| No push-to-store | v1: links per store, v2: direct cart |

### Non-Goals (for now)

- Collaborative lists (multiple users editing same list)
- Real-time sync (eventual consistency is fine)
- Aisle/store layout optimisation (need store maps — future)
- Barcode scanning to add items
- Receipt scanning to auto-complete purchase

### Tech Notes

- Keep auth as-is (magic link JWT) — no new auth system needed
- List items are server-authoritative (no more localStorage for edits)
- Optimistic UI for checks/removes (update locally, sync in background)
- Store totals are cached on list and recalculated on item changes
- Position field enables drag-to-reorder (optional, nice-to-have)
- The `metadata` JSONB field future-proofs for budget, dietary labels, etc.

---

## Implementation Order

1. **DB migration** — create `lists` + `list_items_v2` + `store_cart_mappings` tables
2. **API v2 routes** — CRUD for lists and items
3. **Dashboard redesign** — list-centric, not conversation-centric
4. **List view redesign** — structured items, checkboxes, store grouping
5. **Planner integration** — AI saves structured items to new schema
6. **Push-to-store v1** — product URL links per store
7. **WhatsApp share** — shareable text/link
8. **Migration script** — convert existing saved_lists to new schema
