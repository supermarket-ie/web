'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { loadSession, loadProfile, saveProfile, type PlannerProfile, saveSession } from '@/lib/session';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';

// ─── Types ──────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  buttons?: ChatButton[];
}

interface ChatButton {
  label: string;
  value: string;
  emoji?: string;
}

interface StoreTotal {
  store: string;
  total: number;
  cheapest?: boolean;
}

// ─── Conversation flow steps ────────────────────────────────────────────

type FlowStep = 'greeting' | 'household' | 'dietary' | 'meals' | 'budget' | 'extras' | 'generating' | 'done';

const PROGRESS_MESSAGES = [
  "Checking this week's promotions...",
  "Scanning categories...",
  "Comparing prices across stores...",
  "Building your grocery list...",
  "Finding the best deals for your household...",
];

// ─── Helpers ────────────────────────────────────────────────────────────

function msgId() {
  return Math.random().toString(36).slice(2, 9);
}

/** Parse SSE text-delta events from AI SDK v6 UIMessage stream */
function parseSSETextDelta(chunk: string): string {
  let text = '';
  for (const line of chunk.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const payload = trimmed.slice(6);
    if (payload === '[DONE]') continue;
    try {
      const part = JSON.parse(payload);
      if (part.type === 'text-delta' && part.delta) {
        text += part.delta;
      }
    } catch {}
  }
  return text;
}

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

// ─── Animated price ─────────────────────────────────────────────────────

function AnimatedPrice({ target }: { target: number }) {
  const [current, setCurrent] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let start: number;
    const go = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / 1000, 1);
      setCurrent(target * p);
      if (p < 1) requestAnimationFrame(go); else setCurrent(target);
    };
    requestAnimationFrame(go);
  }, [target]);
  return <span>€{current.toFixed(2)}</span>;
}

// ─── FormattedMessage ───────────────────────────────────────────────────

