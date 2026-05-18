# AI SDK v6 Refactor Spec

## Overview

Upgrade from AI SDK v3 to v6 and refactor the grocery planner to use `ToolLoopAgent`, `useChat`, `UIMessage`, and `createAgentUIStreamResponse`. This eliminates ~500 lines of manual stream handling and gives us type-safe tool invocations + built-in message persistence hooks.

## Current State (v3)

- `ai@^3.4.33`, `@ai-sdk/anthropic@^0.0.56`, `@ai-sdk/react@^0.0.70`
- `/api/plan/route.ts` (576 lines) — 3 separate flows (conversation, profile, legacy), each calling `streamText()` + `toDataStreamResponse()`
- `HomePlanner.tsx` (1114 lines) — manual fetch, manual stream parsing (`0:"..."` format), manual message state
- `ConversationChat.tsx` (338 lines) — same manual stream parsing, manual message state, manual conversation persistence

## Target State (v6)

- `ai@^6.x`, `@ai-sdk/anthropic@^3.x`, `@ai-sdk/react@^3.x`
- **Packages already upgraded in package.json** — just need code changes

### Key v6 changes from v3:
1. `tool()` parameter is now `inputSchema` not `parameters` (as of v6)
2. `toDataStreamResponse()` → `toUIMessageStreamResponse()` for useChat integration
3. `useChat` from `@ai-sdk/react` — requires `DefaultChatTransport`, `sendMessage()` not `append()`
4. `UIMessage` type — messages use `.parts` array (text, tool-invocation, tool-result) instead of `.content` string
5. `ToolLoopAgent` class — define agent once, reuse with `.stream()` and `createAgentUIStreamResponse()`
6. `convertToModelMessages()` — converts UIMessages to model format

## Architecture

### New file: `src/lib/planner-agent.ts`
Shared grocery planner agent definition. Single source of truth for tools + system prompt.

```typescript
import { ToolLoopAgent, tool } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

// Export types
export interface PlannerProfile { ... }

// Export tools factory
export function makePlannerTools(subscriberId: string | null) { ... }

// Export prompt builders
export function buildProfilePrompt(profile: PlannerProfile): string { ... }
export function buildLegacyPrompt(householdSize: number): string { ... }

// Export agent factory (since tools need subscriberId at runtime, use factory)
export function createPlannerAgent(opts: {
  subscriberId: string | null;
  profile?: PlannerProfile;
  householdSize?: number;
  isModification?: boolean;
}) {
  return new ToolLoopAgent({
    model: anthropic('claude-haiku-4-5-20251001'),
    instructions: opts.profile
      ? buildProfilePrompt(opts.profile) + (opts.isModification ? '\n\n[modification instructions]' : '')
      : buildLegacyPrompt(opts.householdSize ?? 2),
    tools: makePlannerTools(opts.subscriberId),
    maxSteps: 10,
  });
}
```

### Modified: `/api/plan/route.ts`
Simplified to use `createPlannerAgent` + `createAgentUIStreamResponse`:

```typescript
import { createAgentUIStreamResponse, convertToModelMessages, UIMessage } from 'ai';
import { createPlannerAgent } from '@/lib/planner-agent';

export async function POST(req: Request) {
  const body = await req.json();
  const { messages, token, conversationId, profile, ... } = body;

  // Auth (same as before)
  // ...

  const agent = createPlannerAgent({
    subscriberId,
    profile,
    isModification: !!conversationId,
  });

  // For conversation flow: load previous messages from DB, merge
  // For new plan: messages come from useChat on client

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages, // UIMessage[] from client
    onFinish: ({ messages: finalMessages }) => {
      // Auto-save conversation to DB if conversationId present
    },
  });
}
```

### Modified: `ConversationChat.tsx`
Replace manual stream parsing with `useChat`:

```typescript
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export function ConversationChat({ conversationId }: { conversationId: string }) {
  // Load initial messages from API
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/plan',
      body: { conversationId, token },
    }),
    initialMessages,
  });

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>
          {msg.parts.map((part, i) =>
            part.type === 'text' ? <FormattedMessage key={i} content={part.text} /> : null
          )}
        </div>
      ))}
      <form onSubmit={e => { e.preventDefault(); sendMessage({ text: input }); }}>
        ...
      </form>
    </div>
  );
}
```

### Modified: `HomePlanner.tsx`
The homepage planner has a unique conversational setup flow (household → dietary → meals → budget → extras) with inline buttons before it hits the AI. This flow is NOT a useChat flow — it's a custom wizard.

**Approach:** Keep the wizard flow as-is (it's UI logic, not AI). Only replace the AI generation part:
- After the wizard completes and calls `generateList(profile)`:
  - Use `useChat` for the actual AI interaction
  - The first message is the synthesized user prompt
  - Stream response comes via `useChat` → parts rendering
  - Post-generation modifications use the same `useChat` instance

This means HomePlanner has TWO modes:
1. **Wizard mode** (greeting → household → dietary → meals → budget → extras) — custom state machine, no AI
2. **AI mode** (generating → done → modifications) — `useChat` handles streaming + messages

### Tool parameter rename
In v6, `tool()` uses `inputSchema` instead of `parameters`:
```typescript
// v3
tool({ description: '...', parameters: z.object({...}), execute: ... })
// v6
tool({ description: '...', inputSchema: z.object({...}), execute: ... })
```

## Files to create/modify

1. **CREATE** `src/lib/planner-agent.ts` — shared agent definition (tools, prompts, factory)
2. **MODIFY** `src/app/api/plan/route.ts` — use agent + `createAgentUIStreamResponse`
3. **MODIFY** `src/components/ConversationChat.tsx` — use `useChat` from `@ai-sdk/react`
4. **MODIFY** `src/components/HomePlanner.tsx` — use `useChat` for AI generation part

## Important constraints

- Packages already upgraded to v6 in package.json
- Don't break the homepage wizard flow (household → dietary → meals → budget → extras → generate)
- The wizard messages (with inline buttons) are NOT AI messages — they're local UI state
- Only the generation step and post-generation modifications use the AI
- Keep existing CSS custom properties / design system
- `toUIMessageStreamResponse()` is the v6 replacement for `toDataStreamResponse()`
- `convertToModelMessages()` converts UIMessage[] to model format
- Supabase conversation persistence should still work (load messages → useChat initialMessages, save on finish)
- The data stream v3 format (`0:"..."`) is different from v6 UIMessage stream — all parsing code can be removed
- `useChat` handles: message state, streaming, abort, status
- Model stays `claude-haiku-4-5-20251001`
- HomePlanner.tsx saveProfile/autoSaveConversation logic should remain intact
