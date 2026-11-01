# Phase 0 findings — `useEveAgent` contract + minimum changes to replace Eve

**Scope:** read-only audit. This is the build spec for the lightweight-agent PoC. No infra changed.

## A. What the frontend depends on (the contract to preserve)

`src/components/HomePlanner.tsx` is the only consumer of the agent runtime. Its Eve coupling:

- **Hook:** `useEveAgent` from `eve/react`. Surface used: `agent.send(parts, opts?)`, `agent.status` (`'submitted'|'streaming'|...`), `agent.data.messages`, `agent.session`, options `initialEvents`, `initialSession`, `onError(err)`, `onFinish(snapshot => { events, session })`.
- **Message shape:** AI SDK UIMessage — `{ id, role, parts: [{ type, text? , ... }] }`. Text parts are `{type:'text', text}`.
- **Structured shopping card:** `src/lib/household-shop-messages.ts` → `householdShopFromPart` reads a part with `type:'dynamic-tool'`, `toolName:'present_household_shop'`, `state:'output-available'`, `partial:false`, and validates `output` against `householdShopToolOutputSchema` = `{ kind:'household_shop', shop: HouseholdShopContract }`. `HouseholdShopCard` renders it. **This is the exact byte-level contract the new runtime must emit.**
- **Text formatting:** `agentMessageBlocks`/`visibleAgentText` parse assistant text (markdown tables, `**bold**`). Runtime-agnostic — just needs assistant text parts.
- **Persistence:** `onFinish` snapshot `{events, session}` → localStorage + (signed-in) `/api/conversations` PATCH. Replaceable with any `{messages, conversationId}` snapshot.

**Conclusion:** the contract is the **AI SDK UIMessage stream**. Eve is effectively a UIMessage producer here; nothing proprietary leaks into the UI except the hook name and the snapshot shape.

## B. Why this makes replacement low-risk

- `ai@7.0.66` exports `streamText`, `toUIMessageStreamResponse`, `createUIMessageStream`, `convertToModelMessages`; `@ai-sdk/react@4.0.69` exports `useChat`.
- `streamText(...).toUIMessageStreamResponse()` emits **exactly** the `dynamic-tool` UIMessage parts (`toolName`, `state:'output-available'`, `output`) that `householdShopFromPart` already reads. So a tool named `present_household_shop` returning `{kind:'household_shop', shop}` renders in the existing `HouseholdShopCard` with **no card changes**.
- `useChat` and `useEveAgent` share the UIMessage model; swapping is a contained hook change behind a flag, not a UI rewrite.

## C. Minimum changes to replace Eve (preserving the experience)

1. **New SSE agent route** (e.g. `POST /api/agent/chat`): `streamText` + Bedrock (reuse `agent/agent.ts`'s `resolveModel()` provider wiring) + tools wrapping the existing `src/lib/shopping/**` functions; return `toUIMessageStreamResponse()`. Stateless; turn/conversation state in Supabase.
2. **Tools** = thin adapters over existing framework-agnostic logic (no rewrite of shopping logic):
   - `get_current_price` → `resolveCatalogueProduct`
   - `present_household_shop` → `groundHouseholdShop`/`resolveHouseholdShopProposal` (returns `{kind:'household_shop', shop}` — identical output)
   - `compare_shop_stores` → `src/lib/shopping/compare.ts`
   - `find_substitutes`, `get_current_shop`, etc. → existing libs
   All preserve product-identity safeguards + price-boundary (`latest_prices`, never invent) because that logic lives in the reused libs.
3. **Context injection** = port the `turn.started` logic (`agent/instructions/session-context.ts`) to a function that builds the system/context message per turn from Supabase (household facts, current shop, memory, watches).
4. **Frontend:** behind a flag, use `useChat` against `/api/agent/chat`; keep `HomePlanner.tsx` rendering (messages, `visibleHouseholdShops`, cards) unchanged. Snapshot persistence adapts to `{messages, conversationId}`.
5. **Guest auth + safeguards** at the route entry (see Phase 2).

## D. Supabase access

`agent/lib/supabase.ts` uses the service-role key with a read-only guard (`supabaseReadOnly()` under `APP_ENV=preview`/`SUPABASE_READ_ONLY=true`). The PoC reuses this pattern; in preview it is read-only so it cannot write to prod.

## E. What is explicitly NOT changing

Tesco/Dunnes/SuperValu collection pipelines; the `src/lib/shopping/**` logic; the `household_shop` card; product-identity + price-truth invariants; the Eve path (kept behind the flag as rollback).
