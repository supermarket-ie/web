'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { loadSession, loadProfile, saveProfile, type PlannerProfile, saveSession } from '@/lib/session';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';
import { trackEvent } from '@/lib/analytics';
import { SmartRefreshCard, type RefreshData } from '@/components/SmartRefreshCard';
import { SplitRecommendationCard, type StoreRecommendation } from '@/components/SplitRecommendationCard';

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
  items?: number;
  cheapest?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────

const PROGRESS_MESSAGES = [
  "Checking this week's promotions...",
  "Scanning categories...",
  "Comparing prices across stores...",
  "Building your grocery list...",
  "Finding the best deals for your household...",
];

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
      const m = line.match(/\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?:?\s*€?(\d+(?:\.\d{2})?)\s*(?:\((\d+)\s*items?\))?/i);
      if (m) {
        const total = parseFloat(m[2]);
        const items = m[3] ? parseInt(m[3], 10) : undefined;
        if (!isNaN(total)) totals.push({ store: m[1].toLowerCase(), total, items });
      }
    }
  }
  if (totals.length > 0) {
    // "Cheapest" = store with most items (covers the basket). Among stores with equal items, pick lowest total.
    const maxItems = Math.max(...totals.map(t => t.items ?? 0));
    if (maxItems > 0) {
      // Only consider stores that cover at least 70% of the max item count
      const threshold = Math.floor(maxItems * 0.7);
      const candidates = totals.filter(t => (t.items ?? 0) >= threshold);
      if (candidates.length > 0) {
        const cheapest = candidates.reduce((min, c) => c.total < min.total ? c : min);
        cheapest.cheapest = true;
      }
    } else {
      // No item counts available — fallback to highest total (most items likely)
      // This is a heuristic: if we can't tell item counts, the store with the highest total
      // probably has the most items. Only mark cheapest if totals are within 30% of each other.
      const sorted = [...totals].sort((a, b) => b.total - a.total);
      const highest = sorted[0].total;
      const lowest = sorted[sorted.length - 1].total;
      if (lowest / highest >= 0.7) {
        // Totals are comparable — safe to pick cheapest
        const cheapest = totals.reduce((min, c) => c.total < min.total ? c : min);
        cheapest.cheapest = true;
      } else {
        // Big disparity — likely different item counts. Pick store with highest total as "recommended"
        // (it covers the most items). Don't mark any as "cheapest" since it's misleading.
        sorted[0].cheapest = true;
      }
    }
  }
  return totals;
}

/** Parse [[option1|option2|...]] button suggestions from AI messages */
function parseButtonSuggestions(content: string): { text: string; buttons: ChatButton[] } {
  const match = content.match(/\[\[([^\]]+)\]\]\s*$/);
  if (!match) return { text: content, buttons: [] };
  const text = content.slice(0, match.index).trimEnd();
  const buttons = match[1].split('|').map(opt => ({
    label: opt.trim(),
    value: opt.trim(),
  }));
  return { text, buttons };
}

/** Strip split/single recommendation markers from content for display */
function stripRecommendationMarkers(content: string): string {
  return content
    .replace(/\[\[split\|[^\]]+\]\]/g, '')
    .replace(/\[\[single\|[^\]]+\]\]/g, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n'); // Clean up extra blank lines
}

function parseListItems(content: string): { canonical_name: string; category: string; store: string; price_paid: number; quantity: number }[] {
  const lines = content.split('\n');
  const items: { canonical_name: string; category: string; store: string; price_paid: number; quantity: number }[] = [];
  let currentCategory = '';
  for (const line of lines) {
    const catMatch = line.match(/^\*\*(.+?)\*\*\s*$/);
    if (catMatch) {
      currentCategory = catMatch[1].trim();
      continue;
    }
    const itemMatch = line.match(/^-\s+(.+?)\s+[—–-]\s+(Tesco|Dunnes|SuperValu|Aldi|Lidl)\s+€(\d+(?:\.\d{2})?)/i);
    if (itemMatch && currentCategory) {
      items.push({
        canonical_name: itemMatch[1].trim(),
        category: currentCategory,
        store: itemMatch[2].toLowerCase(),
        price_paid: parseFloat(itemMatch[3]),
        quantity: 1,
      });
    }
  }
  return items;
}

