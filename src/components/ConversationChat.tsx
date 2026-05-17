'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadSession } from '@/lib/session';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';

// ─── Types ──────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [title, setTitle] = useState('Conversation');
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isStreaming]);

  // Load conversation
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
        setMessages(conv.messages ?? []);
      } catch (err) {
        setError('Failed to load conversation');
      } finally {
        setLoading(false);
      }
    })();
  }, [conversationId, router]);

  // Send a message
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming || !token) return;

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date().toISOString() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsStreaming(true);

    abortRef.current = new AbortController();
    let assistantContent = '';

    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: text,
          token,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error('Request failed');
      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      // Add placeholder for streaming assistant message
      const streamingMessages = [...updatedMessages, { role: 'assistant' as const, content: '', timestamp: new Date().toISOString() }];
      setMessages(streamingMessages);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          const t = line.trim();
          if (t.startsWith('0:"') && t.endsWith('"')) {
            try {
              const parsed = JSON.parse(t.slice(2));
              assistantContent += parsed;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantContent };
                return updated;
              });
            } catch {}
          }
        }
      }

      // Save conversation back to DB
      const finalMessages = [
        ...updatedMessages,
        { role: 'assistant' as const, content: assistantContent, timestamp: new Date().toISOString() },
      ];
      setMessages(finalMessages);

      await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, messages: finalMessages }),
      });

    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => [
          ...prev.filter(m => m.content !== ''),
          { role: 'assistant', content: 'Sorry, something went wrong. Please try again.', timestamp: new Date().toISOString() },
        ]);
      }
    } finally {
      setIsStreaming(false);
    }
  }, [messages, isStreaming, token, conversationId]);

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
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>S</div>
            )}
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'}`}
              style={m.role === 'user'
                ? { background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)' }
                : { background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }
              }>
              {m.role === 'assistant' && (m.content.includes('**') || m.content.includes('###') || m.content.includes('- ')) ? (
                <FormattedMessage content={m.content} />
              ) : (
                <p style={{ color: m.role === 'user' ? undefined : 'var(--on-surface)', whiteSpace: 'pre-wrap' }}>{m.content}</p>
              )}
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {isStreaming && messages[messages.length - 1]?.content === '' && (
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
        <form onSubmit={e => { e.preventDefault(); sendMessage(input); }} className="relative w-full">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
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
