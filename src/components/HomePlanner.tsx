'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useEveAgent } from 'eve/react';
import Link from 'next/link';
import {
  ArrowUp,
  BadgeEuro,
  Bell,
  ClipboardList,
  Eye,
  Search,
  ShoppingBasket,
  Sparkles,
  Utensils,
  WalletCards,
} from 'lucide-react';
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

type Starter = {
  label: string;
  detail: string;
  prompt: string;
  icon: ComponentType<{ className?: string }>;
};

const GUEST_STARTERS: Starter[] = [
  { label: "Find Hellmann's mayonnaise", detail: 'Check current products, prices and stores', prompt: "Find the current price of Hellmann's mayonnaise", icon: Search },
  { label: 'Compare Irish butter', detail: 'See how a product compares across stores', prompt: 'Compare current prices for Irish butter', icon: BadgeEuro },
  { label: 'Plan four easy dinners', detail: 'Turn a simple idea into a practical week', prompt: 'Help me plan four easy family dinners', icon: Utensils },
  { label: 'Keep a shop under €120', detail: 'Get a sensible household shopping strategy', prompt: 'How can I keep a household shop under €120?', icon: WalletCards },
];

const HOUSEHOLD_STARTERS: Starter[] = [
  { label: 'Prepare my usual shop', detail: 'Use what your household is likely to need now', prompt: 'Prepare my usual shop', icon: ShoppingBasket },
  { label: 'What is worth knowing?', detail: 'Surface useful changes from this week', prompt: 'What have you noticed this week?', icon: Sparkles },
  { label: 'Keep my shop under €120', detail: 'Review your current shop against the budget', prompt: 'Keep my shop under €120', icon: ClipboardList },
  { label: 'Show what you are watching', detail: 'Review active product watches and reminders', prompt: 'Show me what you are watching', icon: Eye },
];

const GUEST_TYPEAHEAD = [
  "Where can I find Hellmann's mayonnaise?",
  'Where can I find Glenisk natural yoghurt?',
  'Where can I find Glenisk Greek-style yoghurt?',
  'Find the current price of Glenisk yoghurt',
  'Where can I find gluten-free bread?',
  'Where can I find laundry detergent on offer?',
  'Compare current prices for Irish butter',
  'Compare current prices for whole milk',
  'Compare current prices for dishwasher tablets',
  'Help me plan four easy family dinners',
  'Plan five vegetarian dinners for this week',
  'What can I make with chicken and rice?',
  'How can I keep a household shop under €120?',
  'Suggest a practical shop for two adults',
];

const HOUSEHOLD_TYPEAHEAD = [
  ...GUEST_TYPEAHEAD,
  'Prepare my usual shop for this week',
  'What have you noticed about my usual products?',
  'Keep my current shop under €120',
  'Show me what you are watching for me',
  "Remind me when Hellmann's mayonnaise is on offer",
];

function normalisePrompt(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9€]+/g, ' ').trim();
}

function typeaheadSuggestions(input: string, isGuest: boolean): string[] {
  const query = normalisePrompt(input);
  if (query.length < 2) return [];
  const queryWords = query.split(' ');
  const lastWord = queryWords.at(-1) ?? query;
  const candidates = isGuest ? GUEST_TYPEAHEAD : HOUSEHOLD_TYPEAHEAD;

  return candidates
    .map((prompt, index) => {
      const normalised = normalisePrompt(prompt);
      const words = normalised.split(' ');
      const sharedWords = queryWords.filter(word => word.length > 1 && normalised.includes(word)).length;
      let score = sharedWords * 12;
      if (normalised.startsWith(query)) score += 100;
      if (normalised.includes(query)) score += 65;
      if (lastWord.length > 1 && words.some(word => word.startsWith(lastWord))) score += 45;
      return { prompt, score, index };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .map(item => item.prompt);
}

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
    return { saved: raw ? JSON.parse(raw) as SavedEveChat : {}, storageKey };
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
    <p className="whitespace-pre-wrap">
      {parts.map((part, index) => part.startsWith('**') && part.endsWith('**')
        ? <strong key={index}>{part.slice(2, -2)}</strong>
        : <span key={index}>{part}</span>
      )}
    </p>
  );
}

type ComposerProps = {
  input: string;
  setInput: (value: string) => void;
  send: (value: string) => Promise<void>;
  busy: boolean;
  gated: boolean;
  prominent?: boolean;
};

