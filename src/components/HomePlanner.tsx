'use client';
import { useState, useRef, useEffect } from 'react';
import { saveSession, loadSession } from '@/lib/session';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';

const EXAMPLES = [
  "Spaghetti bolognese, chicken stir fry, packed lunches",
  "Sunday roast, midweek pasta, fish on Friday",
  "Healthy week — salads, grilled chicken, overnight oats",
  "Quick & easy — stir fries, soup, toasties",
  "Vegetarian week — curries, pasta, veggie burgers",
  "Kids' favourites — fish fingers, pasta bake, homemade pizza",
  "Batch cooking — big chilli, soups, meal prep for work lunches",
  "Low carb — grilled meats, salads, stir fries without rice",
  "Irish classics — stew, shepherd's pie, sausage casserole",
  "Budget week — eggs, beans, lentils, simple pasta dishes",
  "Date night in — steak, salmon fillet, homemade curry",
  "BBQ weekend — burgers, chicken wings, coleslaw, potato salad",
];

const PROGRESS_MESSAGES = [
  "Checking this week's promotions...",
  "Scanning categories...",
  "Comparing prices across stores...",
  "Building your list...",
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface StoreTotal {
  store: string;
  total: number;
  cheapest?: boolean;
}

interface PromotionDeal {
  product_name: string;
  store: string;
  price: number;
  was_price: number;
  saving: number;
}

interface HistoryItem {
  name: string;
  store: string;
  last_date: string;
}

// Animated price component for savings animation (Feature 7)
function AnimatedPrice({ target, duration = 1000 }: { target: number; duration?: number }) {
  const [current, setCurrent] = useState(0);
  const animatedRef = useRef(false);

  useEffect(() => {
    if (animatedRef.current) return;
    animatedRef.current = true;

    let startTime: number;
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCurrent(target * progress);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setCurrent(target);
      }
    };
    requestAnimationFrame(animate);
  }, [target, duration]);

  return <span>€{current.toFixed(2)}</span>;
}

function EmailCaptureCard({ householdSize, onSuccess, onDismiss, session }: {
  householdSize: number;
  onSuccess: () => void;
  onDismiss: () => void;
  session: { token: string } | null;
}) {
  const [email, setEmail] = useState('');
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setEmailSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), familySize: String(householdSize) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      if (data.token) {
        saveSession({
          token: data.token,
          familySize: String(householdSize),
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
        });
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setEmailSubmitting(false);
    }
  }

  async function handleSaveToList() {
    if (!session?.token) return;
    setEmailSubmitting(true);
    try {
      const res = await fetch('/api/lists/save-from-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.token }),
      });
      if (res.ok) {
        onSuccess();
      }
    } catch (err) {
      setError('Failed to save list');
    } finally {
      setEmailSubmitting(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl p-4" style={{
      background: 'var(--primary-fixed)',
      border: '1px solid rgba(0, 106, 53, 0.1)'
    }}>
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0">📩</span>
        <div className="flex-1">
          <div className="font-bold text-sm mb-1" style={{ color: 'var(--on-primary-container)' }}>
            Get this list emailed to you — we'll update your prices every Monday.
          </div>

          {session ? (
            <button
              onClick={handleSaveToList}
              disabled={emailSubmitting}
              className="btn-primary px-4 py-2 text-sm font-semibold rounded-xl disabled:opacity-60"
            >
              {emailSubmitting ? 'Saving...' : 'Save to my list →'}
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="flex gap-2 mt-2">
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 px-3 py-2 rounded-xl focus:outline-none text-sm min-w-0"
                style={{
                  background: 'var(--surface-container-lowest)',
                  color: 'var(--on-background)',
                  border: '1px solid var(--surface-container)'
                }}
              />
              <button
                type="submit"
                disabled={emailSubmitting}
                className="btn-primary flex-shrink-0 px-4 py-2 text-sm whitespace-nowrap disabled:opacity-60"
              >
                {emailSubmitting ? 'Saving...' : 'Save my list →'}
              </button>
            </form>
          )}

          {error && (
            <p className="text-xs text-red-600 mt-1">{error}</p>
          )}

          <button
            onClick={onDismiss}
            className="text-xs mt-2 transition"
            style={{ color: 'var(--on-surface-variant)' }}
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}

// Share button component (Feature 2)
function ShareButton({ lastMessage }: { lastMessage: string }) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    try {
      // Strip markdown bold formatting
      const plainText = lastMessage
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1');

      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  return (
    <button
      onClick={handleShare}
      className="btn-secondary px-4 py-2 text-sm font-semibold rounded-xl flex items-center gap-2 transition-opacity"
      style={{ opacity: copied ? 0.6 : 1 }}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
      </svg>
      {copied ? 'Copied!' : 'Share'}
    </button>
  );
}

