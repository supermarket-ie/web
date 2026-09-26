'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useEveAgent, type EveMessage } from 'eve/react';
import {
  ArrowUp,
  Bell,
  ClipboardList,
  Flame,
  Eye,
  MessageSquarePlus,
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
  isGuestClarification,
  isPersistentGuestRequest,
  signupPromptFor,
  visibleAgentText,
  type CatalogueSuggestionProduct,
  type SignupPrompt,
} from '@/lib/agent-suggestions';
import type { MarketStarter, MarketStarterIcon } from '@/lib/market-starters';
import { HouseholdShopCard, householdShopFromPart } from '@/components/HouseholdShopCard';
import { archivedConversationResumePrompt } from '@/lib/conversation-migration';
import { takeAgentLandingHandoff } from '@/lib/agent-landing-handoff';
import { agentMessageBlocks } from '@/lib/agent-message-format';

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
  conversationId?: string | null;
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

function householdShops(message: EveMessage) {
  return message.parts.flatMap(part => {
    const shop = householdShopFromPart(part);
    return shop ? [shop] : [];
  });
}

function FormattedAgentText({ text }: { text: string }) {
  const blocks = agentMessageBlocks(visibleAgentText(text));

  const inlineText = (value: string) => value.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : <span key={index}>{part}</span>
  );

  return (
    <div className="space-y-3">
      {blocks.map((block, blockIndex) => block.type === 'table' ? (
        <div key={blockIndex} className="overflow-x-auto rounded-xl border border-[#dfe5e0] bg-white">
          <table className="w-full min-w-[360px] border-collapse text-left text-sm">
            <thead className="bg-[#f6f8f6] text-[#26342b]">
              <tr>{block.headers.map((header, index) => <th key={index} className="border-b border-[#dfe5e0] px-3 py-2 font-semibold">{inlineText(header)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-[#edf0ed] last:border-0">
                  {block.headers.map((_, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top">{inlineText(row[cellIndex] ?? '')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p key={blockIndex} className="whitespace-pre-wrap">{inlineText(block.text)}</p>)}
    </div>
  );
}

type ComposerProps = {
  input: string;
  setInput: (value: string) => void;
  send: (value: string, source: AgentStartSource) => Promise<void>;
  busy: boolean;
  gated: boolean;
  placeholder: string;
  prominent?: boolean;
};

type AgentStartSource = 'typed' | 'starter' | 'predictive' | 'landing_page';
type SignupPlacement = 'first_answer' | 'guest_gate';

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
        <p className="mt-1 text-xs leading-5 text-[#52705d]">Open the secure link we sent to {email.trim()} to continue this conversation. It is valid for 30 minutes. Check your Updates or spam folder if you cannot see it.</p>
        <button type="button" onClick={() => setStatus('idle')} className="mt-3 text-xs font-semibold text-[#17452a] underline underline-offset-2">Wrong address or no email? Try again</button>
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

function AgentComposer({ input, setInput, send, busy, gated, placeholder, prominent = false }: ComposerProps) {
  return (
    <form
      onSubmit={event => { event.preventDefault(); void send(input, 'typed'); }}
      className={`relative rounded-[1.35rem] border bg-white shadow-[0_14px_45px_rgba(26,54,39,0.08)] transition-shadow focus-within:shadow-[0_18px_60px_rgba(26,54,39,0.13)] ${prominent ? 'min-h-20' : 'min-h-14'}`}
      style={{ borderColor: 'rgba(20, 46, 31, 0.12)' }}
    >
      <textarea
        aria-label="Tell your agent what to change"
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
        placeholder={gated ? 'Sign in to keep working with your agent…' : placeholder}
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

function ShoppingAgentInner({
  saved,
  storageKey,
  isGuest,
  primaryHeading,
  signedInEmptyState,
  onJourneyStateChange,
  initialConversationId,
  onNewChat,
}: {
  saved: SavedEveChat;
  storageKey: string | null;
  isGuest: boolean;
  primaryHeading: boolean;
  signedInEmptyState?: { eyebrow: string; title: string; description: string };
  onJourneyStateChange?: (state: HomePlannerJourneyState) => void;
  initialConversationId?: string | null;
  onNewChat?: () => void;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [catalogueSuggestions, setCatalogueSuggestions] = useState<CatalogueSuggestionProduct[]>([]);
  const [marketStarters, setMarketStarters] = useState<Starter[] | null>(null);
  const [structuredSave, setStructuredSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const scrollRef = useRef<HTMLDivElement>(null);
  const landingPromptHandled = useRef(false);
  const conversationIdRef = useRef<string | null>(initialConversationId ?? null);
  const transcriptRef = useRef<Array<{ role: string; content: string }>>([]);

  async function ensureConversation(firstMessage: string) {
    if (isGuest || conversationIdRef.current) return conversationIdRef.current;
    const response = await fetch('/api/conversations', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: firstMessage.slice(0, 72),
        messages: [{ role: 'user', content: firstMessage }],
        profile: { eve_state: { version: 1, events: [], session: null } },
      }),
    });
    if (!response.ok) return null;
    const result = await response.json() as { conversation?: { id?: string } };
    conversationIdRef.current = result.conversation?.id ?? null;
    return conversationIdRef.current;
  }

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
      const conversationId = conversationIdRef.current;
      if (!isGuest && conversationId) {
        window.setTimeout(() => {
          void fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: transcriptRef.current,
              profile: { eve_state: { version: 1, events: snapshot.events, session: snapshot.session } },
            }),
          });
        }, 0);
      }
      window.dispatchEvent(new CustomEvent('sm:eve-turn-finished'));
    },
  });

  const busy = agent.status === 'submitted' || agent.status === 'streaming';
  const messages = agent.data.messages;
  useEffect(() => {
    transcriptRef.current = messages.flatMap(message => {
      const content = messageText(message);
      return content ? [{ role: message.role, content }] : [];
    });
  }, [messages]);
  const latestStructuredShop = [...messages].reverse().flatMap(householdShops)[0] ?? null;
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
    message.role === 'assistant' && Boolean(visibleAgentText(messageText(message)))
  );
  const lastAssistantMessage = [...messages].reverse().find(message => message.role === 'assistant');
  const awaitingGuestClarification = Boolean(
    isGuest
    && guestTurns === 1
    && lastAssistantMessage
    && isGuestClarification(messageText(lastAssistantMessage))
  );
  const showSignupPrompt = isGuest && guestTurns === 1 && hasVisibleAnswer && !awaitingGuestClarification && !showGuestGate;
  const liveSuggestions = input.trim().length >= 2
    ? buildPredictiveSuggestions(input, catalogueSuggestions)
    : [];
  const hasConversation = messages.some(message => message.role === 'user');
  const hasProposedShop = Boolean(latestStructuredShop);

  useEffect(() => {
    function prefill(event: Event) {
      const value = (event as CustomEvent<string>).detail;
      if (!value) return;
      setInput(value);
      requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Tell your agent what to change"]')?.focus());
    }
    window.addEventListener('sm:agent-prefill', prefill);
    return () => window.removeEventListener('sm:agent-prefill', prefill);
  }, []);

  useEffect(() => {
    onJourneyStateChange?.({
      hasConversation,
      hasProposedShop,
    });
  }, [hasConversation, hasProposedShop, onJourneyStateChange]);

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

  useEffect(() => {
    if (isGuest || !latestStructuredShop) return;
    const saveKey = `sm_saved_household_shop:${latestStructuredShop.provenance.generated_at}`;
    if (localStorage.getItem(saveKey)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect the external persistence marker
      setStructuredSave('saved');
      return;
    }
    const controller = new AbortController();
    setStructuredSave('saving');
    fetch('/api/lists/save-from-planner', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ household_shop: latestStructuredShop }),
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Structured shop save failed');
      const result = await response.json() as { list_id: string };
      localStorage.setItem(saveKey, result.list_id);
      setStructuredSave('saved');
    }).catch(error => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStructuredSave('error');
    });
    return () => controller.abort();
  }, [isGuest, latestStructuredShop]);

  async function send(text: string, source: AgentStartSource) {
    const message = text.trim();
    if (!message || busy || showGuestGate) return;
    trackEventOnce('agent_started', {
      auth_state: isGuest ? 'guest' : 'signed_in',
      entry_path: window.location.pathname,
      prompt_source: source,
    });
    setInput('');
    setError('');
    if (!isGuest) await ensureConversation(message);
    await agent.send([{ type: 'text', text: message }]);
  }

  useEffect(() => {
    if (landingPromptHandled.current || busy) return;
    const params = new URLSearchParams(window.location.search);
    const archivedConversationId = params.get('resume_conversation')?.trim();
    const draft = params.get('agent_draft') === 'weekly-shop' ? takeAgentLandingHandoff() : null;
    const requestedPrompt = draft?.prompt ?? params.get('agent_prompt')?.trim();
    const prompt = archivedConversationId
      ? archivedConversationResumePrompt(archivedConversationId, requestedPrompt)
      : requestedPrompt;
    if (!prompt) return;

    const landingPath = draft?.landingPath ?? params.get('agent_landing');

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
      <div className={`flex flex-col bg-transparent px-5 py-6 sm:px-8 sm:py-8 ${primaryHeading ? 'min-h-[590px]' : 'min-h-[440px]'}`}>
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
          <div className="mb-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#397250]">
              <span className="flex size-7 items-center justify-center rounded-full bg-[#daf2e2]"><Sparkles className="size-4" /></span>
              {isGuest ? 'Ready when you are' : signedInEmptyState?.eyebrow ?? 'Your agent is ready'}
            </div>
            {primaryHeading ? (
              <h1 className="max-w-xl text-balance text-[1.75rem] font-bold tracking-[-0.045em] text-[#152219] sm:text-[2.25rem]">{isGuest ? 'Meet your supermarket agent' : signedInEmptyState?.title ?? 'What should we sort out for the household?'}</h1>
            ) : (
              <h2 className="max-w-xl text-balance text-[1.75rem] font-bold tracking-[-0.045em] text-[#152219] sm:text-[2.25rem]">
                {isGuest ? 'Meet your supermarket agent' : 'What should we sort out for the household?'}
              </h2>
            )}
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667169]">
              {isGuest
                ? 'Thousands of tracked Irish supermarket prices and ingredient mappings.'
                : signedInEmptyState?.description ?? 'Ask your agent to prepare, review or update the shop around your household.'}
            </p>
          </div>

          <AgentComposer
            input={input}
            setInput={setInput}
            send={send}
            busy={busy}
            gated={showGuestGate}
            placeholder={isGuest
              ? 'Ask about products, prices, meals, dietary needs or your household shop.'
              : 'Ask Supermarket.ie what your household needs…'}
            prominent
          />

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
    <div className={`flex max-h-[68vh] flex-col bg-white/88 backdrop-blur-[2px] ${primaryHeading ? 'min-h-[590px]' : 'min-h-[470px]'}`}>
      {primaryHeading && <h1 className="sr-only">Your agent</h1>}
      {!isGuest && onNewChat && (
        <div className="flex justify-end border-b border-[#edf0ed] px-4 py-2">
          <button type="button" onClick={onNewChat} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-[#376047] transition hover:bg-[#eef7f0]">
            <MessageSquarePlus className="size-3.5" /> New chat
          </button>
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-6 sm:px-7">
        {messages.map(message => {
          const text = messageText(message);
          const shops = householdShops(message);
          if (!text && shops.length === 0) return null;
          const isUser = message.role === 'user';
          return (
            <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'} ${shops.length > 0 ? 'items-start' : ''}`}>
              {!isUser && <div className="mr-2 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#e5f7eb] text-[11px] font-bold text-[#0a773a]">S</div>}
              <div className={`${shops.length > 0 ? 'w-full max-w-[calc(100%_-_2.25rem)] space-y-3' : 'max-w-[86%]'} ${shops.length === 0 ? `rounded-2xl px-4 py-3 text-sm leading-6 ${isUser ? 'rounded-br-md bg-[#122018] text-white' : 'rounded-bl-md bg-[#f1f3f1] text-[#39443d]'}` : ''}`}>
                {text && (
                  <div className={shops.length > 0 ? 'rounded-2xl rounded-bl-md bg-[#f1f3f1] px-4 py-3 text-sm leading-6 text-[#39443d]' : ''}>
                    {isUser ? <p className="whitespace-pre-wrap">{text}</p> : <FormattedAgentText text={text} />}
                  </div>
                )}
                {shops.map((shop, index) => <HouseholdShopCard key={`${message.id}:shop:${index}`} shop={shop} />)}
              </div>
            </div>
          );
        })}

        {showSignupPrompt && (
          <div className="ml-9 rounded-2xl border border-[#dbe9df] bg-[#f5faf6] px-4 py-4 sm:px-5">
            <InlineEmailSignup prompt={signupPrompt} placement="first_answer" intent={firstRequestIntent} />
          </div>
        )}

        {!isGuest && latestStructuredShop && structuredSave !== 'idle' && (
          <div className={`ml-9 rounded-xl px-3 py-2 text-xs ${structuredSave === 'error' ? 'bg-red-50 text-red-800' : 'bg-[#eef8f1] text-[#27643d]'}`}>
            {structuredSave === 'saving' && 'Saving this validated household shop…'}
            {structuredSave === 'saved' && 'Saved to your household lists with current validated prices.'}
            {structuredSave === 'error' && 'This shop is still here, but it could not be saved. Please try again.'}
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

      {busy && (
        <div role="status" aria-live="polite" className="flex shrink-0 items-center gap-2 border-t border-[#edf0ed] bg-[#f7faf7] px-5 py-2 text-xs font-medium text-[#5f6e63] sm:px-7">
          <span className="flex gap-1" aria-hidden="true">
            {[0, 1, 2].map(i => <span key={i} className="size-1.5 animate-bounce rounded-full bg-[#0a8f45]" style={{ animationDelay: `${i * 140}ms` }} />)}
          </span>
          Working on that…
        </div>
      )}

      <div className="border-t border-[#edf0ed] bg-white p-3 sm:p-4">
        <AgentComposer
          input={input}
          setInput={setInput}
          send={send}
          busy={busy}
          gated={showGuestGate}
          placeholder={isGuest
            ? 'Ask about products, prices, meals, dietary needs or your household shop.'
            : 'Ask Supermarket.ie what your household needs…'}
        />
      </div>
    </div>
  );
}

export type HomePlannerJourneyState = {
  hasConversation: boolean;
  hasProposedShop: boolean;
};

export function HomePlanner({
  onJourneyStateChange,
  primaryHeading = false,
  signedInEmptyState,
}: {
  onJourneyStateChange?: (state: HomePlannerJourneyState) => void;
  primaryHeading?: boolean;
  signedInEmptyState?: { eyebrow: string; title: string; description: string };
} = {}) {
  const [loaded, setLoaded] = useState<LoadedEveChat | null>(null);
  const [isGuest, setIsGuest] = useState(true);
  const [chatKey, setChatKey] = useState(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const guest = !loadSession()?.token;
      setIsGuest(guest);
      if (guest) {
        setLoaded(loadSavedEveChat());
        return;
      }
      const local = loadSavedEveChat();
      const params = new URLSearchParams(window.location.search);
      if (params.get('new_chat') === '1') {
        if (local.storageKey) localStorage.removeItem(local.storageKey);
        window.history.replaceState({}, '', window.location.pathname);
        setLoaded({ saved: {}, storageKey: local.storageKey, conversationId: null });
        return;
      }
      const requestedId = params.get('chat');
      fetch('/api/conversations', { credentials: 'same-origin' })
        .then(response => response.ok ? response.json() : Promise.reject(new Error('Could not load chats')))
        .then(async (data: { conversations?: Array<{ id: string; agent_chat?: boolean }> }) => {
          const selected = requestedId
            ? data.conversations?.find(item => item.id === requestedId && item.agent_chat)
            : data.conversations?.find(item => item.agent_chat);
          if (!selected) return local;
          const response = await fetch(`/api/conversations/${encodeURIComponent(selected.id)}`, { credentials: 'same-origin' });
          if (!response.ok) return local;
          const detail = await response.json() as { conversation?: { profile?: { eve_state?: SavedEveChat } } };
          const saved = detail.conversation?.profile?.eve_state;
          return saved ? { saved, storageKey: local.storageKey, conversationId: selected.id } : local;
        })
        .then(setLoaded)
        .catch(() => setLoaded(local));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <ShoppingAgentInner
      saved={loaded.saved}
      storageKey={loaded.storageKey}
      isGuest={isGuest}
      primaryHeading={primaryHeading}
      signedInEmptyState={signedInEmptyState}
      onJourneyStateChange={onJourneyStateChange}
      initialConversationId={loaded.conversationId}
      onNewChat={isGuest ? undefined : () => {
        if (loaded.storageKey) localStorage.removeItem(loaded.storageKey);
        window.history.replaceState({}, '', window.location.pathname);
        setLoaded({ saved: {}, storageKey: loaded.storageKey, conversationId: null });
        setChatKey(value => value + 1);
      }}
      key={chatKey}
    />
  );
}
