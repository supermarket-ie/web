import './setup-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { MockLanguageModelV4 } from 'ai/test';
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import type { LanguageModelV4StreamPart, LanguageModelV4Usage } from '@ai-sdk/provider';
import {
  HOUSEHOLD_SHOP_SCHEMA_VERSION,
  type HouseholdShopContract,
} from '../../shopping/household-shop-contract';

/**
 * Dry-run of the POST /api/agent/chat route with a MOCKED model (no real
 * Bedrock, no AWS creds). Asserts:
 *   1. A blocked guest gets the friendly limit message with NO model call.
 *   2. An allowed guest: the model calls present_household_shop, the UIMessage
 *      stream contains a `dynamic-tool` part for present_household_shop, and the
 *      spend reservation is reserved then settled.
 */

const usageZero: LanguageModelV4Usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 40, text: 40, reasoning: 0 },
};

function shopFixture(): HouseholdShopContract {
  return {
    schema_version: HOUSEHOLD_SHOP_SCHEMA_VERSION,
    household: {
      adults: 2,
      dietary_requirements: [],
      planning_period: { days: 7, label: 'This week' },
      assumptions_made: [],
    },
    sections: [{ id: 'dairy', label: 'Dairy', kind: 'food' }],
    items: [],
    totals: { selected_total: 0, priced_lines: 0, total_lines: 0, currency: 'EUR', by_selected_retailer: [] },
    store_coverage: [],
    missing_or_uncertain_items: [],
    recommended_retailer_strategy: { kind: 'insufficient_coverage', retailer: null, rationale: 'n/a' },
    provenance: {
      generated_at: new Date().toISOString(),
      price_boundary: 'latest_prices',
      totals_calculated_by: 'server',
      decision_trace: [],
    },
  };
}

// --- spies on the safeguard layer -----------------------------------------
const spies = {
  resolveGuestKey: vi.fn(),
  ensureConversation: vi.fn(),
  checkRateLimits: vi.fn(),
  reserveSpend: vi.fn(),
  settleSpend: vi.fn(),
  recordTurn: vi.fn(),
  releaseActiveRequest: vi.fn(),
};

vi.mock('@/lib/agent/safeguards', () => ({
  GUEST_COOKIE_NAME: 'sm_guest',
  resolveGuestKey: (...a: unknown[]) => spies.resolveGuestKey(...a),
  ensureConversation: (...a: unknown[]) => spies.ensureConversation(...a),
  checkRateLimits: (...a: unknown[]) => spies.checkRateLimits(...a),
  reserveSpend: (...a: unknown[]) => spies.reserveSpend(...a),
  settleSpend: (...a: unknown[]) => spies.settleSpend(...a),
  recordTurn: (...a: unknown[]) => spies.recordTurn(...a),
  releaseActiveRequest: (...a: unknown[]) => spies.releaseActiveRequest(...a),
  rateLimitMessage: (reason: string) => `blocked:${reason}`,
  spendBlockedMessage: () => 'assistant busy',
}));

vi.mock('@/lib/agent/context', () => ({
  buildSystemPrompt: () => Promise.resolve('system prompt'),
}));

// Mock the tools so present_household_shop returns a fixture without any DB.
vi.mock('@/lib/agent/tools', async () => {
  const { dynamicTool } = await import('ai');
  const { householdShopProposalSchema } = await import('../../shopping/household-shop-contract');
  return {
    buildAgentTools: () => ({
      present_household_shop: dynamicTool({
        description: 'present',
        inputSchema: householdShopProposalSchema,
        execute: async () => ({ kind: 'household_shop' as const, shop: shopFixture() }),
      }),
    }),
  };
});

// The mocked model: first step calls the tool, second step finishes with text.
const modelRef: { current: MockLanguageModelV4 | null } = { current: null };
vi.mock('@/lib/agent/model', () => ({
  resolveAgentModel: () => modelRef.current,
}));

function toolCallThenText(): MockLanguageModelV4 {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      call += 1;
      const toolCallParts: LanguageModelV4StreamPart[] = [
        { type: 'stream-start', warnings: [] },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'present_household_shop',
          input: JSON.stringify({
            schema_version: HOUSEHOLD_SHOP_SCHEMA_VERSION,
            household: {
              adults: 2,
              dietary_requirements: [],
              planning_period: { days: 7, label: 'This week' },
              assumptions_made: [],
            },
            sections: [{ id: 'dairy', label: 'Dairy', kind: 'food' }],
            items: [
              {
                line_id: 'l1',
                section_id: 'dairy',
                unresolved_need: 'butter',
                display_label: 'Butter',
                quantity: 1,
                unit_or_pack_expectation: '454g',
                reason: 'staple',
              },
            ],
          }),
          dynamic: true,
        },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: usageZero },
      ];
      const textParts: LanguageModelV4StreamPart[] = [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Here is your shop.' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: usageZero },
      ];
      const parts = call === 1 ? toolCallParts : textParts;
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  });
}

