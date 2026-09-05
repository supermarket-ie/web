'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useEveAgent } from 'eve/react';
import {
  ArrowUp,
  Bell,
  ClipboardList,
  Flame,
  Eye,
  Search,
  ShoppingBasket,
  Sparkles,
  Utensils,
  WalletCards,
} from 'lucide-react';
import { loadSession } from '@/lib/session';
import { getAnalyticsSessionId, trackEvent, trackEventOnce } from '@/lib/analytics';
import {
  buildPredictiveSuggestions,
  inferSuggestionIntent,
  type CatalogueSuggestionProduct,
} from '@/lib/agent-suggestions';
import type { MarketStarter, MarketStarterIcon } from '@/lib/market-starters';

const LEGACY_EVE_CHAT_KEY = 'sm_eve_household_chat_v1';
const GUEST_EVE_CHAT_KEY = `${LEGACY_EVE_CHAT_KEY}:guest`;

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
  { label: 'What offers are genuinely useful today?', detail: 'Check verified current promotions across Irish supermarkets', prompt: 'Show me the most useful current supermarket offers for a household shop', icon: Flame },
  { label: 'Where are everyday essentials best value?', detail: 'Compare current matched products across stores', prompt: 'Compare current prices for useful everyday household essentials', icon: Search },
  { label: 'Plan dinners around current value', detail: 'Use available products and practical reusable ingredients', prompt: 'Plan four practical dinners around products that are good value now', icon: Utensils },
  { label: 'Build a complete value-led shop', detail: 'Balance food, cleaning and toiletries in one shop', prompt: 'Build a sensible complete household shop using current supermarket value', icon: WalletCards },
];

const MARKET_STARTER_ICONS: Record<MarketStarterIcon, Starter['icon']> = {
  offer: Flame,
  compare: Search,
  meal: Utensils,
  shop: ShoppingBasket,
};

function asStarters(items: MarketStarter[]): Starter[] {
  return items.map(item => ({
    label: item.label,
    detail: item.detail,
    prompt: item.prompt,
    icon: MARKET_STARTER_ICONS[item.icon],
  }));
}

const HOUSEHOLD_STARTERS: Starter[] = [
  { label: 'Prepare my usual shop', detail: 'Use what your household is likely to need now', prompt: 'Prepare my usual shop', icon: ShoppingBasket },
  { label: 'What is worth knowing?', detail: 'Surface useful changes from this week', prompt: 'What have you noticed this week?', icon: Sparkles },
  { label: 'Keep my shop under €120', detail: 'Review your current shop against the budget', prompt: 'Keep my shop under €120', icon: ClipboardList },
  { label: 'Show what you are watching', detail: 'Review active product watches and reminders', prompt: 'Show me what you are watching', icon: Eye },
];

function scopedEveChatKey(): string | null {
  const email = loadSession()?.email?.trim().toLowerCase();
  return email ? `${LEGACY_EVE_CHAT_KEY}:${encodeURIComponent(email)}` : null;
}

