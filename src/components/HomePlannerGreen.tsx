'use client';
import { useState, useRef, useEffect } from 'react';
import { saveSession, loadSession } from '@/lib/session';

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

interface Message { role: 'user' | 'assistant'; content: string; }

function SignupGate({ onSuccess, onSkip }: { onSuccess: (token: string) => void; onSkip: () => void }) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [savedToken, setSavedToken] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), familySize: '2' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      if (data.token) {
        saveSession({ token: data.token, familySize: '2', expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
        setSavedToken(data.token);
        onSuccess(data.token);
      } else {
        onSuccess('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  // Success state — show confirmation with link to list
  if (savedToken) {
    return (
      <div className="mt-3 rounded-2xl p-4" style={{ background: 'var(--surface-container-low)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
        <div className="flex items-start gap-2.5">
          <span className="text-xl flex-shrink-0">✅</span>
          <div>
            <div className="font-bold text-sm" style={{ color: 'var(--on-background)' }}>List saved!</div>
            <div className="text-xs mt-0.5 mb-3" style={{ color: 'var(--on-surface)' }}>We&apos;ll update your prices every week.</div>
            <a
              href={`/list?token=${savedToken}`}
              className="btn-primary inline-block px-4 py-2 text-sm font-semibold rounded-xl"
            >
              View my list →
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl p-4" style={{ background: 'var(--surface-container-low)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
      <div className="flex items-start gap-2.5 mb-3">
        <span className="text-xl flex-shrink-0">🎉</span>
        <div>
          <div className="font-bold text-sm" style={{ color: 'var(--on-background)' }}>Your list is ready!</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--on-surface)' }}>Save it free — we&apos;ll track prices and update it every week.</div>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="flex-1 px-3 py-2 rounded-xl focus:outline-none text-sm min-w-0"
          style={{ background: 'var(--surface-container-highest)', color: 'var(--on-background)' }}
          onFocus={e => { e.currentTarget.style.background = 'var(--surface-container-lowest)'; e.currentTarget.style.outline = '2px solid rgba(0,106,53,0.4)'; e.currentTarget.style.outlineOffset = '-2px'; }}
          onBlur={e =>  { e.currentTarget.style.background = 'var(--surface-container-highest)'; e.currentTarget.style.outline = 'none'; }}
        />
        <button type="submit" disabled={submitting} className="btn-primary flex-shrink-0 px-3 py-2 text-xs whitespace-nowrap disabled:opacity-60">
          {submitting ? '…' : 'Save →'}
        </button>
      </form>
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      <button onClick={onSkip} className="text-xs mt-1.5 block transition" style={{ color: 'var(--on-surface-variant)' }}>No thanks</button>
    </div>
  );
}

export function HomePlanner() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [householdSize, setHouseholdSize] = useState(2);
  const [showGate, setShowGate] = useState(false);
  const [gateDone, setGateDone] = useState(false);
  const [session, setSession] = useState<{ token: string } | null>(null);
  const [exampleOffset, setExampleOffset] = useState(0);
  const [lastPrompt, setLastPrompt] = useState('');
  const [lastItems, setLastItems] = useState<unknown[]>([]);
  const [lastStoreTotals, setLastStoreTotals] = useState<unknown[]>([]);
  const [listSaved, setListSaved] = useState(false);
  const [plannerSaved, setPlannerSaved] = useState(false);
  const [plannerSaving, setPlannerSaving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const shouldScrollRef = useRef(false);

  useEffect(() => {
    const s = loadSession();
    if (s) { setSession(s); setGateDone(true); }
  }, []);

  useEffect(() => {
    // Only scroll the chat container, and only when we explicitly want to
    if (shouldScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      shouldScrollRef.current = false;
    }
  }, [messages]);

  function parseAssistantMessageForItems(content: string): Array<{name: string, store: string, price: number}> {
    const lines = content.split('\n');
    const items: Array<{name: string, store: string, price: number}> = [];

    for (const line of lines) {
      // Match patterns like:
      // - ProductName - StoreName €price
      // - ProductName – StoreName €price
      // * ProductName - StoreName €price
      const match = line.match(/^[-*]\s+(.+?)\s+[-–]\s+(.+?)\s+€(\d+(?:\.\d{2})?)/);
      if (match) {
        const [, name, store, priceStr] = match;
        const price = parseFloat(priceStr);
        if (name && store && !isNaN(price)) {
          items.push({
            name: name.trim(),
            store: store.trim(),
            price
          });
        }
      }
    }

    return items;
  }

  async function savePlannerList() {
    if (!session?.token || plannerSaving) return;

    const lastAssistantMessage = messages
      .filter(m => m.role === 'assistant')
      .pop();

    if (!lastAssistantMessage?.content) return;

    const items = parseAssistantMessageForItems(lastAssistantMessage.content);
    if (items.length === 0) return;

    setPlannerSaving(true);

    try {
      const response = await fetch('/api/lists/save-from-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: session.token,
          items: items,
          prompt: lastPrompt
        })
      });

      const data = await response.json();
      if (response.ok && data.ok) {
        setPlannerSaved(true);
        console.log(`[planner] Saved ${data.count} items to list`);
      } else {
        console.error('[planner] Failed to save:', data.error);
      }
    } catch (error) {
      console.error('[planner] Save error:', error);
    } finally {
      setPlannerSaving(false);
    }
  }

  async function sendMessage(userText: string) {
    if (!userText.trim() || isLoading) return;
    setStarted(true);
    setShowGate(false);
    setListSaved(false);
    setPlannerSaved(false);

    const newMessages: Message[] = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setLastPrompt(prev => messages.length === 0 ? userText : prev); // only set on first message
    shouldScrollRef.current = true;

    abortRef.current = new AbortController();

    // Track chat usage (best-effort, don't await)
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'plan_requested', properties: { household_size: householdSize } }),
    }).catch(() => {});

    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, householdSize }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error('Request failed');
      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      // Add placeholder
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          // Data stream format: 0:"text chunk" — use slice to avoid regex newline issues
          if (trimmed.startsWith('0:"') && trimmed.endsWith('"')) {
            try {
              const jsonStr = trimmed.slice(2); // strip leading '0:'
              const text = JSON.parse(jsonStr); // parse the quoted string including escaped \n
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

      // Show signup gate after any substantive response — don't rely on exact format strings
      const isList = assistantContent.includes('🛒') || assistantContent.includes('Store totals') || assistantContent.includes('Best value split') || assistantContent.length > 200;
      if (!session && !gateDone && isList) {
        setTimeout(() => setShowGate(true), 800);
      }

      // If already logged in and got a list, auto-save it
      if (session && isList) {
        fetch('/api/lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: session.token,
            name: lastPrompt.slice(0, 60) || 'My list',
            meals_prompt: lastPrompt,
            family_size: String(householdSize),
            items: [],       // items snapshot not available here — saved on list page
            store_totals: [],
            is_default: false,
          }),
        }).then(r => r.json()).then(d => { if (d.list) setListSaved(true); }).catch(() => {});
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
      }
    } finally {
      setIsLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      {messages.length > 0 && (
      <div ref={scrollRef} className="flex-1 space-y-3 mb-3 max-h-72 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>S</div>
              )}
              <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === 'user' ? 'rounded-br-sm' : 'rounded-bl-sm'
              }`} style={m.role === 'user'
                ? { background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)' }
                : { background: 'var(--surface-container)', color: 'var(--on-background)' }
              }>
                {m.role === 'assistant' ? <FormattedMessage content={m.content} /> : <p>{m.content}</p>}
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.content === '' && (
            <div className="flex justify-start">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>S</div>
              <div className="rounded-2xl rounded-bl-sm px-3 py-2" style={{ background: 'var(--surface-container)' }}>
                <div className="flex gap-1 items-center h-4">
                  {[0,150,300].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--primary)', animationDelay: `${d}ms` }} />)}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Save to list button for logged-in users */}
      {session && !plannerSaved && messages.some(m => m.role === 'assistant' && m.content) && !isLoading && (
        <div className="mb-3">
          <button
            onClick={savePlannerList}
            disabled={plannerSaving}
            className="btn-primary px-4 py-2 text-sm font-semibold rounded-xl disabled:opacity-60 flex items-center gap-2"
          >
            {plannerSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Saving...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Save to my list
              </>
            )}
          </button>
        </div>
      )}

      {/* Success message for planner save */}
      {session && plannerSaved && (
        <div className="mb-3 rounded-2xl p-3" style={{ background: 'var(--surface-container-low)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div className="flex items-start gap-2">
            <span className="text-lg flex-shrink-0">✅</span>
            <div>
              <div className="font-bold text-sm" style={{ color: 'var(--on-background)' }}>List items saved!</div>
              <div className="text-xs mt-0.5 mb-2" style={{ color: 'var(--on-surface)' }}>Added to your personal shopping list.</div>
              <a
                href={`/list?token=${session.token}`}
                className="btn-primary inline-block px-3 py-1.5 text-xs font-semibold rounded-lg"
              >
                View full list →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Signup gate — shown inline, does NOT hide the input */}
      {showGate && !session && (
        <SignupGate onSuccess={t => {
          if (t) {
            setSession({ token: t });
            // After gate success, persist the list items
            if (t && lastItems && Array.isArray(lastItems) && lastItems.length > 0) {
              const mappedItems = (lastItems as any[]).map(i => ({
                canonical_name: i.canonical_name ?? i.name ?? '',
                category: i.category ?? '',
                store: i.store ?? '',
                price_paid: i.price ?? i.price_paid ?? 0,
                quantity: i.quantity ?? 1,
              })).filter(i => i.canonical_name);
              if (mappedItems.length > 0) {
                fetch('/api/list/save-items', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: t, items: mappedItems }),
                }).catch(() => {});
              }
            }
          }
          setShowGate(false); setGateDone(true);
        }} onSkip={() => { setShowGate(false); setGateDone(true); }} />
      )}

      {/* Logged-in save link */}
      {session && messages.some(m => m.role === 'assistant' && m.content) && !isLoading && (
        <div className="mb-2 text-xs font-semibold flex items-center gap-2" style={{ color: 'var(--primary)' }}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
          <a href={`/list?token=${session.token}`} className="underline">View my saved list →</a>
          {listSaved && <span className="font-normal" style={{ color: 'var(--on-surface-variant)' }}>· list saved ✓</span>}
        </div>
      )}

      {/* Input always visible */}
      <div>
        {!started && (
          <div className="mb-2">
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {EXAMPLES.slice(exampleOffset, exampleOffset + 4).map(e => (
                <button key={e} type="button" onClick={() => { setInput(e); inputRef.current?.focus(); }}
                  className="text-xs px-2.5 py-1.5 rounded-full transition-all"
                  style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
                  {e.length > 38 ? e.slice(0, 38) + '…' : e}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setExampleOffset(o => (o + 4) % EXAMPLES.length)}
              className="text-xs transition flex items-center gap-1 mt-0.5 font-medium"
              style={{ color: 'var(--on-surface)' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              More ideas
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs" style={{ color: 'var(--on-surface)' }}>People:</span>
          <div className="flex gap-1">
            {[1,2,3,4,5,6].map(n => (
              <button key={n} type="button" onClick={() => setHouseholdSize(n)}
                className="w-6 h-6 rounded-md text-xs font-bold transition-all"
                style={householdSize === n
                  ? { background: 'var(--primary)', color: 'var(--on-primary)' }
                  : { background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={onSubmit} className="relative">
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }}}
            placeholder={started ? "Add a meal, go vegetarian, change quantities…" : "e.g. spaghetti bolognese, chicken stir fry, packed lunches…"}
            rows={2}
            className="w-full px-4 py-3 pr-12 rounded-xl focus:outline-none text-sm resize-none transition"
            style={{ background: 'var(--surface-container-highest)', color: 'var(--on-background)' }}
            onFocus={e => { e.currentTarget.style.background = 'var(--surface-container-lowest)'; e.currentTarget.style.outline = '2px solid rgba(0,106,53,0.4)'; e.currentTarget.style.outlineOffset = '-2px'; }}
            onBlur={e =>  { e.currentTarget.style.background = 'var(--surface-container-highest)'; e.currentTarget.style.outline = 'none'; }}
          />
          <button type="submit" disabled={isLoading || !input.trim()}
            className="absolute right-2.5 bottom-2.5 w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', color: 'var(--on-primary-container)' }}>
            {isLoading
              ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
            }
          </button>
        </form>
        <p className="text-[11px] mt-1.5 text-center" style={{ color: 'var(--on-surface-variant)' }}>Prices from Tesco, Dunnes &amp; SuperValu · Free to use</p>
      </div>
    </div>
  );
}

function FormattedMessage({ content }: { content: string }) {
  if (!content) return null;
  return (
    <>
      {content.split('\n').map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        if (line.startsWith('### ')) return <p key={i} className="font-bold mt-2 mb-0.5 text-sm" style={{ color: 'var(--on-background)' }}>{ri(line.slice(4))}</p>;
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4) return <p key={i} className="font-semibold mt-2 mb-0.5 text-xs uppercase tracking-wide" style={{ color: 'var(--on-background)' }}>{ri(line.slice(2,-2))}</p>;
        if (line.startsWith('- ') || line.startsWith('* ')) return <p key={i} className="text-sm leading-snug pl-1">{ri(line.slice(2))}</p>;
        if (line.startsWith('---')) return <hr key={i} className="my-2" style={{ borderColor: 'var(--outline-variant)', opacity: 0.3 }} />;
        if (line.startsWith('💡')) return <p key={i} className="mt-2 text-xs font-medium" style={{ color: 'var(--primary)' }}>{ri(line)}</p>;
        return <p key={i} className="text-sm leading-relaxed">{ri(line)}</p>;
      })}
    </>
  );
}

function ri(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i} className="font-semibold">{p.slice(2,-2)}</strong> : p
  );
}