async function readSse(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

/**
 * Reconstruct the final assistant UIMessage from the route's SSE response
 * EXACTLY as the browser `useChat` client does: parse each `data:` line into a
 * UIMessageChunk and feed them to `readUIMessageStream`. This asserts the
 * contract at the layer the frontend actually consumes (message.parts), where a
 * present_household_shop tool call surfaces as a `dynamic-tool` part.
 */
async function reconstructMessage(response: Response): Promise<UIMessage> {
  const sse = await readSse(response);
  const chunks: UIMessageChunk[] = [];
  for (const line of sse.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') continue;
    chunks.push(JSON.parse(payload) as UIMessageChunk);
  }
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  let last: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream })) last = message;
  if (!last) throw new Error('no message reconstructed');
  return last;
}

function request(body: unknown): NextRequest {
  return new NextRequest('https://supermarket.test/api/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.5' },
    body: JSON.stringify(body),
  });
}

const userMessage = {
  id: 'm1',
  role: 'user' as const,
  parts: [{ type: 'text' as const, text: 'Plan my weekly shop' }],
};

beforeEach(() => {
  for (const spy of Object.values(spies)) spy.mockReset();
  spies.resolveGuestKey.mockReturnValue({
    guestKey: 'guest:abc',
    isGuest: true,
    subscriberId: null,
    setCookieValue: 'abc.sig',
    clientIp: '203.0.113.5',
  });
  spies.recordTurn.mockResolvedValue(undefined);
  spies.settleSpend.mockResolvedValue(undefined);
  spies.releaseActiveRequest.mockResolvedValue(undefined);
  modelRef.current = toolCallThenText();
});

afterEach(() => vi.clearAllMocks());

describe('POST /api/agent/chat', () => {
  it('blocks a rate-limited guest with a friendly message and NO model call', async () => {
    spies.ensureConversation.mockResolvedValue({
      ok: true,
      conversation: { id: 'conv-1', message_count: 0 },
      reason: 'ok',
    });
    spies.checkRateLimits.mockResolvedValue({ allowed: false, reason: 'hour_limit' });

    const { POST } = await import('../../../app/api/agent/chat/route');
    const response = await POST(request({ messages: [userMessage] }));
    const text = await readSse(response);

    expect(text).toContain('blocked:hour_limit');
    // No model call, no spend reserved.
    expect(modelRef.current!.doStreamCalls.length).toBe(0);
    expect(spies.reserveSpend).not.toHaveBeenCalled();
    // The rejection is still recorded for observability.
    expect(spies.recordTurn).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'hour_limit', model: 'none' }));
  });

  it('streams a dynamic-tool present_household_shop part and reserves+settles spend', async () => {
    spies.ensureConversation.mockResolvedValue({
      ok: true,
      conversation: { id: 'conv-1', message_count: 0 },
      reason: 'ok',
    });
    spies.checkRateLimits.mockResolvedValue({ allowed: true, reason: 'ok' });
    spies.reserveSpend.mockResolvedValue({ ok: true, reservationId: 'res-1', reason: 'ok' });

    const { POST } = await import('../../../app/api/agent/chat/route');
    const response = await POST(request({ messages: [userMessage], conversationId: 'conv-1' }));
    const message = await reconstructMessage(response);

    // The reconstructed assistant message carries a dynamic-tool part for
    // present_household_shop in the output-available state, exactly what the
    // frontend reads to render the structured shop card.
    const part = message.parts.find(
      (p): p is Extract<typeof p, { type: 'dynamic-tool' }> => p.type === 'dynamic-tool',
    );
    expect(part).toBeDefined();
    expect(part!.toolName).toBe('present_household_shop');
    expect(part!.state).toBe('output-available');
    const output = (part as { output?: { kind?: string } }).output;
    expect(output?.kind).toBe('household_shop');

    // The model was actually invoked (tool step + finish step).
    expect(modelRef.current!.doStreamCalls.length).toBeGreaterThanOrEqual(1);

    // Spend reserved before and settled after.
    expect(spies.reserveSpend).toHaveBeenCalledTimes(1);
    expect(spies.settleSpend).toHaveBeenCalledWith('res-1', expect.any(Number));
    expect(spies.recordTurn).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'completed' }));
  });

  it('returns the busy message with NO model call when spend reservation is refused', async () => {
    spies.ensureConversation.mockResolvedValue({
      ok: true,
      conversation: { id: 'conv-1', message_count: 0 },
      reason: 'ok',
    });
    spies.checkRateLimits.mockResolvedValue({ allowed: true, reason: 'ok' });
    spies.reserveSpend.mockResolvedValue({ ok: false, reservationId: null, reason: 'ceiling' });

    const { POST } = await import('../../../app/api/agent/chat/route');
    const response = await POST(request({ messages: [userMessage] }));
    const text = await readSse(response);

    expect(text).toContain('assistant busy');
    expect(modelRef.current!.doStreamCalls.length).toBe(0);
    expect(spies.releaseActiveRequest).toHaveBeenCalledWith('guest:abc');
    expect(spies.recordTurn).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'spend_blocked' }));
  });
});
