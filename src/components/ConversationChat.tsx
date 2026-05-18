'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { loadSession } from '@/lib/session';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';

// ─── Types ──────────────────────────────────────────────────────────────

interface StoreTotal {
  store: string;
  total: number;
  cheapest?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function parseStoreTotals(content: string): StoreTotal[] {
  const lines = content.split('\n');
  const totals: StoreTotal[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.toLowerCase().includes('store total') || line.toLowerCase().includes('best value')) { inSection = true; continue; }
    if (inSection && line.trim() === '') break;
    if (inSection) {
      const m = line.match(/\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?:?\s*€?(\d+(?:\.\d{2})?)/i);
      if (m) { const total = parseFloat(m[2]); if (!isNaN(total)) totals.push({ store: m[1].toLowerCase(), total }); }
    }
  }
  if (totals.length > 0) {
    const cheapest = totals.reduce((min, c) => c.total < min.total ? c : min);
    cheapest.cheapest = true;
  }
  return totals;
}

// ─── Rich text rendering ────────────────────────────────────────────────

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} style={{ color: 'var(--on-background)' }}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function FormattedMessage({ content }: { content: string }) {
  if (!content) return null;
  const storeTotals = parseStoreTotals(content);
  const lines = content.split('\n');
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        if (line.startsWith('### ')) return <h4 key={i} className="font-bold text-base mt-4 mb-2" style={{ color: 'var(--on-background)' }}><RichText text={line.slice(4)} /></h4>;
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4 && !line.slice(2, -2).includes('**')) return <h5 key={i} className="text-xs font-bold uppercase tracking-wider mt-3 mb-1" style={{ color: 'var(--on-background)' }}>{line.slice(2, -2)}</h5>;
        if (line.startsWith('- ') || line.startsWith('* ')) return <p key={i} className="text-sm leading-relaxed pl-4" style={{ color: 'var(--on-surface)' }}><RichText text={line.slice(2)} /></p>;
        if (line.startsWith('---')) return <hr key={i} className="my-3" style={{ borderColor: 'var(--outline-variant)' }} />;
        if (line.startsWith('💡')) return <div key={i} className="mt-3 p-3 rounded-xl" style={{ background: 'var(--primary-fixed)' }}><p className="text-sm font-medium" style={{ color: 'var(--on-primary-container)' }}><RichText text={line} /></p></div>;
        return <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--on-surface)' }}><RichText text={line} /></p>;
      })}
      {storeTotals.length > 0 && (
        <div className="mt-4 space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--on-background)' }}>STORE TOTALS</h5>
          <div className="flex flex-wrap gap-2">
            {storeTotals.map((t, i) => (
              <div key={i} className="px-3 py-2 rounded-xl text-white text-sm font-bold flex items-center gap-2" style={{ background: storeStyle(t.store).bg }}>
                <span>{storeDisplayName(t.store)}</span>
                <span>€{t.total.toFixed(2)}</span>
                {t.cheapest && <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">Cheapest</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Streaming dots ─────────────────────────────────────────────────────

function StreamingDots() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {[0, 150, 300].map(d => (
          <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--primary)', animationDelay: `${d}ms` }} />
        ))}
      </div>
      <span className="text-sm" style={{ color: 'var(--on-surface)' }}>Thinking...</span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function ConversationChat({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('Conversation');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | undefined>(undefined);
  const [input, setInput] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevMessageCountRef = useRef(0);

  // Memoize transport so it's stable across renders
  const transport = useMemo(() => {
    if (!token) return undefined;
    return new DefaultChatTransport({
      api: '/api/plan',
      body: { conversationId, token },
    });
  }, [token, conversationId]);

  const { messages, sendMessage, status } = useChat({
    transport,
    messages: initialMessages,
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isStreaming]);

  // Load conversation from DB
  useEffect(() => {
    const session = loadSession();
    if (!session?.token) {
      router.push('/');
      return;
    }
    setToken(session.token);

    (async () => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}?token=${encodeURIComponent(session.token)}`);
        if (!res.ok) {
          setError('Conversation not found');
          setLoading(false);
          return;
        }
        const data = await res.json();
        const conv = data.conversation;
        setTitle(conv.title);

        // Convert stored messages to UIMessage format
        const storedMsgs = (conv.messages ?? []) as Array<{ role: string; content: string; timestamp?: string }>;
        const uiMessages: UIMessage[] = storedMsgs
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map((m, i) => ({
            id: `msg-${i}`,
            role: m.role as 'user' | 'assistant',
            parts: [{ type: 'text' as const, text: m.content }],
            createdAt: m.timestamp ? new Date(m.timestamp) : undefined,
          }));

        setInitialMessages(uiMessages);
        prevMessageCountRef.current = uiMessages.length;
      } catch (err) {
        setError('Failed to load conversation');
      } finally {
        setLoading(false);
      }
    })();
  }, [conversationId, router]);

  // Auto-save conversation after assistant response
  useEffect(() => {
    if (!token || !conversationId) return;
    if (messages.length <= prevMessageCountRef.current) return;
    if (isStreaming) return;

    // Check if the last message is from assistant (completed response)
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== 'assistant') return;

    prevMessageCountRef.current = messages.length;

    // Save to DB
    const plainMessages = messages.map(m => ({
      role: m.role,
      content: m.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map(p => p.text)
        .join(''),
      timestamp: new Date().toISOString(),
    }));

    fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, messages: plainMessages }),
    }).catch(() => {});
  }, [messages, isStreaming, token, conversationId]);

  // Helper to get text content from a message
  function getMessageText(msg: UIMessage): string {
    return msg.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('');
  }

  // Handle send
  function handleSend() {
    if (!input.trim() || isStreaming) return;
    sendMessage({ text: input });
    setInput('');
  }

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="flex gap-1">
          {[0, 150, 300].map(d => (
            <span key={d} className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--primary)', animationDelay: `${d}ms` }} />
          ))}
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-sm" style={{ color: 'var(--on-surface)' }}>{error}</p>
        <Link href="/dashboard" className="text-sm font-semibold" style={{ color: '#006A35' }}>
          ← Back to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4 border-b" style={{ borderColor: 'var(--surface-container)' }}>
        <Link href="/dashboard" className="p-1.5 rounded-lg transition-opacity hover:opacity-70" title="Back to dashboard">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--on-surface)' }}>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-base truncate" style={{ color: 'var(--on-background)' }}>{title}</h1>
          <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{messages.length} messages</p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 py-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {messages.map((m) => {
          const text = getMessageText(m);
          return (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>S</div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
                style={m.role === 'user'
                  ? { background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)' }
                  : { background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }
                }>
                {m.role === 'assistant' && (text.includes('**') || text.includes('###') || text.includes('- ')) ? (
                  <FormattedMessage content={text} />
                ) : (
                  <p style={{ color: m.role === 'user' ? undefined : 'var(--on-surface)', whiteSpace: 'pre-wrap' }}>{text}</p>
                )}
              </div>
            </div>
          );
        })}

        {/* Streaming indicator */}
        {isStreaming && messages.length > 0 && getMessageText(messages[messages.length - 1]) === '' && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>S</div>
            <div className="rounded-2xl rounded-bl-sm px-3 py-2 text-sm"
              style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
              <StreamingDots />
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="sticky bottom-0 z-10 pt-2 pb-4 w-full" style={{ background: 'var(--surface)' }}>
        <form onSubmit={e => { e.preventDefault(); handleSend(); }} className="relative w-full">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Modify your list... e.g. 'swap chicken for tofu', 'add more snacks'"
            rows={1}
            disabled={isStreaming}
            className="w-full px-4 py-3 pr-12 rounded-xl focus:outline-none text-sm resize-none transition disabled:opacity-50 box-border"
            style={{ background: 'var(--surface-container-low)', color: 'var(--on-background)', border: '1.5px solid var(--surface-container)' }}
            onFocus={e => { e.currentTarget.style.background = 'var(--surface-container-lowest)'; e.currentTarget.style.borderColor = 'rgba(0,106,53,0.4)'; }}
            onBlur={e => { e.currentTarget.style.background = 'var(--surface-container-low)'; e.currentTarget.style.borderColor = 'var(--surface-container)'; }}
          />
          <button type="submit" disabled={isStreaming || !input.trim()}
            className="absolute right-3 bottom-3 w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </form>
      </div>
    </main>
  );
}
