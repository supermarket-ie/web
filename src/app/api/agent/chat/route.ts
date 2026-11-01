import { NextRequest } from 'next/server';
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from 'ai';
import { resolveAgentModel } from '@/lib/agent/model';
import { buildAgentTools } from '@/lib/agent/tools';
import { buildSystemPrompt } from '@/lib/agent/context';
import {
  MAX_OUTPUT_TOKENS,
  actualTurnCostCents,
  estimateTurnCostCents,
  requestTimeout,
  stopWhenMaxSteps,
  trimMessagesToBudget,
} from '@/lib/agent/limits';
import {
  ensureConversation,
  checkRateLimits,
  rateLimitMessage,
  recordTurn,
  releaseActiveRequest,
  reserveSpend,
  resolveGuestKey,
  settleSpend,
  spendBlockedMessage,
  GUEST_COOKIE_NAME,
} from '@/lib/agent/safeguards';

/**
 * POST /api/agent/chat — stateless, Bedrock-powered shopping agent PoC.
 *
 * Emits the SAME AI SDK UIMessage stream the frontend already consumes via
 * `toUIMessageStreamResponse()`. When the model calls the `present_household_shop`
 * tool and returns `{ kind:'household_shop', shop }`, the SDK emits a
 * `dynamic-tool` part (toolName: 'present_household_shop', state:'output-available')
 * which the frontend renders as a structured shop card.
 *
 * Environment variables consumed (all documented here):
 *   AGENT_MODEL_PROVIDER       'bedrock' (default) | 'anthropic' — model backend.
 *   AGENT_MODEL_ID             Bedrock model/inference-profile id
 *                              (default: eu.anthropic.claude-sonnet-4-6).
 *   AGENT_ANTHROPIC_MODEL      Model id used on the anthropic rollback path.
 *   ANTHROPIC_API_KEY          Required only when AGENT_MODEL_PROVIDER=anthropic.
 *   AWS_REGION                 Bedrock region (default: eu-west-1).
 *   NEXT_PUBLIC_SUPABASE_URL   Supabase project URL (reads + safeguard writes).
 *   SUPABASE_SERVICE_ROLE_KEY  Supabase service-role key.
 *   AGENT_GUEST_COOKIE_SECRET  HMAC secret for the signed `sm_guest` cookie
 *                              (falls back to MAGIC_LINK_SECRET).
 *   MAGIC_LINK_SECRET          Verifies the signed-in `sm_session` cookie (and
 *                              is the fallback guest-cookie secret).
 *   APP_ENV / SUPABASE_READ_ONLY  When preview/true, catalogue + price reads are
 *                              read-only; the safeguard tables stay writable.
 */
export const runtime = 'nodejs';

type ChatRequestBody = {
  messages?: UIMessage[];
  conversationId?: string | null;
};

/** Build a UIMessage stream whose only content is a single assistant text message. */
function assistantTextResponse(text: string, headers?: Record<string, string>) {
  const stream = createUIMessageStream({
    execute({ writer }) {
      const id = 'msg-1';
      writer.write({ type: 'text-start', id });
      writer.write({ type: 'text-delta', id, delta: text });
      writer.write({ type: 'text-end', id });
    },
  });
  return createUIMessageStreamResponse({ stream, headers });
}

function cookieHeader(setCookieValue: string | null): Record<string, string> {
  if (!setCookieValue) return {};
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  // 180-day signed guest id; HttpOnly so client JS cannot read/forge it.
  return {
    'Set-Cookie': `${GUEST_COOKIE_NAME}=${setCookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000${secure}`,
  };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ChatRequestBody | null;
  const messages = Array.isArray(body?.messages) ? body!.messages : [];
  const requestedConversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;

  const identity = resolveGuestKey(req);
  const cookie = cookieHeader(identity.setCookieValue);

  // 1) Ensure/lookup the conversation (also enforces ≤15 messages/conversation).
  const conv = await ensureConversation(requestedConversationId, identity.guestKey, identity.subscriberId);
  if (!conv.ok || !conv.conversation) {
    return assistantTextResponse(rateLimitMessage(conv.reason), cookie);
  }
  const conversationId = conv.conversation.id;

  // 2) Atomic, fail-closed rate check. Claims the per-guest active-request lock.
  const rate = await checkRateLimits(identity.guestKey, conversationId);
  if (!rate.allowed) {
    // No model call. Record the rejection outcome (no lock to release — the
    // check only claims the lock on success).
    await recordTurn({
      conversationId,
      guestKey: identity.guestKey,
      subscriberId: identity.subscriberId,
      inputTokens: 0,
      outputTokens: 0,
      estCostCents: 0,
      outcome: rate.reason,
      model: 'none',
      clientIp: identity.clientIp,
    });
    return assistantTextResponse(rateLimitMessage(rate.reason), cookie);
  }

  // 3) Reserve estimated spend BEFORE the model call (fail closed on error/ceiling).
  const trimmed = trimMessagesToBudget(messages);
  const inputChars = JSON.stringify(trimmed).length;
  const estimateCents = estimateTurnCostCents(inputChars);
  const reservation = await reserveSpend(estimateCents);
  if (!reservation.ok || !reservation.reservationId) {
    await releaseActiveRequest(identity.guestKey);
    await recordTurn({
      conversationId,
      guestKey: identity.guestKey,
      subscriberId: identity.subscriberId,
      inputTokens: 0,
      outputTokens: 0,
      estCostCents: 0,
      outcome: 'spend_blocked',
      model: 'none',
      clientIp: identity.clientIp,
    });
    return assistantTextResponse(spendBlockedMessage(), cookie);
  }
  const reservationId = reservation.reservationId;

  // 4) Run the model turn.
  const timeout = requestTimeout();
  const tools = buildAgentTools({ subscriberId: identity.subscriberId });
  const modelId = process.env.AGENT_MODEL_ID ?? process.env.AGENT_MODEL_PROVIDER ?? 'bedrock';

  let settled = false;
  const finalise = async (outcome: string, inputTokens: number, outputTokens: number) => {
    if (settled) return;
    settled = true;
    timeout.clear();
    await settleSpend(reservationId, actualTurnCostCents(inputTokens, outputTokens));
    await recordTurn({
      conversationId,
      guestKey: identity.guestKey,
      subscriberId: identity.subscriberId,
      inputTokens,
      outputTokens,
      estCostCents: actualTurnCostCents(inputTokens, outputTokens),
      outcome,
      model: modelId,
      clientIp: identity.clientIp,
    });
  };

  const system = await buildSystemPrompt({ subscriberId: identity.subscriberId, isGuest: identity.isGuest });
  const modelMessages = await convertToModelMessages(trimmed);

  const result = streamText({
    model: resolveAgentModel(),
    system,
    messages: modelMessages,
    tools,
    stopWhen: stopWhenMaxSteps,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    abortSignal: timeout.signal,
    async onFinish({ usage }) {
      await finalise('completed', usage?.inputTokens ?? 0, usage?.outputTokens ?? 0);
    },
    async onError() {
      await finalise('model_error', 0, 0);
    },
  });

  return result.toUIMessageStreamResponse({
    headers: cookie,
    // Surface a friendly message if streaming errors before onError settles.
    onError: () => 'Something went wrong answering that. Please try again.',
  });
}