function AgentComposer({ input, setInput, send, busy, gated, prominent = false }: ComposerProps) {
  return (
    <form
      onSubmit={event => { event.preventDefault(); void send(input); }}
      className={`relative rounded-[1.35rem] border bg-white shadow-[0_14px_45px_rgba(26,54,39,0.08)] transition-shadow focus-within:shadow-[0_18px_60px_rgba(26,54,39,0.13)] ${prominent ? 'min-h-20' : 'min-h-14'}`}
      style={{ borderColor: 'rgba(20, 46, 31, 0.12)' }}
    >
      <textarea
        value={input}
        onChange={event => setInput(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void send(input);
          }
        }}
        rows={prominent ? 2 : 1}
        disabled={busy || gated}
        placeholder={gated ? 'Sign in to keep working with your agent…' : 'Ask Supermarket.ie what your household needs…'}
        className={`w-full resize-none bg-transparent pl-5 pr-16 text-[15px] text-on-background outline-none placeholder:text-[#8d948f] disabled:opacity-60 ${prominent ? 'py-5' : 'py-4'}`}
      />
      <button
        type="submit"
        disabled={busy || gated || !input.trim()}
        aria-label="Send to Supermarket.ie"
        className="absolute bottom-3 right-3 flex size-10 items-center justify-center rounded-full bg-[#0b1710] text-white transition-transform hover:scale-[1.03] disabled:opacity-30 disabled:hover:scale-100"
      >
        <ArrowUp className="size-5" strokeWidth={2.4} />
      </button>
    </form>
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
          localStorage.setItem(storageKey, JSON.stringify({ events: snapshot.events, session: snapshot.session }));
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
  const starters = isGuest ? GUEST_STARTERS : HOUSEHOLD_STARTERS;
  const isEmpty = messages.length === 0;
  const liveSuggestions = typeaheadSuggestions(input, isGuest);

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

  if (isEmpty) {
    return (
      <div className="flex min-h-[470px] flex-col bg-white px-5 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
          <div className="mb-6">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#397250]">
              <span className="flex size-6 items-center justify-center rounded-full bg-[#e5f7eb]"><Sparkles className="size-3.5" /></span>
              Ready when you are
            </div>
            <h2 className="text-balance text-2xl font-semibold tracking-[-0.035em] text-[#152219] sm:text-[2rem]">What do you need for the household?</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667169]">
              {isGuest
                ? 'Thousands of Irish supermarket prices and ingredient mappings.'
                : 'Ask your agent to prepare, review or update the shop around your household.'}
            </p>
          </div>

          <AgentComposer input={input} setInput={setInput} send={send} busy={busy} gated={showGuestGate} prominent />

          {liveSuggestions.length > 0 ? (
            <div className="mt-2 overflow-hidden rounded-2xl border border-[#e3e8e4] bg-white py-1 shadow-[0_18px_45px_rgba(25,57,38,0.1)]">
              {liveSuggestions.map(suggestion => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#435047] transition-colors hover:bg-[#f3f7f4] hover:text-[#142019]"
                >
                  <Search className="size-4 shrink-0 text-[#7c8980]" />
                  <span>{suggestion}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {starters.map(starter => {
                const Icon = starter.icon;
                return (
                  <button key={starter.prompt} type="button" onClick={() => void send(starter.prompt)} className="group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-[#f5f8f5]">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[#e5eae6] bg-white text-[#176b3a] shadow-sm"><Icon className="size-4" /></span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[#26342b]">{starter.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-[#879089]">{starter.detail}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-[10px] leading-4 text-[#9aa19c]">Your agent can prepare drafts and remember preferences after sign-in. It will never place an order or spend money without approval.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[470px] max-h-[68vh] flex-col bg-white">
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-6 sm:px-7">
        {messages.map(message => {
          const text = messageText(message);
          if (!text) return null;
          const isUser = message.role === 'user';
          return (
            <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && <div className="mr-2 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#e5f7eb] text-[11px] font-bold text-[#0a773a]">S</div>}
              <div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${isUser ? 'rounded-br-md bg-[#122018] text-white' : 'rounded-bl-md bg-[#f1f3f1] text-[#39443d]'}`}>
                {isUser ? <p className="whitespace-pre-wrap">{text}</p> : <FormattedAgentText text={text} />}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex items-center gap-2 pl-9 text-xs text-[#758078]">
            <span className="flex gap-1">{[0, 1, 2].map(i => <span key={i} className="size-1.5 animate-bounce rounded-full bg-[#0a8f45]" style={{ animationDelay: `${i * 140}ms` }} />)}</span>
            Working on that…
          </div>
        )}

        {error && <div className="ml-9 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">{error}</div>}

        {showGuestGate && (
          <div className="ml-9 rounded-2xl border border-[#cce6d5] bg-[#f0faf3] px-5 py-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#d9f2e1] text-[#0a773a]"><Bell className="size-4" /></span>
              <div>
                <p className="text-sm font-bold text-[#17452a]">Make this your household agent</p>
                <p className="mt-1 text-xs leading-5 text-[#52705d]">Sign in so Supermarket.ie can remember your household, prepare your shop and keep watch for useful changes.</p>
                <Link href="/list/request" className="mt-3 inline-flex rounded-full bg-[#0b1710] px-4 py-2 text-xs font-bold text-white">Sign in free</Link>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[#edf0ed] bg-white p-3 sm:p-4">
        <AgentComposer input={input} setInput={setInput} send={send} busy={busy} gated={showGuestGate} />
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
    return null;
  }

  return <ShoppingAgentInner saved={loaded.saved} storageKey={loaded.storageKey} isGuest={isGuest} />;
}