function loadSavedEveChat(): LoadedEveChat {
  try {
    localStorage.removeItem(LEGACY_EVE_CHAT_KEY);
    const storageKey = scopedEveChatKey();

    if (!storageKey) {
      const guestRaw = localStorage.getItem(GUEST_EVE_CHAT_KEY);
      return {
        saved: guestRaw ? JSON.parse(guestRaw) as SavedEveChat : {},
        storageKey: GUEST_EVE_CHAT_KEY,
      };
    }

    const accountRaw = localStorage.getItem(storageKey);
    if (accountRaw) {
      return { saved: JSON.parse(accountRaw) as SavedEveChat, storageKey };
    }

    const guestRaw = localStorage.getItem(GUEST_EVE_CHAT_KEY);
    if (guestRaw) {
      localStorage.setItem(storageKey, guestRaw);
      localStorage.removeItem(GUEST_EVE_CHAT_KEY);
      return { saved: JSON.parse(guestRaw) as SavedEveChat, storageKey };
    }

    return { saved: {}, storageKey };
  } catch {
    return { saved: {}, storageKey: scopedEveChatKey() ?? GUEST_EVE_CHAT_KEY };
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
  send: (value: string, source: AgentStartSource) => Promise<void>;
  busy: boolean;
  gated: boolean;
  prominent?: boolean;
};

type AgentStartSource = 'typed' | 'starter' | 'predictive' | 'landing_page';
type SignupPlacement = 'first_answer' | 'guest_gate';

type SignupPrompt = {
  title: string;
  description: string;
};

function signupPromptFor(request: string): SignupPrompt {
  const intent = inferSuggestionIntent(request);

  if (isPersistentGuestRequest(request)) {
    return {
      title: 'Keep this active with your agent',
      description: 'Add your email so Supermarket.ie can remember this request, keep watching it and pick it up again without starting over.',
    };
  }

  if (intent === 'meal') {
    return {
      title: 'Keep this meal plan',
      description: 'Save it, build the rest of your weekly shop and return without starting again.',
    };
  }

  if (intent === 'budget') {
    return {
      title: 'Remember your household budget',
      description: 'Keep this result and let your agent use the same budget when planning and reviewing future shops.',
    };
  }

  if (intent === 'dietary') {
    return {
      title: 'Remember this household requirement',
      description: 'Save it so your agent can apply it automatically when finding products and planning future shops.',
    };
  }

  if (intent === 'find' || intent === 'price' || intent === 'offer' || intent === 'compare') {
    return {
      title: 'Keep this product with your agent',
      description: 'Save this result, compare the rest of your shop and keep watch for useful price or product changes.',
    };
  }

  return {
    title: 'Make this your household agent',
    description: 'Save this result and let Supermarket.ie remember what matters, prepare future shops and keep useful changes on your radar.',
  };
}

function InlineEmailSignup({
  prompt,
  placement,
  intent,
}: {
  prompt: SignupPrompt;
  placement: SignupPlacement;
  intent: ReturnType<typeof inferSuggestionIntent>;
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'sent' | 'error'>('idle');
  const engaged = useRef(false);
  const submitted = useRef(false);

  function markEngaged() {
    if (engaged.current) return;
    engaged.current = true;
    trackEvent('signup_email_engaged', {
      entry_path: window.location.pathname,
      intent,
      placement,
      flow: 'inline_agent_continuation',
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || status === 'submitting') return;

    if (!submitted.current) {
      submitted.current = true;
      trackEvent('signup_cta_clicked', {
        entry_path: window.location.pathname,
        intent,
        placement,
        flow: 'inline_agent_continuation',
      });
      trackEvent('signup_started', {
        method: 'email',
        intent,
        placement,
        flow: 'verified_email_continuation',
      });
    }

    setStatus('submitting');
    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalizedEmail,
          familySize: '2',
          sessionId: getAnalyticsSessionId(),
        }),
      });
      if (!response.ok) {
        setStatus('error');
        submitted.current = false;
        return;
      }
      setStatus('sent');
    } catch {
      setStatus('error');
      submitted.current = false;
    }
  }

  if (status === 'sent') {
    return (
      <div>
        <p className="text-sm font-bold text-[#17452a]">Check your email</p>
        <p className="mt-1 text-xs leading-5 text-[#52705d]">Open the secure link we sent to confirm your email and continue this conversation. It is valid for 15 minutes.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-bold text-[#17452a]">{prompt.title}</p>
      <p className="mt-1 text-xs leading-5 text-[#52705d]">{prompt.description}</p>
      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          value={email}
          onFocus={markEngaged}
          onChange={event => setEmail(event.target.value)}
          placeholder="Your email address"
          autoComplete="email"
          required
          className="min-w-0 flex-1 rounded-full border border-[#cddbd1] bg-white px-4 py-2.5 text-xs text-[#1d2b22] outline-none transition focus:border-[#74a985]"
        />
        <button
          type="submit"
          disabled={!email.trim() || status === 'submitting'}
          className="rounded-full bg-[#0b1710] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {status === 'submitting' ? 'Sending…' : 'Save and continue'}
        </button>
      </form>
      <p className="mt-2 text-[10px] leading-4 text-[#789083]">No password. We’ll email a secure confirmation link.</p>
      {status === 'error' && (
        <p className="mt-2 text-xs text-red-700">We couldn’t send the confirmation email. Please check the address and try again.</p>
      )}
    </div>
  );
}

function AgentComposer({ input, setInput, send, busy, gated, prominent = false }: ComposerProps) {
  return (
    <form
      onSubmit={event => { event.preventDefault(); void send(input, 'typed'); }}
      className={`relative rounded-[1.35rem] border bg-white shadow-[0_14px_45px_rgba(26,54,39,0.08)] transition-shadow focus-within:shadow-[0_18px_60px_rgba(26,54,39,0.13)] ${prominent ? 'min-h-20' : 'min-h-14'}`}
      style={{ borderColor: 'rgba(20, 46, 31, 0.12)' }}
    >
      <textarea
        value={input}
        onChange={event => setInput(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void send(input, 'typed');
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
  const [catalogueSuggestions, setCatalogueSuggestions] = useState<CatalogueSuggestionProduct[]>([]);
  const [marketStarters, setMarketStarters] = useState<Starter[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const landingPromptHandled = useRef(false);

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
  const starters = isGuest ? (marketStarters ?? GUEST_STARTERS) : HOUSEHOLD_STARTERS;
  const isEmpty = messages.length === 0;
  const firstUserRequest = messages.find(message => message.role === 'user');
  const firstRequestText = firstUserRequest ? messageText(firstUserRequest) : '';
  const firstRequestIntent = inferSuggestionIntent(firstRequestText);
  const signupPrompt = signupPromptFor(firstRequestText);
  const hasVisibleAnswer = messages.some(message =>
    message.role === 'assistant' && Boolean(messageText(message).trim())
  );
  const showSignupPrompt = isGuest && guestTurns === 1 && hasVisibleAnswer && !showGuestGate;
  const liveSuggestions = input.trim().length >= 2
    ? buildPredictiveSuggestions(input, catalogueSuggestions)
    : [];

  useEffect(() => {
    if (!isGuest) return;
    let controller = new AbortController();

    function loadMarketStarters() {
      controller.abort();
      controller = new AbortController();
      const rotationWindow = Math.floor(Date.now() / (10 * 60 * 1000));
      fetch(`/api/agent/starter-prompts?window=${rotationWindow}`, { signal: controller.signal })
        .then(response => response.ok ? response.json() : Promise.reject(new Error('Starter prompt request failed')))
        .then((data: { starters?: MarketStarter[] }) => {
          if (Array.isArray(data.starters) && data.starters.length > 0) {
            setMarketStarters(asStarters(data.starters));
          }
        })
        .catch(nextError => {
          if (!(nextError instanceof DOMException && nextError.name === 'AbortError')) {
            setMarketStarters(GUEST_STARTERS);
          }
        });
    }

    loadMarketStarters();
    const refreshTimer = window.setInterval(loadMarketStarters, 10 * 60 * 1000);
    return () => {
      window.clearInterval(refreshTimer);
      controller.abort();
    };
  }, [isGuest]);

  useEffect(() => {
    const intent = inferSuggestionIntent(input);
    if (input.trim().length < 2 || intent === 'meal' || intent === 'budget' || intent === 'dietary') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale catalogue results when predictive lookup is not applicable
      setCatalogueSuggestions([]);
      return;
    }

    setCatalogueSuggestions([]);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/agent/suggestions?q=${encodeURIComponent(input)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json() as { products?: CatalogueSuggestionProduct[] };
        setCatalogueSuggestions(data.products ?? []);
      } catch (nextError) {
        if (!(nextError instanceof DOMException && nextError.name === 'AbortError')) {
          setCatalogueSuggestions([]);
        }
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [input]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, busy, showGuestGate]);

  useEffect(() => {
    if (!showSignupPrompt && !showGuestGate) return;
    trackEventOnce('signup_prompt_viewed', {
      entry_path: window.location.pathname,
      intent: firstRequestIntent,
      placement: showGuestGate ? 'guest_gate' : 'first_answer',
      flow: 'inline_agent_continuation',
    });
  }, [firstRequestIntent, showGuestGate, showSignupPrompt]);

  async function send(text: string, source: AgentStartSource) {
    const message = text.trim();
    if (!message || busy || showSignupPrompt || showGuestGate) return;
    trackEventOnce('agent_started', {
      auth_state: isGuest ? 'guest' : 'signed_in',
      entry_path: window.location.pathname,
      prompt_source: source,
    });
    setInput('');
    setError('');
    await agent.send([{ type: 'text', text: message }]);
  }

  useEffect(() => {
    if (landingPromptHandled.current || busy || messages.length > 0) return;
    const params = new URLSearchParams(window.location.search);
    const prompt = params.get('agent_prompt')?.trim();
    if (!prompt) return;

    const landingPath = params.get('agent_landing');

    landingPromptHandled.current = true;
    const cleanUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, '', cleanUrl);
    trackEventOnce('agent_started', {
      auth_state: isGuest ? 'guest' : 'signed_in',
      entry_path: landingPath?.startsWith('/') ? landingPath : window.location.pathname,
      prompt_source: 'landing_page',
    });
    void agent.send([{ type: 'text', text: prompt }]);
  }, [agent, busy, isGuest, messages.length]);

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
                ? 'Thousands of tracked Irish supermarket prices and ingredient mappings.'
                : 'Ask your agent to prepare, review or update the shop around your household.'}
            </p>
          </div>

          <AgentComposer input={input} setInput={setInput} send={send} busy={busy} gated={showGuestGate} prominent />

          {liveSuggestions.length > 0 ? (
            <div className="mt-2 overflow-hidden rounded-2xl border border-[#e3e8e4] bg-white py-1 shadow-[0_18px_45px_rgba(25,57,38,0.1)]">
              {liveSuggestions.map(suggestion => (
                <button
                  key={suggestion.prompt}
                  type="button"
                  onClick={() => void send(suggestion.prompt, 'predictive')}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-[#435047] transition-colors hover:bg-[#f3f7f4] hover:text-[#142019]"
                >
                  <Search className="size-4 shrink-0 text-[#7c8980]" />
                  <span className="min-w-0">
                    <span className="block font-medium text-[#26342b]">{suggestion.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-[#879089]">{suggestion.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4">
              {isGuest && marketStarters && (
                <p className="mb-1.5 px-3.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#6e7d73]">
                  Shaped by today&apos;s verified prices and offers
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {starters.map(starter => {
                  const Icon = starter.icon;
                  return (
                    <button key={starter.prompt} type="button" onClick={() => void send(starter.prompt, 'starter')} className="group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-[#f5f8f5]">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[#e5eae6] bg-white text-[#176b3a] shadow-sm"><Icon className="size-4" /></span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-[#26342b]">{starter.label}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-[#879089]">{starter.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
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

        {showSignupPrompt && (
          <div className="ml-9 rounded-2xl border border-[#dbe9df] bg-[#f5faf6] px-4 py-4 sm:px-5">
            <InlineEmailSignup prompt={signupPrompt} placement="first_answer" intent={firstRequestIntent} />
          </div>
        )}

        {busy && !hasVisibleAnswer && (
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
              <div className="min-w-0 flex-1">
                <InlineEmailSignup
                  prompt={{
                    title: 'Keep working with your household agent',
                    description: 'Add your email so Supermarket.ie can remember your household, this conversation and the useful changes you want it to keep track of.',
                  }}
                  placement="guest_gate"
                  intent={firstRequestIntent}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[#edf0ed] bg-white p-3 sm:p-4">
        <AgentComposer input={input} setInput={setInput} send={send} busy={busy} gated={showGuestGate || showSignupPrompt} />
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