// Return visitor welcome card (Feature 5)
function WelcomeBackCard({ items, onUpdateList, onStartFresh }: {
  items: HistoryItem[];
  onUpdateList: () => void;
  onStartFresh: () => void;
}) {
  const itemNames = items.slice(0, 3).map(item => item.name);

  return (
    <div className="mb-4 rounded-2xl p-4" style={{
      background: 'var(--surface-container-lowest)',
      border: '1px solid var(--surface-container)'
    }}>
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0">👋</span>
        <div className="flex-1">
          <div className="font-bold text-sm mb-2" style={{ color: 'var(--on-background)' }}>
            Welcome back! Last time you shopped for {itemNames.join(', ')}...
          </div>
          <p className="text-sm mb-3" style={{ color: 'var(--on-surface)' }}>
            Want to update your list or start fresh?
          </p>
          <div className="flex gap-2">
            <button
              onClick={onUpdateList}
              className="btn-primary px-4 py-2 text-sm rounded-xl"
            >
              Update my list
            </button>
            <button
              onClick={onStartFresh}
              className="btn-secondary px-4 py-2 text-sm rounded-xl"
            >
              Start fresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Preview mockup component (Feature 6)
function PreviewMockup() {
  return (
    <div className="mt-6 opacity-50">
      <p className="type-label mb-2" style={{ color: 'var(--on-surface)' }}>Example result</p>
      <div className="rounded-xl p-4" style={{ background: 'var(--surface-container)' }}>
        <div className="text-sm space-y-2 mb-3">
          <div className="flex justify-between">
            <span>Chicken breast</span>
            <span className="price">€4.99</span>
          </div>
          <div className="flex justify-between">
            <span>Pasta</span>
            <span className="price">€1.29</span>
          </div>
          <div className="flex justify-between">
            <span>Tomato sauce</span>
            <span className="price">€0.89</span>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="px-2 py-1 rounded text-xs text-white" style={{ background: storeStyle('tesco').bg }}>
            Tesco €15.20
          </div>
          <div className="px-2 py-1 rounded text-xs text-white" style={{ background: storeStyle('dunnes').bg }}>
            Dunnes €16.40
          </div>
        </div>
      </div>
    </div>
  );
}

function parseStoreTotals(content: string): StoreTotal[] {
  const lines = content.split('\n');
  const totals: StoreTotal[] = [];
  let inStoreSection = false;

  for (const line of lines) {
    // Look for store totals section
    if (line.toLowerCase().includes('store total') || line.toLowerCase().includes('best value')) {
      inStoreSection = true;
      continue;
    }

    // Stop parsing after store section
    if (inStoreSection && line.trim() === '') {
      break;
    }

    if (inStoreSection) {
      // Match patterns like "Tesco: €45.67" or "**Tesco**: €45.67"
      const match = line.match(/\*?\*?(tesco|dunnes|supervalu)\*?\*?:?\s*€?(\d+(?:\.\d{2})?)/i);
      if (match) {
        const store = match[1].toLowerCase();
        const total = parseFloat(match[2]);
        if (!isNaN(total)) {
          totals.push({ store, total });
        }
      }
    }
  }

  // Mark cheapest
  if (totals.length > 0) {
    const cheapest = totals.reduce((min, curr) => curr.total < min.total ? curr : min);
    cheapest.cheapest = true;
  }

  return totals;
}

function FormattedMessage({ content }: { content: string }) {
  if (!content) return null;

  const storeTotals = parseStoreTotals(content);
  const lines = content.split('\n');

  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;

        // Headers
        if (line.startsWith('### ')) {
          return (
            <h4 key={i} className="font-bold text-base mt-4 mb-2" style={{ color: 'var(--on-background)' }}>
              {line.slice(4)}
            </h4>
          );
        }

        // Bold category headers
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
          return (
            <h5 key={i} className="type-label mt-3 mb-1" style={{ color: 'var(--on-background)' }}>
              {line.slice(2, -2)}
            </h5>
          );
        }

        // List items
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <p key={i} className="text-sm leading-relaxed pl-4" style={{ color: 'var(--on-surface)' }}>
              {line.slice(2)}
            </p>
          );
        }

        // Horizontal rules
        if (line.startsWith('---')) {
          return <hr key={i} className="my-3" style={{ borderColor: 'var(--outline-variant)' }} />;
        }

        // Tips
        if (line.startsWith('💡')) {
          return (
            <div key={i} className="mt-3 p-3 rounded-xl" style={{ background: 'var(--primary-fixed)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--on-primary-container)' }}>
                {line}
              </p>
            </div>
          );
        }

        return (
          <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--on-surface)' }}>
            {line}
          </p>
        );
      })}

      {/* Store totals cards with animation (Feature 7) */}
      {storeTotals.length > 0 && (
        <div className="mt-4 space-y-2">
          <h5 className="type-label" style={{ color: 'var(--on-background)' }}>STORE TOTALS</h5>
          <div className="flex flex-wrap gap-2">
            {storeTotals.map((total, i) => (
              <div
                key={i}
                className="px-3 py-2 rounded-xl text-white text-sm font-bold flex items-center gap-2"
                style={{ background: storeStyle(total.store).bg }}
              >
                <span>{storeDisplayName(total.store)}</span>
                {total.cheapest ? (
                  <AnimatedPrice target={total.total} />
                ) : (
                  <span className="price">€{total.total.toFixed(2)}</span>
                )}
                {total.cheapest && (
                  <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">
                    Cheapest
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StreamingIndicator({ currentMessage }: { currentMessage: string }) {
  return (
    <div className="flex justify-start">
      <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>
        S
      </div>
      <div className="rounded-2xl rounded-bl-sm px-3 py-2 text-sm" style={{
        background: 'var(--surface-container-lowest)',
        border: '1px solid var(--surface-container)'
      }}>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[0, 150, 300].map(delay => (
              <span
                key={delay}
                className="w-1.5 h-1.5 rounded-full animate-bounce"
                style={{
                  background: 'var(--primary)',
                  animationDelay: `${delay}ms`
                }}
              />
            ))}
          </div>
          <span style={{ color: 'var(--on-surface)' }}>{currentMessage}</span>
        </div>
      </div>
    </div>
  );
}

export function HomePlanner() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [householdSize, setHouseholdSize] = useState(2);
  const [session, setSession] = useState<{ token: string } | null>(null);
  const [showEmailCapture, setShowEmailCapture] = useState(false);
  const [emailCaptured, setEmailCaptured] = useState(false);
  const [exampleOffset, setExampleOffset] = useState(0);
  const [progressMessageIndex, setProgressMessageIndex] = useState(0);

  // Feature 1: Pre-fetch promotions
  const promotionsCache = useRef<PromotionDeal[] | null>(null);

  // Feature 5: Return visitor recognition
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (s) {
      setSession(s);
      setEmailCaptured(true);

      // Feature 5: Fetch user history for returning visitors
      fetch(`/api/list/history?token=${s.token}`)
        .then(res => res.json())
        .then(data => {
          if (data.items && data.items.length > 0) {
            setHistoryItems(data.items);
            setShowWelcomeBack(true);
          }
        })
        .catch(() => {}); // Fail silently
    }

    // Feature 1: Pre-fetch promotions on mount
    fetch('/api/promotions')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          promotionsCache.current = data;
        }
      })
      .catch(() => {}); // Fail silently
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom when messages update
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    // Rotate progress messages while loading
    if (isLoading) {
      const interval = setInterval(() => {
        setProgressMessageIndex(i => (i + 1) % PROGRESS_MESSAGES.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [isLoading]);

  async function sendMessage(userText: string) {
    if (!userText.trim() || isLoading) return;

    setStarted(true);
    setProgressMessageIndex(0);

    const newMessages: Message[] = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    abortRef.current = new AbortController();

    try {
      const body: any = {
        messages: newMessages,
        householdSize
      };

      // Feature 1: Include cached promotions if available
      if (promotionsCache.current && promotionsCache.current.length > 0) {
        body.cachedPromotions = promotionsCache.current;
      }

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error('Request failed');
      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      // Add placeholder message
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('0:"') && trimmed.endsWith('"')) {
            try {
              const jsonStr = trimmed.slice(2); // strip leading '0:'
              const text = JSON.parse(jsonStr);
              assistantContent += text;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
                return updated;
              });
            } catch {}
          }
        }
      }

      // Show email capture after first substantial response
      const isSubstantialResponse = assistantContent.length > 200 ||
                                  assistantContent.includes('🛒') ||
                                  assistantContent.includes('Store totals');

      if (!session && !emailCaptured && isSubstantialResponse && messages.length === 0) {
        setTimeout(() => setShowEmailCapture(true), 800);
      }

    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.'
        }]);
      }
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleExampleClick(example: string) {
    setInput(example);
    inputRef.current?.focus();
  }

  // Feature 4: Deals CTA handler
  function handleDealsClick() {
    sendMessage('Show me the best deals this week. What\'s on promotion across all stores?');
  }

  // Feature 5: Welcome back handlers
  function handleUpdateList() {
    const itemNames = historyItems.map(item => item.name).join(', ');
    sendMessage(`Update my previous list with this week's best prices. I last bought: ${itemNames}`);
    setShowWelcomeBack(false);
  }

  function handleStartFresh() {
    setShowWelcomeBack(false);
  }

  // Check if we should show share button (Feature 2)
  const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant')?.content || '';
  const showShareButton = !isLoading && lastAssistantMessage && (
    lastAssistantMessage.includes('🛒') || lastAssistantMessage.length > 100
  );

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto">
      {/* Welcome back card (Feature 5) */}
      {showWelcomeBack && historyItems.length > 0 && (
        <WelcomeBackCard
          items={historyItems}
          onUpdateList={handleUpdateList}
          onStartFresh={handleStartFresh}
        />
      )}

      {/* Messages area */}
      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 mb-4 overflow-y-auto"
          style={{ maxHeight: '60vh' }}
        >
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>
                  S
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                  m.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'
                }`}
                style={m.role === 'user'
                  ? { background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)' }
                  : { background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }
                }
              >
                {m.role === 'assistant' ? <FormattedMessage content={m.content} /> : <p>{m.content}</p>}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <StreamingIndicator currentMessage={PROGRESS_MESSAGES[progressMessageIndex]} />
          )}
        </div>
      )}

      {/* Email capture with share button (Feature 2) */}
      {showEmailCapture && !emailCaptured && (
        <div className="flex flex-col gap-2">
          <EmailCaptureCard
            householdSize={householdSize}
            session={session}
            onSuccess={() => {
              setEmailCaptured(true);
              setShowEmailCapture(false);
              const s = loadSession();
              if (s) setSession(s);
            }}
            onDismiss={() => {
              setShowEmailCapture(false);
              setEmailCaptured(true);
            }}
          />
          {showShareButton && (
            <div className="flex justify-end">
              <ShareButton lastMessage={lastAssistantMessage} />
            </div>
          )}
        </div>
      )}

      {/* Share button when no email capture (Feature 2) */}
      {!showEmailCapture && showShareButton && (
        <div className="flex justify-end mb-4">
          <ShareButton lastMessage={lastAssistantMessage} />
        </div>
      )}

      {/* Feature 6: Preview mockup (only before conversation starts) */}
      {!started && <PreviewMockup />}

      {/* Input section with sticky behavior (Feature 3) */}
      <div className="sticky bottom-0 z-10 pt-4" style={{
        background: 'linear-gradient(to bottom, rgba(var(--surface-rgb), 0) 0%, var(--surface) 20%)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)'
      }}>
        <div className="rounded-t-xl" style={{ background: 'var(--surface)' }}>
          {/* Feature 4: Zero-input deals CTA */}
          {!started && (
            <div className="mb-4">
              <button
                onClick={handleDealsClick}
                className="w-full px-6 py-4 rounded-xl font-semibold text-lg mb-4"
                style={{
                  background: 'var(--primary-fixed)',
                  color: 'var(--on-primary-container)'
                }}
              >
                See this week's deals →
              </button>
            </div>
          )}

          {/* Example prompts (only show before conversation starts) */}
          {!started && (
            <div className="mb-4">
              <div className="flex flex-wrap gap-2 mb-2">
                {EXAMPLES.slice(exampleOffset, exampleOffset + 4).map(example => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => handleExampleClick(example)}
                    className="text-xs px-3 py-2 rounded-full transition-all"
                    style={{
                      background: 'var(--surface-container)',
                      color: 'var(--on-surface)'
                    }}
                  >
                    {example.length > 42 ? example.slice(0, 42) + '…' : example}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setExampleOffset(o => (o + 4) % EXAMPLES.length)}
                className="text-xs transition flex items-center gap-1 font-medium"
                style={{ color: 'var(--on-surface)' }}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                More ideas
              </button>
            </div>
          )}

          {/* Household size selector */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm font-medium" style={{ color: 'var(--on-surface)' }}>People:</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setHouseholdSize(n)}
                  className="w-8 h-8 rounded-lg text-sm font-bold transition-all"
                  style={householdSize === n
                    ? { background: 'var(--primary)', color: 'var(--on-primary)' }
                    : { background: 'var(--surface-container)', color: 'var(--on-surface)' }
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Chat input */}
          <form onSubmit={handleSubmit} className="relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder={started ? "Add a meal, go vegetarian, change quantities…" : "What are you cooking this week?"}
              rows={2}
              className="w-full px-4 py-3 pr-12 rounded-xl focus:outline-none text-sm resize-none transition"
              style={{
                background: 'var(--surface-container-highest)',
                color: 'var(--on-background)',
                border: '2px solid transparent'
              }}
              onFocus={e => {
                e.currentTarget.style.background = 'var(--surface-container-lowest)';
                e.currentTarget.style.borderColor = 'rgba(0,106,53,0.4)';
              }}
              onBlur={e => {
                e.currentTarget.style.background = 'var(--surface-container-highest)';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="absolute right-3 bottom-3 w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}
            >
              {isLoading ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="white" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              )}
            </button>
          </form>

          <p className="text-xs mt-2 text-center" style={{ color: 'var(--on-surface-variant)' }}>
            Prices from Tesco, Dunnes & SuperValu · Free to use
          </p>
        </div>
      </div>
    </div>
  );
}