'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useChat, type UseChatHelpers } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage, type UserContent } from 'ai';

/**
 * Adapter that exposes the AI SDK `useChat` hook with the SAME surface
 * `HomePlanner.tsx` already consumes from `useEveAgent`, so the lightweight
 * stateless agent (`POST /api/agent/chat`) can replace Eve on the frontend with
 * minimal component change and identical card/message rendering.
 *
 * The UIMessage `parts` shape is identical between Eve and the AI SDK, so
 * `visibleHouseholdShops`/`householdShopFromPart` (which read a `dynamic-tool`
 * part named `present_household_shop`) work unchanged.
 */

type AgentMessage = UIMessage;

export type LightweightAgentSnapshot = {
  messages: AgentMessage[];
};

export type LightweightAgentOptions = {
  /** Mirrors useEveAgent initial events — we only need prior messages. */
  initialMessages?: AgentMessage[];
  /** Conversation id to resume (kept client-side; the route creates one if absent). */
  conversationId?: string | null;
  onError?: (error: Error) => void;
  /** Called when a turn settles; `snapshot.messages` is the full message list. */
  onFinish?: (snapshot: { messages: AgentMessage[]; session: { conversationId: string | null } }) => void;
};

export type LightweightAgentHelpers = {
  readonly data: { messages: AgentMessage[] };
  readonly status: UseChatHelpers<AgentMessage>['status'];
  readonly session: { conversationId: string | null } | null;
  readonly send: (message: string | UserContent, options?: { clientContext?: string }) => Promise<void>;
  readonly reset: () => void;
  readonly stop: () => void;
};

function toText(message: string | UserContent): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    return message
      .map(part => (typeof part === 'object' && part && 'type' in part && part.type === 'text' && 'text' in part ? String(part.text) : ''))
      .join('');
  }
  return '';
}

export function useLightweightAgent(options: LightweightAgentOptions = {}): LightweightAgentHelpers {
  const conversationIdRef = useRef<string | null>(options.conversationId ?? null);
  const optsRef = useRef(options);
  // Keep the latest lifecycle callbacks without re-subscribing the transport.
  useEffect(() => {
    optsRef.current = options;
  });

  const transport = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- prepareSendMessagesRequest runs at request time (outside render); it needs the live conversation id
      new DefaultChatTransport<AgentMessage>({
        api: '/api/agent/chat',
        credentials: 'same-origin',
        // Send the resumable conversation id alongside the messages so the
        // stateless route can enforce the per-conversation cap and persistence.
        prepareSendMessagesRequest({ messages, body }) {
          return { body: { ...body, messages, conversationId: conversationIdRef.current } };
        },
      }),
    [],
  );

  const chat = useChat<AgentMessage>({
    transport,
    messages: options.initialMessages ?? [],
    onError(error) {
      optsRef.current.onError?.(error);
    },
    onFinish({ messages }) {
      optsRef.current.onFinish?.({ messages, session: { conversationId: conversationIdRef.current } });
    },
  });

  const send = useCallback(
    async (message: string | UserContent) => {
      const text = toText(message).trim();
      if (!text) return;
      await chat.sendMessage({ text });
    },
    [chat],
  );

  const reset = useCallback(() => {
    conversationIdRef.current = null;
    chat.setMessages([]);
  }, [chat]);

  return {
    data: { messages: chat.messages },
    status: chat.status,
    // eslint-disable-next-line react-hooks/refs -- the conversation id is a stable cursor set on mount/reset, surfaced for parity with useEveAgent
    session: { conversationId: conversationIdRef.current },
    send,
    reset,
    stop: chat.stop,
  };
}
