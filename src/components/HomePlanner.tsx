'use client';

import { useEffect, useRef, useState } from 'react';
import { useEveAgent } from 'eve/react';
import Link from 'next/link';
import { loadSession } from '@/lib/session';

const LEGACY_EVE_CHAT_KEY = 'sm_eve_household_chat_v1';

type EveAgentOptions = NonNullable<Parameters<typeof useEveAgent>[0]>;
type SavedEveChat = {
  events?: EveAgentOptions['initialEvents'];
  session?: EveAgentOptions['initialSession'];
};

type LoadedEveChat = {
  saved: SavedEveChat;
  storageKey: string | null;
};

const STARTERS = [
  'Prepare my usual shop',
  'What have you noticed this week?',
  'Keep my shop under €120',
  'Show me what you are watching',
];

function scopedEveChatKey(): string | null {
  const email = loadSession()?.email?.trim().toLowerCase();
  return email ? `${LEGACY_EVE_CHAT_KEY}:${encodeURIComponent(email)}` : null;
}

function loadSavedEveChat(): LoadedEveChat {
  try {
    localStorage.removeItem(LEGACY_EVE_CHAT_KEY);
    const storageKey = scopedEveChatKey();
    if (!storageKey) return { saved: {}, storageKey: null };
    const raw = localStorage.getItem(storageKey);
    return {
      saved: raw ? JSON.parse(raw) as SavedEveChat : {},
      storageKey,
    };
  } catch {
    return { saved: {}, storageKey: null };
  }
}

function messageText(message: { parts?: readonly { type: string; text?: string }[] }): string {
  return (message.parts ?? [])
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text ?? '')
    .join('');
}

function isPersistentGuestRequest(text: string): boolean {
  return /\b(watch|monitor|remind|notify|alert|track|tell me when|let me know when)\b/i.test(text);
}

function FormattedAgentText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((part, index) => part.startsWith('**') && part.endsWith('**')
        ? <strong key={index}>{part.slice(2, -2)}</strong>
        : <span key={index}>{part}</span>
      )}
    </p>
  );
}

function ShoppingAgentInner({ saved, storageKey, isGuest }: { saved: SavedEveChat; storageKey: string | null; isGuest: boolean }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const agent = useEveAgent({
    initialEvents: saved.events ?? [],
    initialSession: saved.session,
    onError(nextError) {
      const message = nextError.message || '';
      setError(/authori[sz]ation|required.*route|unauthori[sz]ed/i.test(message)
        ? 'Sign in to let your agent remember this and keep working for you.'
        : 'Supermarket.ie could not complete that request. Please try again.');
    },
    onFinish(snapshot) {
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify({
            events: snapshot.events,
            session: snapshot.session,
          }));
        } catch {}
      }
      window.dispatchEvent(new CustomEvent('sm:eve-turn-finished'));
    },
  });

  const busy = agent.status === 'submitted' || agent.status === 'streaming';
  const messages = agent.data.messages;
  const guestTurns = messages.filter(message => message.role === 'user').length;
  const showGuestGate = isGuest && (guestTurns >= 2 || messages.some(message =>
    message.role === 'user' && isPersistentGuestRequest(messageText(message))
  ));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, busy, showGuestGate]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setError('');
    await agent.send([{ type: 'text', text: message }]);
  }

  return (
    <div className="flex flex-col min-h-[420px] max-h-[68vh]" style={{ background: 'var(--surface-container-lowest)' }}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0" style={{ background: '#00944A' }}>S</div>
              <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed" style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
                Tell us what you need for the household shop. Supermarket.ie can remember preferences, prepare and edit your shop, watch products, and surface the changes that matter.
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pl-9">
              {STARTERS.map(starter => (
                <button key={starter} type="button" onClick={() => void send(starter)} className="px-3 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80" style={{ background: 'var(--surface-container-lowest)', color: 'var(--on-surface)', border: '1px solid var(--surface-container)' }}>
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(message => {
          const text = messageText(message);
          if (!text) return null;
          const isUser = message.role === 'user';
          return (
            <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold mr-2 mt-1 flex-shrink-0" style={{ background: '#00944A' }}>S</div>}
              <div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser ? 'rounded-br-sm' : 'rounded-bl-sm'}`} style={isUser ? { background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)' } : { background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
                {isUser ? <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p> : <FormattedAgentText text={text} />}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex items-center gap-2 pl-9 text-xs" style={{ color: 'var(--on-surface-variant)' }}>
            <span className="flex gap-1">
              {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#00944A', animationDelay: `${i * 140}ms` }} />)}
            </span>
            Working on that…
          </div>
        )}

        {error && <div className="ml-9 rounded-xl px-3 py-2 text-xs" style={{ background: '#FEF2F2', color: '#991B1B' }}>{error}</div>}

        {showGuestGate && (
          <div className="ml-9 rounded-2xl px-4 py-4" style={{ background: 'var(--primary-container)', border: '1px solid rgba(0,106,53,0.25)' }}>
            <p className="text-sm font-bold" style={{ color: 'var(--on-primary-container)' }}>
              Make this your household agent
            </p>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--on-primary-container)', opacity: 0.82 }}>
              Sign in so it can remember your preferences, prepare your shop and notify you when something you buy changes.
            </p>
            <Link href="/list/request" className="mt-3 inline-flex rounded-xl px-4 py-2 text-xs font-bold text-white" style={{ background: '#006A35' }}>
              Sign in free →
            </Link>
          </div>
        )}
      </div>

      <div className="border-t p-3" style={{ borderColor: 'var(--surface-container)', background: 'var(--surface-container-lowest)' }}>
        <form onSubmit={event => { event.preventDefault(); void send(input); }} className="relative">
          <textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(input); } }} rows={1} disabled={busy || showGuestGate} placeholder={showGuestGate ? 'Sign in to keep chatting…' : 'Tell Supermarket.ie what you need…'} className="w-full px-4 py-3 pr-12 rounded-xl text-sm resize-none outline-none disabled:opacity-60" style={{ background: 'var(--surface-container-low)', color: 'var(--on-background)', border: '1.5px solid var(--surface-container)' }} />
          <button type="submit" disabled={busy || showGuestGate || !input.trim()} aria-label="Send to Supermarket.ie" className="absolute right-2.5 bottom-2.5 w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-40" style={{ background: '#00944A' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
          </button>
        </form>
        <p className="text-[11px] mt-1.5 text-center" style={{ color: 'var(--on-surface-variant)' }}>
          Supermarket.ie can change your draft shop and household preferences. We won’t place an order or spend money without your approval.
        </p>
      </div>
    </div>
  );
}

export function HomePlanner() {
  const [loaded, setLoaded] = useState<LoadedEveChat | null>(null);
  const [isGuest, setIsGuest] = useState(true);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIsGuest(!loadSession()?.token);
      setLoaded(loadSavedEveChat());
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!loaded) {
    return (
      <div className="min-h-[420px] flex items-center justify-center text-sm" style={{ color: 'var(--on-surface-variant)' }}>
        Loading your shopping agent…
      </div>
    );
  }

  return <ShoppingAgentInner saved={loaded.saved} storageKey={loaded.storageKey} isGuest={isGuest} />;
}
