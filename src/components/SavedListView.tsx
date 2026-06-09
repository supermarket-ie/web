'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StoreTotal {
  store: string;
  total: number;
  item_count?: number;
}

interface StructuredItem {
  canonical_name: string;
  store: string;
  price: number;
  quantity?: number;
  category?: string;
  store_product_name?: string;
  on_promotion?: boolean;
}

interface ListSummary {
  id: string;
  name: string;
  store_totals: StoreTotal[];
  created_at: string;
}

interface HouseholdMemory {
  totalShops: number;
  avgWeeklySpend: number;
  usualStore: string;
  frequentItems: string[];
  droppedItems: string[];
}

interface Props {
  listContent: string | null;
  structuredItems?: StructuredItem[] | null;
  storeTotals: StoreTotal[];
  listName: string;
  createdAt: string;
  conversationId: string | null;
  token: string;
  allLists: ListSummary[];
  activeListId: string;
  householdMemory?: HouseholdMemory | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) { return `€${n.toFixed(2)}`; }

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(dateStr).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
}

function shortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--on-surface-variant)' }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Header card ─────────────────────────────────────────────────────────────

function ListHeaderCard({
  listName, createdAt, storeTotals, itemCount, onUpdateList, token, activeListId,
}: {
  listName: string;
  createdAt: string;
  storeTotals: StoreTotal[];
  itemCount: number;
  onUpdateList: () => void;
  token: string;
  activeListId: string;
}) {
  const sorted = [...storeTotals].sort((a, b) => a.total - b.total);
  const cheapest = sorted[0] ?? null;
  const mostExpensive = sorted[sorted.length - 1] ?? null;
  const saving = (cheapest && mostExpensive && sorted.length > 1 && cheapest.total / mostExpensive.total >= 0.7)
    ? Math.round((mostExpensive.total - cheapest.total) * 100) / 100
    : 0;

  return (
    <div className="rounded-2xl overflow-hidden mb-6"
      style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
      {/* Green header */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ background: '#00944A' }}>
        <div>
          <h1 className="text-white font-bold text-base leading-tight">{listName}</h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {timeAgo(createdAt)}{itemCount > 0 ? ` · ${itemCount} items` : ''}
          </p>
        </div>
        {cheapest && (
          <div className="text-right">
            <div className="text-white text-2xl font-extrabold">{fmt(cheapest.total)}</div>
            <div className="text-xs" style={{ color: 'rgba(255,255,255,0.75)' }}>{storeDisplayName(cheapest.store)}</div>
          </div>
        )}
      </div>

      {/* Store totals strip */}
      {sorted.length > 0 && (
        <div className="flex" style={{ borderTop: '1px solid var(--surface-container)' }}>
          {sorted.map((st, i) => {
            const s = storeStyle(st.store);
            const isBest = i === 0;
            return (
              <div key={st.store} className="flex-1 px-3 py-2.5 text-center min-w-0"
                style={{ borderRight: i < sorted.length - 1 ? '1px solid var(--surface-container)' : 'none' }}>
                <div className="text-xs font-semibold truncate" style={{ color: isBest ? s.bg : 'var(--on-surface-variant)' }}>
                  {storeDisplayName(st.store)}
                </div>
                <div className="text-sm font-bold mt-0.5" style={{ color: isBest ? s.bg : 'var(--on-surface)' }}>
                  {fmt(st.total)}
                </div>
                {isBest && saving > 0 && (
                  <div className="text-[10px] font-semibold mt-0.5" style={{ color: '#16a34a' }}>
                    Save {fmt(saving)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--surface-container)' }}>
        <button onClick={onUpdateList}
          className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: '#00944A' }}>
          Update Shop
        </button>
        <CopyButton storeTotals={storeTotals} listName={listName} />
      </div>
    </div>
  );
}

function CopyButton({ storeTotals, listName }: { storeTotals: StoreTotal[]; listName: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        const text = `${listName}\n${storeTotals.map(t => `${storeDisplayName(t.store)}: ${fmt(t.total)}`).join(' · ')}`;
        navigator.clipboard?.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
      style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
      {copied ? '✓' : 'Share'}
    </button>
  );
}

// ─── Quick actions ────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Reduce spend by €20', prompt: 'Can you reduce the spend by €20 while keeping the same meals?' },
  { label: 'Add packed lunches', prompt: 'Add packed lunches for the week.' },
  { label: 'Add household essentials', prompt: 'Add household essentials — cleaning, toiletries, etc.' },
  { label: 'Make healthier', prompt: 'Make the list healthier — swap some items for better alternatives.' },
  { label: 'Make gluten-free', prompt: 'Make this list gluten-free.' },
  { label: 'Use Aldi where possible', prompt: 'Optimise towards Aldi where possible.' },
  { label: "Add this week's offers", prompt: 'Add items currently on promotion that fit our usual shop.' },
];

function QuickActions({ conversationId, token }: { conversationId: string | null; token: string }) {
  return (
    <Section title="Continue with your Grocery Assistant">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
        {QUICK_ACTIONS.map(({ label, prompt }) => {
          const dest = conversationId
            ? `/dashboard/chat/${conversationId}?prefill=${encodeURIComponent(prompt)}`
            : `/?prefill=${encodeURIComponent(prompt)}&token=${encodeURIComponent(token)}`;
          return (
            <Link key={label} href={dest}
              className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-opacity hover:opacity-80"
              style={{ background: 'var(--surface-container-lowest)', color: 'var(--on-surface)', border: '1px solid var(--surface-container)' }}>
              {label}
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Shopping list with ticks ─────────────────────────────────────────────────

function ShoppingList({ items, listId, token }: { items: StructuredItem[]; listId: string; token: string }) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const pendingRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    fetch(`/api/list/checks?token=${encodeURIComponent(token)}&list_id=${listId}`)
      .then(r => r.json())
      .then(d => { setChecks(d.checks ?? {}); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [token, listId]);

  const toggle = useCallback((name: string) => {
    const next = !checks[name];
    setChecks(prev => ({ ...prev, [name]: next }));
    clearTimeout(pendingRef.current[name]);
    pendingRef.current[name] = setTimeout(() => {
      fetch('/api/list/checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, list_id: listId, canonical_name: name, checked: next }),
      }).catch(() => {});
    }, 400);
  }, [checks, token, listId]);

  const clearAll = useCallback(() => {
    setChecks({});
    fetch(`/api/list/checks?token=${encodeURIComponent(token)}&list_id=${listId}`, { method: 'DELETE' }).catch(() => {});
  }, [token, listId]);

  const grouped = new Map<string, StructuredItem[]>();
  for (const item of items) {
    const cat = item.category ?? 'Other';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(item);
  }

  const totalItems = items.length;
  const checkedCount = items.filter(i => checks[i.canonical_name]).length;

  return (
    <Section
      title="My Shop"
      action={checkedCount > 0 ? (
        <button onClick={clearAll} className="text-xs font-medium" style={{ color: 'var(--on-surface-variant)' }}>Reset</button>
      ) : undefined}
    >
      {/* Progress bar */}
      {loaded && totalItems > 0 && (
        <div className="mb-3">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs font-medium" style={{ color: 'var(--on-surface-variant)' }}>
              {checkedCount === 0 ? `${totalItems} items` : checkedCount === totalItems ? '✅ All done!' : `${checkedCount} of ${totalItems} items`}
            </span>
            {checkedCount > 0 && checkedCount < totalItems && (
              <span className="text-xs font-semibold" style={{ color: '#00944A' }}>
                {Math.round((checkedCount / totalItems) * 100)}%
              </span>
            )}
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-container)' }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{ width: `${(checkedCount / totalItems) * 100}%`, background: checkedCount === totalItems ? '#16a34a' : '#00944A' }} />
          </div>
        </div>
      )}

      <div className="space-y-4">
        {Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([cat, catItems]) => (
          <div key={cat}>
            <h4 className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--on-surface-variant)' }}>{cat}</h4>
            <div className="space-y-0.5">
              {catItems.map(item => {
                const isChecked = !!checks[item.canonical_name];
                const s = storeStyle(item.store);
                return (
                  <button key={item.canonical_name} onClick={() => toggle(item.canonical_name)}
                    className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl text-left transition-all"
                    style={{ background: isChecked ? 'var(--surface-container-low)' : 'var(--surface-container-lowest)', opacity: isChecked ? 0.55 : 1 }}>
                    {/* Checkbox */}
                    <span className="flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all"
                      style={{ borderColor: isChecked ? '#00944A' : 'var(--outline-variant)', background: isChecked ? '#00944A' : 'transparent' }}>
                      {isChecked && (
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="flex-1 text-sm font-medium truncate"
                      style={{ color: 'var(--on-background)', textDecoration: isChecked ? 'line-through' : 'none' }}>
                      {item.store_product_name ?? item.canonical_name}
                      {item.on_promotion && !isChecked && (
                        <span className="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded text-white align-middle" style={{ background: '#e85d04' }}>DEAL</span>
                      )}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white flex-shrink-0" style={{ background: s.bg }}>
                      {storeDisplayName(item.store)}
                    </span>
                    <span className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--on-background)' }}>
                      {fmt(item.price)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── Markdown fallback ────────────────────────────────────────────────────────

function MarkdownList({ content }: { content: string }) {
  function RichText({ text }: { text: string }) {
    return (
      <span>
        {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={i} style={{ color: 'var(--on-background)' }}>{part.slice(2, -2)}</strong>
            : <span key={i}>{part}</span>
        )}
      </span>
    );
  }

  return (
    <Section title="My Shop">
      <div className="rounded-2xl p-4 space-y-1" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
        {content.split('\n').map((line, i) => {
          if (!line.trim()) return <div key={i} className="h-1" />;
          if (line.startsWith('## ') || line.startsWith('### '))
            return <h4 key={i} className="text-xs font-bold uppercase tracking-wider mt-3 mb-1" style={{ color: 'var(--primary)' }}>{line.replace(/^#+\s/, '')}</h4>;
          if (line.startsWith('**') && line.endsWith('**'))
            return <h4 key={i} className="text-xs font-bold uppercase tracking-wider mt-3 mb-1" style={{ color: 'var(--primary)' }}>{line.slice(2, -2)}</h4>;
          if (line.startsWith('- ') || line.startsWith('* '))
            return <p key={i} className="text-sm py-0.5" style={{ color: 'var(--on-surface)' }}><RichText text={line.slice(2)} /></p>;
          if (line.match(/^\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?/i) || /store total|🏪/i.test(line)) return null;
          return <p key={i} className="text-sm" style={{ color: 'var(--on-surface)' }}><RichText text={line} /></p>;
        })}
      </div>
    </Section>
  );
}

// ─── Household intelligence ───────────────────────────────────────────────────

function HouseholdIntelligence({ memory, currentItems }: { memory: HouseholdMemory; currentItems: string[] }) {
  const currentSet = new Set(currentItems.map(n => n.toLowerCase()));
  const missing = memory.frequentItems.filter(name => !currentSet.has(name.toLowerCase())).slice(0, 5);
  if (missing.length === 0) return null;

  return (
    <Section title="Usually in your shop">
      <div className="rounded-2xl p-4" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
        <p className="text-xs mb-3" style={{ color: 'var(--on-surface-variant)' }}>
          These items are usually in your shop but aren&apos;t in this list:
        </p>
        <div className="flex flex-wrap gap-2">
          {missing.map(name => (
            <span key={name} className="text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
              + {name}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ─── Checkout card ────────────────────────────────────────────────────────────

function CheckoutCard({ storeTotals, listName }: { storeTotals: StoreTotal[]; listName: string }) {
  const [copied, setCopied] = useState(false);

  function handleExport() {
    const text = `${listName}\n\n${storeTotals.map(t => `${storeDisplayName(t.store)}: ${fmt(t.total)}`).join('\n')}`;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Section title="Checkout">
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--surface-container)' }}>
        <div className="flex items-center justify-between px-4 py-3.5"
          style={{ background: 'var(--surface-container-lowest)', borderBottom: '1px solid var(--surface-container)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: '#e4003b' }}>SV</div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--on-background)' }}>Send to SuperValu</p>
              <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>Direct checkout integration</p>
            </div>
          </div>
          <span className="text-xs font-semibold px-2 py-1 rounded-full"
            style={{ background: 'var(--surface-container)', color: 'var(--on-surface-variant)' }}>Coming soon</span>
        </div>

        <button onClick={handleExport}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left transition-opacity hover:opacity-80"
          style={{ background: 'var(--surface-container-lowest)', borderBottom: '1px solid var(--surface-container)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-container)' }}>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-sm font-semibold" style={{ color: 'var(--on-background)' }}>
              {copied ? '✓ Copied' : 'Copy list'}
            </span>
          </div>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--on-surface-variant)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <button onClick={() => alert('Email list — coming soon!')}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left transition-opacity hover:opacity-80"
          style={{ background: 'var(--surface-container-lowest)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-container)' }}>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-sm font-semibold" style={{ color: 'var(--on-background)' }}>Email list</span>
          </div>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--on-surface-variant)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </Section>
  );
}

// ─── History switcher ─────────────────────────────────────────────────────────

function HistorySwitcher({ allLists, activeListId, token }: { allLists: ListSummary[]; activeListId: string; token: string }) {
  if (allLists.length <= 1) return null;
  return (
    <Section title="Previous shops">
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
        {allLists.map(list => {
          const isActive = list.id === activeListId;
          const cheapest = [...(list.store_totals ?? [])].sort((a, b) => a.total - b.total)[0];
          return (
            <Link key={list.id} href={`/list?token=${encodeURIComponent(token)}&list=${list.id}`}
              className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all"
              style={isActive
                ? { background: '#00944A', color: '#fff' }
                : { background: 'var(--surface-container-lowest)', color: 'var(--on-surface)', border: '1px solid var(--surface-container)' }}>
              {shortDate(list.created_at)}
              {cheapest && <span className="ml-1.5 opacity-75">{fmt(cheapest.total)}</span>}
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function SavedListView({
  listContent, structuredItems, storeTotals, listName, createdAt,
  conversationId, token, allLists, activeListId, householdMemory,
}: Props) {
  const router = useRouter();
  const hasStructured = (structuredItems?.length ?? 0) > 0;
  const itemCount = hasStructured ? structuredItems!.length : 0;
  const currentItemNames = hasStructured ? structuredItems!.map(i => i.canonical_name) : [];

  function handleUpdateList() {
    router.push(conversationId ? `/dashboard/chat/${conversationId}` : `/?token=${encodeURIComponent(token)}`);
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
        <ListHeaderCard
          listName={listName} createdAt={createdAt} storeTotals={storeTotals}
          itemCount={itemCount} onUpdateList={handleUpdateList}
          token={token} activeListId={activeListId}
        />
        <QuickActions conversationId={conversationId} token={token} />
        {hasStructured
          ? <ShoppingList items={structuredItems!} listId={activeListId} token={token} />
          : listContent
          ? <MarkdownList content={listContent} />
          : (
            <Section title="My Shop">
              <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
                <p className="text-sm mb-3" style={{ color: 'var(--on-surface-variant)' }}>No items in this list yet.</p>
                <Link href="/" className="text-sm font-semibold" style={{ color: '#00944A' }}>Plan a new shop →</Link>
              </div>
            </Section>
          )}
        {householdMemory && currentItemNames.length > 0 && (
          <HouseholdIntelligence memory={householdMemory} currentItems={currentItemNames} />
        )}
        {storeTotals.length > 0 && (
          <CheckoutCard storeTotals={storeTotals} listName={listName} />
        )}
        <HistorySwitcher allLists={allLists} activeListId={activeListId} token={token} />
      </main>
    </div>
  );
}