function RichText({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  // Render inline **bold** within text
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span className={className} style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} style={{ color: 'var(--on-background)' }}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

// ─── Blur wrapper for locked content ────────────────────────────────────

function BlurredText({ children, unlocked }: { children: React.ReactNode; unlocked: boolean }) {
  return (
    <span
      style={{
        filter: unlocked ? 'blur(0)' : 'blur(5px)',
        transition: 'filter 0.6s ease',
        userSelect: unlocked ? 'auto' : 'none',
        WebkitUserSelect: unlocked ? 'auto' : 'none',
      }}
      aria-hidden={!unlocked}
    >
      {children}
    </span>
  );
}

// ─── Parse price/store portion from list item lines ─────────────────────

function ListItemLine({ text, unlocked }: { text: string; unlocked: boolean }) {
  // Match patterns like "— Tesco €2.49" or "— SuperValu €3.19 (was €4.29)"
  const priceMatch = text.match(/^(.+?)\s*(—\s*.+€.+)$/);
  if (priceMatch) {
    return (
      <span>
        <RichText text={priceMatch[1]} />
        <BlurredText unlocked={unlocked}>
          <RichText text={' ' + priceMatch[2]} />
        </BlurredText>
      </span>
    );
  }
  return <RichText text={text} />;
}

// ─── Calculate savings from store totals ────────────────────────────────

function calcSavings(totals: StoreTotal[]): number | null {
  if (totals.length < 2) return null;
  const sorted = [...totals].sort((a, b) => a.total - b.total);
  const diff = sorted[sorted.length - 1].total - sorted[0].total;
  return diff > 0 ? Math.round(diff * 100) / 100 : null;
}

function FormattedMessage({ content, unlocked = true }: { content: string; unlocked?: boolean }) {
  if (!content) return null;
  const storeTotals = parseStoreTotals(content);
  const lines = content.split('\n');
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        if (line.startsWith('### ')) return <h4 key={i} className="font-bold text-base mt-4 mb-2" style={{ color: 'var(--on-background)' }}><RichText text={line.slice(4)} /></h4>;
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4 && !line.slice(2, -2).includes('**')) return <h5 key={i} className="type-label mt-3 mb-1" style={{ color: 'var(--on-background)' }}>{line.slice(2, -2)}</h5>;
        if (line.startsWith('- ') || line.startsWith('* ')) return <p key={i} className="text-sm leading-relaxed pl-4" style={{ color: 'var(--on-surface)' }}><ListItemLine text={line.slice(2)} unlocked={unlocked} /></p>;
        if (line.startsWith('---')) return <hr key={i} className="my-3" style={{ borderColor: 'var(--outline-variant)' }} />;
        if (line.startsWith('💡')) return <div key={i} className="mt-3 p-3 rounded-xl" style={{ background: 'var(--primary-fixed)' }}><p className="text-sm font-medium" style={{ color: 'var(--on-primary-container)' }}><RichText text={line} /></p></div>;
        return <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--on-surface)' }}><RichText text={line} /></p>;
      })}
      {storeTotals.length > 0 && (
        <div
          className="mt-4 space-y-2"
          style={{
            filter: unlocked ? 'blur(0)' : 'blur(6px)',
            transition: 'filter 0.6s ease',
            userSelect: unlocked ? 'auto' : 'none',
            WebkitUserSelect: unlocked ? 'auto' : 'none',
          }}
        >
          <h5 className="type-label" style={{ color: 'var(--on-background)' }}>STORE TOTALS</h5>
          <div className="flex flex-wrap gap-2">
            {storeTotals.map((t, i) => (
              <div key={i} className="px-3 py-2 rounded-xl text-white text-sm font-bold flex items-center gap-2" style={{ background: storeStyle(t.store).bg }}>
                <span>{storeDisplayName(t.store)}</span>
                {t.cheapest ? <AnimatedPrice target={t.total} /> : <span>€{t.total.toFixed(2)}</span>}
                {t.cheapest && <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">Cheapest</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline buttons component ───────────────────────────────────────────

function InlineButtons({ buttons, onSelect, disabled }: {
  buttons: ChatButton[]; onSelect: (value: string) => void; disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {buttons.map(btn => (
        <button
          key={btn.value}
          onClick={() => !disabled && onSelect(btn.value)}
          disabled={disabled}
          className="px-3 py-1.5 rounded-full text-sm font-medium transition-all disabled:opacity-50"
          style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
        >
          {btn.emoji && <span className="mr-1">{btn.emoji}</span>}{btn.label}
        </button>
      ))}
    </div>
  );
}

// ─── Share button ───────────────────────────────────────────────────────

function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1'));
          setCopied(true); setTimeout(() => setCopied(false), 2000);
        } catch {}
      }}
      className="btn-secondary px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5"
    >
      📋 {copied ? 'Copied!' : 'Share list'}
    </button>
  );
}

// ─── Unlock CTA (replaces old EmailCapture) ────────────────────────────

function UnlockCTA({ householdSize, savings, onUnlocked }: {
  householdSize: number; savings: number | null; onUnlocked: () => void;
}) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const headline = savings && savings > 1
    ? `🔓 Sign up to see which store saves you €${savings.toFixed(2)} this week`
    : '🔓 Sign up to unlock store-by-store prices';

  return (
    <div className="rounded-2xl p-4 mt-3 mb-2" style={{
      background: 'linear-gradient(135deg, var(--primary-fixed), var(--surface-container-lowest))',
      border: '2px solid var(--primary)',
      boxShadow: '0 2px 12px rgba(0,106,53,0.12)',
    }}>
      <p className="text-sm font-bold mb-1" style={{ color: 'var(--on-primary-container)' }}>
        {headline}
      </p>
      <p className="text-xs mb-3" style={{ color: 'var(--on-surface-variant)' }}>
        Your list is ready — enter your email to unlock store prices and get weekly updates.
      </p>
      <form onSubmit={async (e) => {
        e.preventDefault(); if (!email.trim()) return;
        setSubmitting(true); setError('');
        try {
          const res = await fetch('/api/subscribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim(), familySize: String(householdSize) }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Something went wrong');
          if (data.token) {
            saveSession({ token: data.token, familySize: String(householdSize), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
            onUnlocked();
          }
        } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong'); setSubmitting(false); }
      }} className="flex gap-2">
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com" className="flex-1 px-3 py-2.5 rounded-xl text-sm min-w-0 focus:outline-none"
          style={{ background: 'var(--surface-container-lowest)', color: 'var(--on-background)', border: '1px solid var(--surface-container)' }} />
        <button type="submit" disabled={submitting} className="btn-primary px-4 py-2.5 text-sm font-bold whitespace-nowrap disabled:opacity-60 rounded-xl">
          {submitting ? '...' : 'Unlock prices →'}
        </button>
      </form>
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      <p className="text-[11px] mt-2 text-center" style={{ color: 'var(--on-surface-variant)' }}>
        100% free · No card needed · Unsubscribe anytime
      </p>
    </div>
  );
}

// ─── Streaming indicator ────────────────────────────────────────────────

function StreamingDots({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {[0, 150, 300].map(d => (
          <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--primary)', animationDelay: `${d}ms` }} />
        ))}
      </div>
      <span className="text-sm" style={{ color: 'var(--on-surface)' }}>{message}</span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function HomePlanner() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [flowStep, setFlowStep] = useState<FlowStep>('greeting');
  const [profile, setProfile] = useState<PlannerProfile>({
    adults: 2, children: 0, childAges: [],
    preferredStores: ['all'], dietary: [],
    meals: { breakfast: true, lunch: true, dinner: true, snacks: false },
    batchCooking: false,
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);
  const [buttonsDisabled, setButtonsDisabled] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [listContent, setListContent] = useState('');
  const [mealsExplicit, setMealsExplicit] = useState(false); // true when user explicitly set meals
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [savedAfterUnlock, setSavedAfterUnlock] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Auto-scroll ──
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isGenerating]);

  // ── Progress rotation ──
  useEffect(() => {
    if (isGenerating) {
      const iv = setInterval(() => setProgressIdx(i => (i + 1) % PROGRESS_MESSAGES.length), 3000);
      return () => clearInterval(iv);
    }
  }, [isGenerating]);

  // ── Add a message ──
  const addMsg = useCallback((role: ChatMessage['role'], content: string, buttons?: ChatButton[]) => {
    setMessages(prev => [...prev, { id: msgId(), role, content, buttons }]);
  }, []);

  // ── Auto-save conversation + list after generation + unlock ──
  const autoSaveConversation = useCallback(async (content: string, p: PlannerProfile) => {
    const session = loadSession();
    if (!session?.token || !content) return;

    try {
      // Parse store totals from the generated content
      const storeTotals = parseStoreTotals(content);

      // Create conversation
      const total = p.adults + p.children;
      const mealsDesc = [
        p.meals.breakfast && 'breakfast',
        p.meals.lunch && 'lunch',
        p.meals.dinner && 'dinner',
        p.meals.snacks && 'snacks',
      ].filter(Boolean).join(', ');
      const title = `Weekly shop — ${total} people, ${mealsDesc}`;

      // Build conversation messages from chat history
      const convMessages = [
        { role: 'user', content: `Plan groceries for ${total} people: ${mealsDesc}`, timestamp: new Date().toISOString() },
        { role: 'assistant', content, timestamp: new Date().toISOString() },
      ];

      // Save list first
      const listRes = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: session.token,
          name: title,
          meals_prompt: mealsDesc,
          family_size: String(total),
          items: [],
          store_totals: storeTotals.map(t => ({ store: t.store, total: t.total })),
          is_default: true,
        }),
      });
      const listData = listRes.ok ? await listRes.json() : null;
      const listId = listData?.list?.id ?? null;

      // Create conversation linked to the list
      const convRes = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: session.token,
          title,
          profile: p,
          messages: convMessages,
          list_id: listId,
        }),
      });
      const convData = convRes.ok ? await convRes.json() : null;
      if (convData?.conversation?.id) {
        setConversationId(convData.conversation.id);

        // Link saved list back to conversation
        if (listId) {
          // This would need the conversation_id column — we do a PATCH via lists API
          // For now the list_id in conversation is the important link
        }
      }
      // Save household profile server-side for future visits
      await fetch('/api/household', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.token, ...p }),
      }).catch(() => {}); // best-effort
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  }, []);

  // ── Auto-save after unlock (user signed up post-generation) ──
  useEffect(() => {
    if (isUnlocked && listContent && flowStep === 'done' && !savedAfterUnlock && !conversationId) {
      setSavedAfterUnlock(true);
      autoSaveConversation(listContent, profile);
    }
  }, [isUnlocked, listContent, flowStep, savedAfterUnlock, conversationId, autoSaveConversation, profile]);

  // ── Kick off the conversation ──
  useEffect(() => {
    const savedProfile = loadProfile();
    const session = loadSession();

    async function init() {
      let userProfile = savedProfile;

      // If signed in but no local profile, try loading from server
      if (!userProfile && session?.token) {
        try {
          const res = await fetch(`/api/household?token=${session.token}`);
          if (res.ok) {
            const { household } = await res.json();
            if (household) {
              userProfile = {
                adults: household.adults,
                children: household.children,
                childAges: household.child_ages ?? [],
                weeklyBudget: household.weekly_budget ?? undefined,
                preferredStores: household.preferred_stores ?? ['all'],
                dietary: household.dietary ?? [],
                dislikes: household.dislikes ?? undefined,
                meals: household.meals ?? { breakfast: true, lunch: true, dinner: true, snacks: true },
                batchCooking: household.batch_cooking ?? false,
                skipDays: household.skip_days ?? undefined,
                extraContext: household.extra_context ?? undefined,
              };
              // Sync to localStorage for faster future loads
              saveProfile(userProfile);
            }
          }
        } catch {}
      }

      if (userProfile && session?.token) {
        // Returning user — unlocked
        setProfile(userProfile);
        setIsUnlocked(true);
        const people = userProfile.adults + userProfile.children;
        addMsg('assistant', `👋 Welcome back! Last time you planned for ${people} people. Want the same again or make changes?`, [
          { label: 'Same again →', value: '__same_again', emoji: '🔄' },
          { label: 'Update my plan', value: '__update_plan', emoji: '✏️' },
          { label: 'Start fresh', value: '__start_fresh', emoji: '🆕' },
        ]);
        setFlowStep('greeting');
      } else {
        // New user
        addMsg('assistant', "👋 Hi! Let's plan your grocery shop for the week. Who's eating?", [
          { label: 'Just me', value: '1_adult', emoji: '👤' },
          { label: '2 adults', value: '2_adults', emoji: '👫' },
          { label: 'Family', value: 'family', emoji: '👨‍👩‍👧' },
          { label: 'Other...', value: 'other', emoji: '✏️' },
        ]);
        setFlowStep('household');
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Parse rich free text — extract everything we can from one message ──
  function parseRichInput(lower: string, p: PlannerProfile) {
    // ── Household ──
    const adultMatch = lower.match(/(\d+)\s*adult/);
    const kidMatch = lower.match(/(\d+)\s*(kid|child|children)/);
    const justMe = lower.includes('just me') || lower === '1';
    const singlePerson = lower.includes('single') || lower.match(/\b(i am|i'm|im)\b.*\b(one|1|alone|solo|myself)\b/) || lower.includes('on my own');
    if (justMe || singlePerson) { p.adults = 1; p.children = 0; }
    else {
      if (adultMatch) p.adults = parseInt(adultMatch[1]);
      else if (lower.includes('couple') || lower.includes('two of us') || lower.includes('me and my')) p.adults = 2;
      if (kidMatch) p.children = parseInt(kidMatch[1]);
    }
    // Detect ages
    if (lower.includes('teen')) p.childAges = [...(p.childAges || []), 'teen'];
    if (lower.includes('toddler') || lower.includes('baby')) p.childAges = [...(p.childAges || []), 'toddler'];
    if (lower.includes('young') || lower.match(/\b[4-8]\b.*year/)) p.childAges = [...(p.childAges || []), 'young'];

    // ── Meals — detect from natural language ──
    // Only match actual meal words, not substring matches like "meat" containing "ea"
    const hasMealMention = /\blunch\b/.test(lower) || /\bdinner\b/.test(lower) || /\bbreakfast\b/.test(lower)
      || /\bmeals?\b/.test(lower) || /\bsnack/.test(lower) || /\bevening\b/.test(lower)
      || /\bschool\b/.test(lower) || /\bpacked\b/.test(lower);

    if (hasMealMention) {
      p.meals = {
        breakfast: lower.includes('breakfast') || lower.includes('full week') || lower.includes('all meals'),
        lunch: lower.includes('lunch') || lower.includes('packed') || lower.includes('school'),
        dinner: lower.includes('dinner') || lower.includes('evening') || lower.includes('tea')
          || lower.includes('meal') || /\d+\s*(evening|dinner|meal)/.test(lower),
        snacks: lower.includes('snack'),
      };
      setMealsExplicit(true);
      // "5 evening meals" — capture number of dinners for skip days
      const mealCountMatch = lower.match(/(\d+)\s*(evening|dinner|meal|night)/);
      if (mealCountMatch) {
        const count = parseInt(mealCountMatch[1]);
        if (count < 7) {
          p.skipDays = `${7 - count} nights eating out/skipping`;
        }
      }
    }

    // ── Dietary ──
    if (lower.includes('vegetarian') || lower.includes('veggie')) p.dietary.push('Vegetarian');
    if (lower.includes('vegan')) p.dietary.push('Vegan');
    if (lower.includes('gluten')) p.dietary.push('Gluten-free');
    if (lower.includes('dairy free') || lower.includes('dairy-free')) p.dietary.push('Dairy-free');
    if (lower.includes('halal')) p.dietary.push('Halal');
    if (lower.includes('nut free') || lower.includes('nut-free')) p.dietary.push('Nut-free');
    if (lower.includes('low carb') || lower.includes('low-carb') || lower.includes('keto')) p.dietary.push('Low-carb');
    if (lower.includes('high protein')) p.dietary.push('High-protein');
    if (lower.includes('high fibre') || lower.includes('high fiber')) p.dietary.push('High-fibre');

    // ── Preferences (organic, free-range, etc.) → extra context ──
    const preferences: string[] = [];
    if (lower.includes('organic')) preferences.push('prefers organic');
    if (lower.includes('free range') || lower.includes('free-range')) preferences.push('prefers free-range');
    if (lower.includes('like') && lower.includes('meat')) preferences.push('likes meat');
    if (preferences.length > 0) {
      p.extraContext = [p.extraContext, ...preferences].filter(Boolean).join(', ');
    }

    // ── Budget — handle €80, 80€, 80 euro, budget of 80, etc. ──
    const budgetMatch = lower.match(/€(\d+)|(\d+)\s*€|(\d+)\s*euro|budget\s*(?:of\s*)?€?(\d+)/);
    if (budgetMatch) {
      p.weeklyBudget = parseInt(budgetMatch[1] || budgetMatch[2] || budgetMatch[3] || budgetMatch[4]);
    }

    // ── Batch cooking ──
    if (lower.includes('batch')) p.batchCooking = true;

    // ── Dislikes ──
    const dislikeMatch = lower.match(/(?:hate|avoid|don'?t like|no )([\w\s,]+?)(?:\.|,|$)/);
    if (dislikeMatch) p.dislikes = dislikeMatch[1].trim();

    // ── Extra context — capture anything after "also" or "and also" ──
    const alsoMatch = lower.match(/(?:also|and also|oh and|btw|by the way)[,:]?\s*(.+)/);
    if (alsoMatch) p.extraContext = alsoMatch[1].trim();
  }

  // ── Handle button tap or text input ──
  function handleUserInput(text: string) {
    if (!text.trim() || isGenerating) return;
    addMsg('user', text);
    setInput('');
    setButtonsDisabled(true);

    // Route based on flow step
    if (flowStep === 'generating' || flowStep === 'done') {
      // Post-list modification — send as conversation
      handleModification(text);
      return;
    }

    processFlowInput(text);
  }

  function processFlowInput(text: string) {
    const lower = text.toLowerCase().trim();

    switch (flowStep) {
      case 'greeting': {
        // Returning user choices
        if (lower.includes('same again') || text === '__same_again') {
          generateList(profile);
          return;
        }
        if (lower.includes('update') || text === '__update_plan') {
          askHousehold();
          return;
        }
        // Start fresh or anything else
        setProfile({ adults: 2, children: 0, childAges: [], preferredStores: ['all'], dietary: [], meals: { breakfast: true, lunch: true, dinner: true, snacks: false }, batchCooking: false });
        askHousehold();
        return;
      }

      case 'household': {
        const p = { ...profile };

        if (text === '1_adult') { p.adults = 1; p.children = 0; }
        else if (text === '2_adults') { p.adults = 2; p.children = 0; }
        else if (text === 'family') {
          // Ask about family composition
          setProfile(p);
          addMsg('assistant', 'Nice! How many adults and kids?', [
            { label: '2 adults, 1 kid', value: '2a1k', emoji: '👨‍👩‍👧' },
            { label: '2 adults, 2 kids', value: '2a2k', emoji: '👨‍👩‍👧‍👦' },
            { label: '2 adults, 3 kids', value: '2a3k', emoji: '👨‍👩‍👧‍👦' },
            { label: 'Let me type it', value: 'other', emoji: '✏️' },
          ]);
          setButtonsDisabled(false);
          return;
        }
        else if (text === '2a1k') { p.adults = 2; p.children = 1; }
        else if (text === '2a2k') { p.adults = 2; p.children = 2; }
        else if (text === '2a3k') { p.adults = 2; p.children = 3; }
        else {
          // Parse rich free text — extract everything we can
          parseRichInput(lower, p);
        }

        setProfile(p);

        // ── Smart skip: if we already extracted meal info, skip ahead ──
        const hasMealInfo = mealsExplicit;
        const hasDietaryInfo = p.dietary.length > 0;
        const hasBudgetInfo = p.weeklyBudget !== undefined;

        // If kids but no ages, ask ages first (then resume smart skip)
        if (p.children > 0 && (!p.childAges || p.childAges.length === 0)) {
          addMsg('assistant', `Got it — ${p.adults} adult${p.adults > 1 ? 's' : ''} and ${p.children} kid${p.children > 1 ? 's' : ''}. Roughly what ages?`, [
            { label: 'Toddler (1-3)', value: 'age_toddler' },
            { label: 'Young (4-8)', value: 'age_young' },
            { label: 'Older (9-12)', value: 'age_older' },
            { label: 'Teen (13-17)', value: 'age_teen' },
            { label: 'Mix — skip', value: 'age_skip', emoji: '⏭️' },
          ]);
          setButtonsDisabled(false);
          return;
        }

        // Ages sub-step
        if (text.startsWith('age_')) {
          if (text !== 'age_skip') {
            const age = text.replace('age_', '') as any;
            p.childAges = [...(p.childAges || []), age];
            setProfile(p);
          }
          // After ages, resume smart skip
          if (hasMealInfo && hasDietaryInfo) {
            if (hasBudgetInfo) { askExtras(p); return; }
            askBudget(p);
            return;
          }
          if (hasMealInfo) { askBudget(p); return; }
          askDietary(p);
          return;
        }

        // Smart skip: jump to the first step we don't have info for
        if (hasMealInfo && hasDietaryInfo && hasBudgetInfo) {
          askExtras(p);
          return;
        }
        if (hasMealInfo && hasDietaryInfo) {
          askBudget(p);
          return;
        }
        if (hasMealInfo) {
          // We have meals but not dietary — skip to dietary
          askDietary(p);
          return;
        }

        askDietary(p);
        return;
      }

      case 'dietary': {
        const p = { ...profile };
        if (lower === 'none' || lower.includes('no dietary') || text === '__none') {
          p.dietary = [];
        } else if (['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'halal', 'low-carb', 'nut-free'].includes(lower)) {
          p.dietary = [...p.dietary, text];
        } else {
          // Free text — parse everything we can
          parseRichInput(lower, p);
        }
        setProfile(p);
        // If meals were set in this message, skip to budget
        if (mealsExplicit) {
          askBudget(p);
          return;
        }
        askMeals(p);
        return;
      }

      case 'meals': {
        const p = { ...profile };
        if (text === 'full_week' || lower.includes('full week') || lower.includes('everything') || lower.includes('all meals')) {
          p.meals = { breakfast: true, lunch: true, dinner: true, snacks: true };
        } else if (text === 'dinners_only' || lower.includes('just dinner') || lower.includes('dinners only')) {
          p.meals = { breakfast: false, lunch: false, dinner: true, snacks: false };
        } else if (text === 'school_week' || lower.includes('school')) {
          p.meals = { breakfast: true, lunch: true, dinner: true, snacks: true };
          p.batchCooking = false;
        } else if (text === 'top_up' || lower.includes('top up') || lower.includes('top-up')) {
          p.meals = { breakfast: false, lunch: false, dinner: true, snacks: false };
        } else {
          // Parse from text
          p.meals = {
            breakfast: lower.includes('breakfast'),
            lunch: lower.includes('lunch') || lower.includes('packed'),
            dinner: lower.includes('dinner') || lower.includes('tea'),
            snacks: lower.includes('snack'),
          };
          if (lower.includes('batch')) p.batchCooking = true;
          // Capture skip days
          const skipMatch = lower.match(/(?:eating out|skip|away)(.*)/);
          if (skipMatch) p.skipDays = skipMatch[1].trim();
        }
        setProfile(p);
        askBudget(p);
        return;
      }

      case 'budget': {
        const p = { ...profile };
        
        // Detect if user typed meal info instead of budget
        const hasMealWords = lower.includes('lunch') || lower.includes('dinner') || lower.includes('breakfast')
          || lower.includes('meal') || lower.includes('evening') || lower.includes('school') || lower.includes('packed');
        
        if (hasMealWords) {
          // User is giving meal info — parse it and re-ask budget
          parseRichInput(lower, p);
          setProfile(p);
          const mealsDesc = [
            p.meals.breakfast && 'breakfast',
            p.meals.lunch && 'lunch',
            p.meals.dinner && 'dinner',
            p.meals.snacks && 'snacks',
          ].filter(Boolean).join(', ');
          setTimeout(() => {
            addMsg('assistant', `Got it — ${mealsDesc}${p.skipDays ? ` (${p.skipDays})` : ''}. Any budget in mind?`, [
              { label: '€70', value: '€70', emoji: '💶' },
              { label: '€100', value: '€100', emoji: '💶' },
              { label: '€120', value: '€120', emoji: '💶' },
              { label: 'No budget', value: '__no_budget', emoji: '🤷' },
            ]);
            setButtonsDisabled(false);
          }, 300);
          return;
        }
        
        if (text === '__no_budget' || lower.includes('no budget') || lower.includes('don\'t mind') || lower.includes('skip')) {
          p.weeklyBudget = undefined;
        } else {
          const match = lower.match(/€?(\d+)/);
          if (match) p.weeklyBudget = parseInt(match[1]);
        }
        setProfile(p);
        askExtras(p);
        return;
      }

      case 'extras': {
        const p = { ...profile };
        if (text === '__skip_extras' || lower === 'no' || lower === 'nope' || lower.includes('just build')) {
          // Skip
        } else {
          p.extraContext = text;
        }
        setProfile(p);
        generateList(p);
        return;
      }

      default:
        break;
    }
  }

  // ── Flow step helpers ──

  function askHousehold() {
    setFlowStep('household');
    setTimeout(() => {
      addMsg('assistant', "Who's eating this week?", [
        { label: 'Just me', value: '1_adult', emoji: '👤' },
        { label: '2 adults', value: '2_adults', emoji: '👫' },
        { label: 'Family', value: 'family', emoji: '👨‍👩‍👧' },
        { label: 'Other...', value: 'other', emoji: '✏️' },
      ]);
      setButtonsDisabled(false);
    }, 300);
  }

  function askDietary(p: PlannerProfile) {
    setFlowStep('dietary');
    const total = p.adults + p.children;
    // Only show meals summary if user explicitly set them
    const mealsNote = mealsExplicit
      ? ` (${[p.meals.breakfast && 'breakfast', p.meals.lunch && 'lunches', p.meals.dinner && 'dinners', p.meals.snacks && 'snacks'].filter(Boolean).join(', ')})`
      : '';
    const dietaryNote = p.dietary.length > 0 ? ` I've noted: ${p.dietary.join(', ')}.` : '';
    const budgetNote = p.weeklyBudget ? ` Budget: €${p.weeklyBudget}.` : '';
    const extrasNote = p.extraContext ? ` (${p.extraContext})` : '';
    const summary = [mealsNote, dietaryNote, budgetNote, extrasNote].filter(Boolean).join('');
    setTimeout(() => {
      addMsg('assistant', `${total} ${total === 1 ? 'person' : 'people'}${summary} — got it! Any dietary needs or things to avoid?`, [
        { label: 'None', value: '__none', emoji: '✅' },
        { label: 'Vegetarian', value: 'vegetarian', emoji: '🥬' },
        { label: 'Gluten-free', value: 'gluten-free', emoji: '🌾' },
        { label: 'Dairy-free', value: 'dairy-free', emoji: '🥛' },
        { label: 'Other...', value: 'other', emoji: '✏️' },
      ]);
      setButtonsDisabled(false);
    }, 300);
  }

  function askMeals(p: PlannerProfile) {
    setFlowStep('meals');
    const dietaryNote = p.dietary.length > 0 ? ` (${p.dietary.join(', ')})` : '';
    setTimeout(() => {
      addMsg('assistant', `Noted${dietaryNote}. What do you need this week?`, [
        { label: 'Full week — all meals', value: 'full_week', emoji: '🏠' },
        { label: 'Just dinners', value: 'dinners_only', emoji: '🍽️' },
        { label: 'School week', value: 'school_week', emoji: '🎒' },
        { label: 'Top-up shop', value: 'top_up', emoji: '🛒' },
        { label: 'Let me explain...', value: 'other', emoji: '✏️' },
      ]);
      setButtonsDisabled(false);
    }, 300);
  }

  function askBudget(p: PlannerProfile) {
    setFlowStep('budget');
    const mealsDesc = [
      p.meals.breakfast && 'breakfast',
      p.meals.lunch && 'lunch',
      p.meals.dinner && 'dinner',
      p.meals.snacks && 'snacks',
    ].filter(Boolean).join(', ');
    setTimeout(() => {
      addMsg('assistant', `${mealsDesc} — perfect. Any budget in mind?`, [
        { label: '€70', value: '€70', emoji: '💶' },
        { label: '€100', value: '€100', emoji: '💶' },
        { label: '€120', value: '€120', emoji: '💶' },
        { label: 'No budget', value: '__no_budget', emoji: '🤷' },
      ]);
      setButtonsDisabled(false);
    }, 300);
  }

  function askExtras(p: PlannerProfile) {
    setFlowStep('extras');
    setTimeout(() => {
      addMsg('assistant', 'Anything else I should know? (What you already have, eating out, household items...)', [
        { label: 'Nope, build it!', value: '__skip_extras', emoji: '🚀' },
      ]);
      setButtonsDisabled(false);
    }, 300);
  }

  // ── Generate the grocery list ──
  async function generateList(p: PlannerProfile) {
    setFlowStep('generating');
    setIsGenerating(true);
    setProgressIdx(0);
    setListContent('');
    saveProfile(p);

    const total = p.adults + p.children;
    const mealsDesc = [p.meals.breakfast && 'breakfast', p.meals.lunch && 'lunch', p.meals.dinner && 'dinner', p.meals.snacks && 'snacks'].filter(Boolean).join(', ');
    addMsg('assistant', `Building your grocery list for ${total} people (${mealsDesc})${p.weeklyBudget ? ` under €${p.weeklyBudget}` : ''}...`);

    abortRef.current = new AbortController();
    try {
      const session = loadSession();
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: p, token: session?.token }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error('Request failed');
      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let content = '';

      // Add placeholder for streaming
      const streamId = msgId();
      setMessages(prev => [...prev, { id: streamId, role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const delta = parseSSETextDelta(chunk);
        if (delta) {
          content += delta;
          setListContent(content);
          setMessages(prev => prev.map(m => m.id === streamId ? { ...m, content } : m));
        }
      }

      setFlowStep('done');

      // Auto-save if user is already signed in
      if (isUnlocked && content) {
        autoSaveConversation(content, p);
      }

    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addMsg('assistant', 'Sorry, something went wrong. Try again?', [
          { label: 'Try again', value: '__retry', emoji: '🔄' },
        ]);
      }
      setFlowStep('done');
    } finally {
      setIsGenerating(false);
      setButtonsDisabled(false);
    }
  }

  // ── Handle post-list modifications ──
  async function handleModification(text: string) {
    if (text === '__retry') { generateList(profile); return; }

    setIsGenerating(true);
    setProgressIdx(0);

    abortRef.current = new AbortController();
    try {
      const session = loadSession();

      // Build messages array from conversation for context
      const apiMessages = messages
        .filter(m => m.content && !m.content.startsWith('👋') && !m.content.startsWith('Building your'))
        .map(m => ({ role: m.role, content: m.content }));
      apiMessages.push({ role: 'user', content: text });

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          profile,
          token: session?.token,
          householdSize: profile.adults + profile.children,
        }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error('Request failed');
      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let content = '';
      const streamId = msgId();
      setMessages(prev => [...prev, { id: streamId, role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const delta = parseSSETextDelta(chunk);
        if (delta) {
          content += delta;
          setListContent(content);
          setMessages(prev => prev.map(m => m.id === streamId ? { ...m, content } : m));
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addMsg('assistant', 'Sorry, something went wrong with that change. Try again?');
      }
    } finally {
      setIsGenerating(false);
      setButtonsDisabled(false);
    }
  }

  // ── Render ──
  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto overflow-hidden">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 mb-4 overflow-y-auto" style={{ maxHeight: '65vh' }}>
        {messages.map(m => (
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
              {m.role === 'assistant' && (m.content.includes('**') || m.content.includes('###') || m.content.includes('- ')) ? (
                <FormattedMessage content={m.content} unlocked={isUnlocked} />
              ) : (
                <p style={{ color: m.role === 'user' ? undefined : 'var(--on-surface)', whiteSpace: 'pre-wrap' }}>{m.content}</p>
              )}
              {m.buttons && !buttonsDisabled && (
                <InlineButtons buttons={m.buttons} onSelect={handleUserInput} />
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isGenerating && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>S</div>
            <div className="rounded-2xl rounded-bl-sm px-3 py-2 text-sm"
              style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
              <StreamingDots message={PROGRESS_MESSAGES[progressIdx]} />
            </div>
          </div>
        )}
      </div>

      {/* Unlock CTA for non-signed-in users after list is generated */}
      {flowStep === 'done' && listContent && !isGenerating && !isUnlocked && (
        <UnlockCTA
          householdSize={profile.adults + profile.children}
          savings={calcSavings(parseStoreTotals(listContent))}
          onUnlocked={() => setIsUnlocked(true)}
        />
      )}

      {/* Share button — only for unlocked users */}
      {flowStep === 'done' && listContent && !isGenerating && isUnlocked && (
        <div className="flex justify-end mb-2 gap-2">
          <ShareButton text={listContent} />
          {conversationId && (
            <a
              href={`/dashboard/chat/${conversationId}`}
              className="btn-primary px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5"
            >
              💬 Continue in chat
            </a>
          )}
          <a
            href="/dashboard"
            className="btn-secondary px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5"
          >
            📋 Dashboard
          </a>
        </div>
      )}

      {/* Input — always visible */}
      <div className="sticky bottom-0 z-10 pt-2 w-full" style={{ background: 'var(--surface-container-lowest)' }}>
        <form onSubmit={e => { e.preventDefault(); handleUserInput(input); }} className="relative w-full">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleUserInput(input); } }}
            placeholder={
              flowStep === 'done'
                ? "Change something... e.g. 'swap chicken for fish', 'add breakfast'"
                : flowStep === 'generating'
                ? 'Building your list...'
                : 'Or just type...'
            }
            rows={1}
            disabled={isGenerating}
            className="w-full px-4 py-3 pr-12 rounded-xl focus:outline-none text-sm resize-none transition disabled:opacity-50 box-border"
            style={{ background: 'var(--surface-container-low)', color: 'var(--on-background)', border: '1.5px solid var(--surface-container)' }}
            onFocus={e => { e.currentTarget.style.background = 'var(--surface-container-lowest)'; e.currentTarget.style.borderColor = 'rgba(0,106,53,0.4)'; }}
            onBlur={e => { e.currentTarget.style.background = 'var(--surface-container-low)'; e.currentTarget.style.borderColor = 'var(--surface-container)'; }}
          />
          <button type="submit" disabled={isGenerating || !input.trim()}
            className="absolute right-3 bottom-3 w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </form>
        <p className="text-xs mt-1.5 text-center" style={{ color: 'var(--on-surface-variant)' }}>
          Prices from Tesco, Dunnes, SuperValu & Aldi · Free
        </p>
      </div>
    </div>
  );
}