function parseSplitRecommendation(content: string): StoreRecommendation {
  // Look for [[split|...]] marker
  const splitMatch = content.match(/\[\[split\|([^\]]+)\]\]/);
  if (splitMatch) {
    const params = Object.fromEntries(
      splitMatch[1].split("|").map(p => p.split(":") as [string, string])
    );
    return {
      type: "split",
      mainStore: params.mainStore,
      mainTotal: parseFloat(params.mainTotal),
      mainItems: parseInt(params.mainItems, 10),
      splitStore: params.splitStore,
      splitTotal: parseFloat(params.splitTotal),
      savings: parseFloat(params.savings),
      splitItems: params.splitItems ? params.splitItems.split(",").map(s => s.trim()) : [],
    };
  }

  // Look for [[single|...]] marker
  const singleMatch = content.match(/\[\[single\|([^\]]+)\]\]/);
  if (singleMatch) {
    const params = Object.fromEntries(
      singleMatch[1].split("|").map(p => p.split(":") as [string, string])
    );
    return {
      type: "single",
      store: params.store,
      total: parseFloat(params.total),
      reason: params.savings ? `Splitting only saves €${parseFloat(params.savings).toFixed(2)}, not worth the extra trip` : undefined,
    };
  }

  return null;
}

function calcSavings(totals: StoreTotal[]): number | null {
  if (totals.length < 2) return null;
  const sorted = [...totals].sort((a, b) => a.total - b.total);
  return Math.round((sorted[sorted.length - 1].total - sorted[0].total) * 100) / 100;
}

// ─── UI Sub-Components ──────────────────────────────────────────────────

function AnimatedPrice({ target }: { target: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const start = ref.current;
    const diff = target - start;
    const duration = 600;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= duration) { setDisplay(target); ref.current = target; return; }
      const progress = elapsed / duration;
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round((start + diff * eased) * 100) / 100);
      requestAnimationFrame(tick);
    };
    tick();
  }, [target]);
  return <span>€{display.toFixed(2)}</span>;
}

function RichText({ text, className, style }: { text: string; className?: string; style?: React.CSSProperties }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span className={className} style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function BlurredText({ children, unlocked }: { children: React.ReactNode; unlocked: boolean }) {
  return (
    <span
      className="transition-all duration-[600ms]"
      style={{
        filter: unlocked ? 'none' : 'blur(5px)',
        userSelect: unlocked ? 'auto' : 'none',
        WebkitUserSelect: unlocked ? 'auto' : 'none',
      }}
    >
      {children}
    </span>
  );
}

function ListItemLine({ text, unlocked }: { text: string; unlocked: boolean }) {
  // Match: "- Item name ... Store €X.XX" pattern
  const storeMatch = text.match(/^(-\s*.+?)\s+(Tesco|Dunnes|SuperValu|Aldi|Lidl)\s+(€\d+\.\d{2})/i);
  if (storeMatch) {
    const [, itemPart, store, price] = storeMatch;
    return (
      <div className="flex justify-between items-baseline gap-2">
        <RichText text={itemPart} style={{ color: 'var(--on-surface)' }} />
        <BlurredText unlocked={unlocked}>
          <span className="text-xs whitespace-nowrap" style={{ color: storeStyle(store).bg }}>
            {storeDisplayName(store)} {price}
          </span>
        </BlurredText>
      </div>
    );
  }
  return <RichText text={text} style={{ color: 'var(--on-surface)' }} />;
}

function FormattedMessage({ content, unlocked = true }: { content: string; unlocked?: boolean }) {
  // Strip split/single recommendation markers
  const cleanedContent = content
    .replace(/^\[\[(split|single)\|[^\]]+\]\]$/gm, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n'); // Clean up extra blank lines

  const lines = cleanedContent.split('\n');
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let i = 0;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    elements.push(
      <ul key={elements.length} className="space-y-1 my-1">
        {listBuffer.map((item, idx) => (
          <li key={idx}><ListItemLine text={item} unlocked={unlocked} /></li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  const parseTable = (startIndex: number) => {
    const tableLines: string[] = [];
    let currentIndex = startIndex;

    // Collect all consecutive table lines
    while (currentIndex < lines.length && lines[currentIndex].trim().startsWith('|')) {
      tableLines.push(lines[currentIndex].trim());
      currentIndex++;
    }

    if (tableLines.length === 0) return startIndex;

    // Filter out separator rows (like |---|---|---|)
    const dataLines = tableLines.filter(line => !line.match(/^\|[\s\-|]+\|$/));

    if (dataLines.length === 0) return currentIndex - 1;

    // Parse table rows
    const rows = dataLines.map(line =>
      line.split('|').slice(1, -1).map(cell => cell.trim())
    );

    if (rows.length === 0) return currentIndex - 1;

    const [headerRow, ...dataRows] = rows;

    // Render table
    elements.push(
      <table key={elements.length} className="w-full text-xs my-2 border-collapse">
        <thead>
          <tr>
            {headerRow.map((header, idx) => (
              <th key={idx} className="text-left font-semibold py-1 px-2 border-b border-gray-200"
                  style={{ color: 'var(--on-surface)' }}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, rowIdx) => (
            <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-gray-50/50' : ''}>
              {row.map((cell, cellIdx) => {
                const isStoreColumn = headerRow[cellIdx]?.toLowerCase() === 'store';
                const isPriceColumn = headerRow[cellIdx]?.toLowerCase() === 'price';

                return (
                  <td key={cellIdx} className={`py-1 px-2 ${isPriceColumn ? 'text-right' : ''}`}>
                    {isPriceColumn ? (
                      <BlurredText unlocked={unlocked}>
                        <span style={{ color: 'var(--primary)' }}>{cell}</span>
                      </BlurredText>
                    ) : isStoreColumn ? (
                      <span style={{ color: storeStyle(cell).bg }}>
                        {storeDisplayName(cell)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--on-surface)' }}>{cell}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );

    return currentIndex - 1;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('|')) {
      // Table detected
      flushList();
      i = parseTable(i);
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      listBuffer.push(line);
    } else {
      flushList();
      if (line.startsWith('### ')) {
        elements.push(<h3 key={elements.length} className="font-bold mt-3 mb-1" style={{ color: 'var(--on-surface)' }}>{line.slice(4)}</h3>);
      } else if (line.startsWith('## ')) {
        elements.push(<h2 key={elements.length} className="font-bold text-base mt-3 mb-1" style={{ color: 'var(--on-surface)' }}>{line.slice(3)}</h2>);
      } else if (line.match(/^\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?:?\s*€/i)) {
        // Store total line
        const m = line.match(/^\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?:?\s*€?(\d+(?:\.\d{2})?)/i);
        if (m) {
          const store = m[1];
          const total = parseFloat(m[2]);
          const totals = parseStoreTotals(cleanedContent);
          const isCheapest = totals.find(t => t.store === store.toLowerCase())?.cheapest;
          elements.push(
            <div key={elements.length} className={`flex justify-between items-center py-1 px-2 rounded ${isCheapest ? 'ring-1 ring-green-500/30' : ''}`}
              style={{ background: isCheapest ? 'var(--primary-container)' : 'transparent' }}>
              <span className="font-medium" style={{ color: storeStyle(store).bg }}>{storeDisplayName(store)}</span>
              <BlurredText unlocked={unlocked}>
                <span className="font-bold" style={{ color: isCheapest ? 'var(--primary)' : 'var(--on-surface)' }}>
                  <AnimatedPrice target={total} />
                  {isCheapest && ' ✓'}
                </span>
              </BlurredText>
            </div>
          );
        }
      } else if (line.trim()) {
        elements.push(<p key={elements.length} className="my-1"><RichText text={line} style={{ color: 'var(--on-surface)' }} /></p>);
      } else {
        elements.push(<div key={elements.length} className="h-2" />);
      }
    }
    i++;
  }
  flushList();
  return <div className="space-y-0.5">{elements}</div>;
}

function InlineButtons({ buttons, onSelect, disabled }: {
  buttons: ChatButton[];
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {buttons.map((btn, i) => (
        <button key={i} onClick={() => !disabled && onSelect(btn.value)}
          disabled={disabled}
          className="px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'var(--primary-container)', color: 'var(--on-primary-container)', border: '1px solid var(--primary)' }}>
          {btn.emoji && <span className="mr-1">{btn.emoji}</span>}{btn.label}
        </button>
      ))}
    </div>
  );
}

function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'My Grocery List', text }); } catch {}
    } else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <button onClick={handleShare}
      className="btn-secondary px-3 py-1.5 text-xs font-semibold rounded-xl flex items-center gap-1.5">
      {copied ? '✓ Copied' : '📤 Share list'}
    </button>
  );
}

function UnlockCTA({ householdSize, savings, onUnlocked }: {
  householdSize: number;
  savings: number | null;
  onUnlocked: () => void;
}) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, familySize: householdSize }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to sign up');
      }
      const data = await res.json();
      if (data.token) {
        saveSession({ token: data.token, email, familySize: String(householdSize), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
      }
      trackEvent('signup_completed', undefined, data.token);
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl p-4 mb-3" style={{ background: 'var(--primary-container)', border: '1px solid var(--primary)' }}>
      <p className="text-sm font-semibold mb-2" style={{ color: 'var(--on-primary-container)' }}>
        {savings
          ? `🔓 Sign up to see which store saves you €${savings.toFixed(2)} this week`
          : '🔓 Sign up to unlock store-by-store prices'}
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          className="flex-1 px-3 py-2 rounded-lg text-sm"
          style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--outline-variant)', color: 'var(--on-surface)' }}
        />
        <button type="submit" disabled={loading}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--primary)' }}>
          {loading ? '...' : 'Unlock'}
        </button>
      </form>
      {error && <p className="text-xs mt-1 text-red-500">{error}</p>}
      <p className="text-xs mt-2 opacity-70" style={{ color: 'var(--on-primary-container)' }}>
        100% free · No card needed · Unsubscribe anytime
      </p>
    </div>
  );
}

function StreamingDots({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{message}</span>
      <span className="flex gap-0.5">
        {[0, 1, 2].map(i => (
          <span key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
            style={{ background: 'var(--primary)', animationDelay: `${i * 150}ms` }} />
        ))}
      </span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function HomePlanner() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressIdx, setProgressIdx] = useState(0);
  const [buttonsDisabled, setButtonsDisabled] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [listContent, setListContent] = useState('');
  const [hasGeneratedList, setHasGeneratedList] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [savedAfterUnlock, setSavedAfterUnlock] = useState(false);
  const [profile, setProfile] = useState<PlannerProfile>({
    adults: 1, children: 0, childAges: [],
    preferredStores: ['all'], dietary: [],
    meals: { breakfast: true, lunch: true, dinner: true, snacks: false },
    batchCooking: false,
  });

  const [refreshData, setRefreshData] = useState<RefreshData | null>(null);
  const [showRefreshCard, setShowRefreshCard] = useState(false);
  const [splitRecommendation, setSplitRecommendation] = useState<StoreRecommendation>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sameAgainModeRef = useRef(false);

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
    if (!buttons) {
      const parsed = parseButtonSuggestions(content);
      const cleanContent = stripRecommendationMarkers(parsed.text);
      setMessages(prev => [...prev, { id: msgId(), role, content: cleanContent, buttons: parsed.buttons.length > 0 ? parsed.buttons : undefined }]);
    } else {
      const cleanContent = stripRecommendationMarkers(content);
      setMessages(prev => [...prev, { id: msgId(), role, content: cleanContent, buttons }]);
    }
  }, []);

  // ── Auto-save conversation + list after generation + unlock ──
  const autoSaveConversation = useCallback(async (content: string, msgs: ChatMessage[]) => {
    const session = loadSession();
    if (!session?.token || !content) return;

    try {
      const storeTotals = parseStoreTotals(content);
      const title = 'Weekly grocery plan';

      const convMessages = msgs
        .filter(m => m.content)
        .map(m => ({ role: m.role, content: m.content, timestamp: new Date().toISOString() }));

      // Save list
      const listRes = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: session.token,
          name: title,
          items: [],
          store_totals: storeTotals.map(t => ({ store: t.store, total: t.total, ...(t.items ? { items: t.items } : {}) })),
          is_default: true,
        }),
      });
      const listData = listRes.ok ? await listRes.json() : null;
      const listId = listData?.list?.id ?? null;

      // Create conversation
      const convRes = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: session.token,
          title,
          profile,
          messages: convMessages,
          list_id: listId,
        }),
      });
      const convData = convRes.ok ? await convRes.json() : null;
      if (convData?.conversation?.id) {
        setConversationId(convData.conversation.id);
        trackEvent('conversation_started', undefined, session.token);
      }

      // Save profile server-side
      await fetch('/api/household', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.token, ...profile }),
      }).catch(() => {});

      // Save list items
      const items = parseListItems(content);
      if (items.length > 0 && session.token) {
        await fetch('/api/list/save-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: session.token, items }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Auto-save failed:', err);
    }
  }, [profile]);

  // ── Auto-save after unlock ──
  useEffect(() => {
    if (isUnlocked && listContent && hasGeneratedList && !savedAfterUnlock && !conversationId) {
      setSavedAfterUnlock(true);
      autoSaveConversation(listContent, messages);
    }
  }, [isUnlocked, listContent, hasGeneratedList, savedAfterUnlock, conversationId, autoSaveConversation, messages]);

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
              saveProfile(userProfile);
            }
          }
        } catch {}
      }

      if (userProfile && session?.token) {
        // Returning user
        setProfile(userProfile);
        setIsUnlocked(true);

        // Check if they have a recent list to show the Smart Refresh card
        try {
          const refreshRes = await fetch(`/api/plan/refresh?token=${encodeURIComponent(session.token)}`);
          if (refreshRes.ok) {
            const data = await refreshRes.json();
            if (data.hasRecentList) {
              setRefreshData(data);
              setShowRefreshCard(true);
              return; // SmartRefreshCard replaces the greeting
            }
          }
        } catch {}

        // No recent list — show standard returning user greeting
        const people = userProfile.adults + userProfile.children;
        addMsg('assistant', `👋 Welcome back! Last time you planned for ${people} people. What would you like this week?\n\n[[Same as last time|Update my preferences|Start fresh]]`);
      } else {
        // New user — AI-first greeting
        addMsg('assistant', "👋 Hey! I\'m your grocery planning assistant. Tell me what you need — household size, any dietary requirements, budget — and I\'ll build you a priced weekly list.\n\nOr just say hi and I\'ll walk you through it!\n\n[[Family of 4, full week|Just me, dinners only|2 adults, vegetarian, €100]]");
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Send message to AI ──
  async function sendToAI(userText: string, allMessages: ChatMessage[]) {
    setIsGenerating(true);
    setProgressIdx(0);
    setButtonsDisabled(true);

    abortRef.current = new AbortController();
    try {
      const session = loadSession();

      // Build messages array for the API
      const apiMessages = allMessages
        .filter(m => m.content)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          intakeMode: true,
          returningUser: isUnlocked,
          hasLastList: sameAgainModeRef.current,
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
          // Check if this looks like a grocery list (has store totals)
          const totals = parseStoreTotals(content);
          if (totals.length > 0) {
            setListContent(content);
            if (!hasGeneratedList) {
              setHasGeneratedList(true);
              const items = parseListItems(content);
              const session = loadSession();
              trackEvent('list_generated', { item_count: items.length }, session?.token);
            }

            // Parse split recommendation
            const splitRec = parseSplitRecommendation(content);
            setSplitRecommendation(splitRec);
          }
          // Parse button suggestions from the streamed content and strip recommendation markers
          const { text: displayText, buttons } = parseButtonSuggestions(content);
          const cleanDisplayText = stripRecommendationMarkers(displayText);
          setMessages(prev => prev.map(m =>
            m.id === streamId ? { ...m, content: cleanDisplayText, buttons: buttons.length > 0 ? buttons : undefined } : m
          ));
        }
      }

      // Final parse for buttons and strip recommendation markers
      const { text: finalText, buttons: finalButtons } = parseButtonSuggestions(content);
      const cleanFinalText = stripRecommendationMarkers(finalText);
      setMessages(prev => prev.map(m =>
        m.id === streamId ? { ...m, content: cleanFinalText, buttons: finalButtons.length > 0 ? finalButtons : undefined } : m
      ));

      // If list was generated and user is already unlocked, auto-save
      if (parseStoreTotals(content).length > 0 && isUnlocked) {
        setListContent(content);
        setHasGeneratedList(true);
        const splitRec = parseSplitRecommendation(content);
        setSplitRecommendation(splitRec);
        const updatedMessages = [...allMessages, { id: streamId, role: 'assistant' as const, content }];
        autoSaveConversation(content, updatedMessages);
      }

    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addMsg('assistant', "Sorry, something went wrong. Try again?\n\n[[Try again]]");
      }
    } finally {
      setIsGenerating(false);
      setButtonsDisabled(false);
    }
  }

  // ── Handle user input (text or button click) ──
  function handleUserInput(text: string) {
    if (!text.trim() || isGenerating) return;

    // Add user message
    const userMsg: ChatMessage = { id: msgId(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setButtonsDisabled(true);

    // Track planner engagement
    const session = loadSession();
    const userMessageCount = messages.filter(m => m.role === 'user').length;
    if (userMessageCount === 0) {
      trackEvent('planner_started', undefined, session?.token);
    } else {
      trackEvent('planner_message', { message_index: userMessageCount }, session?.token);
    }

    // Send all messages (including this new one) to the AI
    setMessages(prev => {
      const allMsgs = [...prev];
      // Send to AI with the complete message history
      sendToAI(text, allMsgs);
      return allMsgs;
    });
  }

  // ── Smart Refresh Card handlers ──
  function handleSameAgain() {
    setShowRefreshCard(false);
    sameAgainModeRef.current = true;
    handleUserInput('Same again please');
  }

  function handleChangeThings() {
    setShowRefreshCard(false);
    const people = profile.adults + profile.children;
    addMsg('assistant', `👋 Welcome back! You last planned for ${people} people. What would you like to change this week?\n\n[[Same meals, different budget|Add more variety|Remove some items|Start fresh]]`);
  }

  // ── Render ──
  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto overflow-hidden">
      {/* Smart Refresh Card for returning users with a recent list */}
      {showRefreshCard && refreshData && (
        <SmartRefreshCard
          data={refreshData}
          onSameAgain={handleSameAgain}
          onModify={handleChangeThings}
        />
      )}

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
                <InlineButtons buttons={m.buttons} onSelect={handleUserInput} disabled={buttonsDisabled} />
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

      {/* Split Recommendation Card — only for unlocked users */}
      {hasGeneratedList && listContent && !isGenerating && isUnlocked && splitRecommendation && (
        <SplitRecommendationCard recommendation={splitRecommendation} />
      )}

      {/* Unlock CTA for non-signed-in users after list is generated */}
      {hasGeneratedList && listContent && !isGenerating && !isUnlocked && (
        <UnlockCTA
          householdSize={profile.adults + profile.children}
          savings={calcSavings(parseStoreTotals(listContent))}
          onUnlocked={() => setIsUnlocked(true)}
        />
      )}

      {/* Share button — only for unlocked users */}
      {hasGeneratedList && listContent && !isGenerating && isUnlocked && (
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
              hasGeneratedList
                ? "Change something... e.g. 'swap chicken for fish', 'add breakfast'"
                : isGenerating
                ? 'Building your list...'
                : 'Tell me what you need...'
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
