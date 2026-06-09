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

function shortDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Determine full/partial match stores and best basket */
function analyseStoreTotals(storeTotals: StoreTotal[], totalItems: number) {
  if (!storeTotals.length) return { sorted: [], best: null, fullMatches: [], partialMatches: [], hasItemCounts: false };

  const hasItemCounts = storeTotals.some(st => (st.item_count ?? 0) > 0);
  const maxTotal = Math.max(...storeTotals.map(s => s.total));
  const maxItemCount = hasItemCounts ? Math.max(...storeTotals.map(s => s.item_count ?? 0)) : 0;
  const threshold = totalItems > 0 ? Math.ceil(totalItems * 0.9)
    : hasItemCounts ? Math.ceil(maxItemCount * 0.9)
    : 0;

  const annotated = storeTotals.map(st => {
    const itemCount = st.item_count ?? 0;
    // A store is partial if:
    // (a) its total is <20% of the highest total (sanity check — catches €3.28 vs €74.44), OR
    // (b) item_count data exists and it's below the 90% threshold
    const isSuspiciouslyLow = maxTotal > 0 && (st.total / maxTotal) < 0.2;
    const isBelowThreshold = hasItemCounts && threshold > 0 && itemCount < threshold;
    const isFullMatch = !isSuspiciouslyLow && !isBelowThreshold;
    return { ...st, itemCount, isFullMatch };
  });

  const fullMatches = annotated.filter(s => s.isFullMatch).sort((a, b) => a.total - b.total);
  const partialMatches = annotated.filter(s => !s.isFullMatch);

  // Only crown a best when we have real item_count data
  const best = hasItemCounts ? (fullMatches[0] ?? null) : null;

  // In the display strip: show full matches always; only show partial matches
  // when we have item_count data (so we can label them clearly). Without
  // item_count, partial stores are just noise — hide them.
  const sorted = hasItemCounts
    ? [...fullMatches, ...partialMatches.sort((a, b) => b.itemCount - a.itemCount)]
    : fullMatches;  // hide suspiciously-low stores when we can't label them

  return { sorted, best, fullMatches, partialMatches, hasItemCounts };
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

// ─── Hero card ───────────────────────────────────────────────────────────────

function HeroCard({
  listName, createdAt, storeTotals, totalItems, onUpdateList, onShare,
}: {
  listName: string;
  createdAt: string;
  storeTotals: StoreTotal[];
  totalItems: number;
  onUpdateList: () => void;
  onShare: () => void;
}) {
  const { sorted, best, hasItemCounts } = analyseStoreTotals(storeTotals, totalItems);

  return (
    <div className="rounded-2xl overflow-hidden mb-6"
      style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
      {/* Green header */}
      <div className="px-4 py-4" style={{ background: '#00944A' }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">This Week&apos;s Shop</h1>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {totalItems > 0 ? `${totalItems} items` : ''}{totalItems > 0 && ' · '}{formatDate(createdAt)}
            </p>
          </div>
          {best && (
            <div className="text-right">
              <div className="text-white text-2xl font-extrabold">{fmt(best.total)}</div>
              <div className="text-xs" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {storeDisplayName(best.store)}
              </div>
            </div>
          )}
        </div>
        {hasItemCounts && totalItems > 0 && best && (
          <p className="text-xs mt-2 font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>
            {best.itemCount}/{totalItems} items matched
          </p>
        )}
      </div>

      {/* Store totals strip */}
      {sorted.length > 0 && (
        <div className="flex flex-wrap" style={{ borderTop: '1px solid var(--surface-container)' }}>
          {sorted.map((st, i) => {
            const s = storeStyle(st.store);
            const isBest = st.isFullMatch && i === sorted.findIndex(s => s.isFullMatch);
            return (
              <div key={st.store} className="flex-1 px-3 py-2.5 text-center min-w-0"
                style={{ borderRight: i < sorted.length - 1 ? '1px solid var(--surface-container)' : 'none', minWidth: '33%' }}>
                <div className="text-xs font-semibold truncate" style={{ color: isBest ? s.bg : 'var(--on-surface-variant)' }}>
                  {storeDisplayName(st.store)}
                </div>
                <div className="text-sm font-bold mt-0.5" style={{ color: isBest ? s.bg : 'var(--on-surface)' }}>
                  {fmt(st.total)}
                </div>
                {hasItemCounts && (
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
                    {st.itemCount}/{totalItems > 0 ? totalItems : '?'} items
                    {isBest && <span className="ml-1 font-bold" style={{ color: '#16a34a' }}> Best</span>}
                    {!st.isFullMatch && <span className="ml-1 font-bold" style={{ color: '#e85d04' }}> Partial</span>}
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
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: '#00944A' }}>
          Update Shop
        </button>
        <button onClick={onShare}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
          Share
        </button>
      </div>
    </div>
  );
}

// ─── Quick actions ────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Reduce spend by €20', prompt: 'Can you reduce the spend by €20 while keeping the same meals?' },
  { label: 'Add packed lunches', prompt: 'Add packed lunches for the week.' },
  { label: 'Add household essentials', prompt: 'Add household essentials — cleaning, toiletries, etc.' },
  { label: 'Make healthier', prompt: 'Make the list healthier — swap some items for better alternatives.' },
  { label: 'Use Aldi where possible', prompt: 'Optimise towards Aldi where possible.' },
  { label: 'Compare stores', prompt: 'Compare all stores for this list — show me where each item is cheapest.' },
];

function QuickActions({ conversationId, token }: { conversationId: string | null; token: string }) {
  return (
    <Section title="Quick actions">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
        {QUICK_ACTIONS.map(({ label, prompt }) => {
          const dest = conversationId
            ? `/dashboard/chat/${conversationId}?prefill=${encodeURIComponent(prompt)}`
            : `/?prefill=${encodeURIComponent(prompt)}&token=${encodeURIComponent(token)}`;
          return (
            <Link key={label} href={dest}
              className="flex-shrink-0 px-3.5 py-2.5 rounded-xl text-xs font-medium whitespace-nowrap transition-opacity hover:opacity-80"
              style={{ background: 'var(--surface-container-lowest)', color: 'var(--on-surface)', border: '1px solid var(--outline-variant)' }}>
              {label}
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

// ─── Progress bar (sticky) ───────────────────────────────────────────────────

function ProgressBar({ checked, total }: { checked: number; total: number }) {
  if (total === 0) return null;
  const pct = Math.round((checked / total) * 100);
  return (
    <div className="sticky top-0 z-10 py-2 px-4 -mx-4 mb-4" style={{ background: 'var(--surface)' }}>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-medium" style={{ color: 'var(--on-surface-variant)' }}>
          {checked === 0 ? `${total} items` : checked === total ? '✅ All done!' : `${checked} of ${total} items`}
        </span>
        {checked > 0 && checked < total && (
          <span className="text-xs font-semibold" style={{ color: '#00944A' }}>{pct}%</span>
        )}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-container)' }}>
        <div className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: checked === total ? '#16a34a' : '#00944A' }} />
      </div>
    </div>
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
    setChecks(prev => {
      const next = !prev[name];
      const updated = { ...prev, [name]: next };

      clearTimeout(pendingRef.current[name]);
      pendingRef.current[name] = setTimeout(() => {
        fetch('/api/list/checks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, list_id: listId, canonical_name: name, checked: next }),
        }).catch(() => {});
      }, 400);

      return updated;
    });
  }, [token, listId]);

  const clearAll = useCallback(() => {
    setChecks({});
    fetch(`/api/list/checks?token=${encodeURIComponent(token)}&list_id=${listId}`, { method: 'DELETE' }).catch(() => {});
  }, [token, listId]);

  // Group by category
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
      title="Shopping List"
      action={checkedCount > 0 ? (
        <button onClick={clearAll} className="text-xs font-medium" style={{ color: 'var(--on-surface-variant)' }}>Reset</button>
      ) : undefined}
    >
      {loaded && <ProgressBar checked={checkedCount} total={totalItems} />}

      <div className="space-y-5">
        {Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([cat, catItems]) => (
          <div key={cat}>
            <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--on-surface-variant)' }}>{cat}</h4>
            <div className="space-y-1">
              {catItems.map(item => {
                const isChecked = !!checks[item.canonical_name];
                const s = storeStyle(item.store);
                return (
                  <button key={item.canonical_name} onClick={() => toggle(item.canonical_name)}
                    className="w-full flex items-center gap-3 rounded-xl text-left transition-all"
                    style={{
                      background: isChecked ? 'var(--surface-container)' : 'var(--surface-container-lowest)',
                      opacity: isChecked ? 0.55 : 1,
                      minHeight: '44px',
                      padding: '10px 12px',
                    }}>
                    {/* Checkbox */}
                    <span className="flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all"
                      style={{ borderColor: isChecked ? '#00944A' : 'var(--outline-variant)', background: isChecked ? '#00944A' : 'transparent' }}>
                      {isChecked && (
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="white" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {/* Product name */}
                    <span className="flex-1 text-sm font-medium truncate"
                      style={{ color: 'var(--on-background)', textDecoration: isChecked ? 'line-through' : 'none' }}>
                      {item.store_product_name ?? item.canonical_name}
                      {item.on_promotion && !isChecked && (
                        <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded text-white align-middle" style={{ background: '#e85d04' }}>DEAL</span>
                      )}
                    </span>
                    {/* Store badge */}
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white flex-shrink-0" style={{ background: s.bg }}>
                      {storeDisplayName(item.store)}
                    </span>
                    {/* Price */}
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

// ─── Fallback (no structured items) ──────────────────────────────────────────

function FallbackCard({ listContent }: { listContent: string | null }) {
  return (
    <Section title="Shopping List">
      <div className="rounded-2xl p-5" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
        <p className="text-sm mb-4" style={{ color: 'var(--on-surface-variant)' }}>
          We couldn&apos;t create the full shopping-list view for this plan yet.
        </p>
        {listContent && (
          <details className="mt-2">
            <summary className="text-sm font-medium cursor-pointer" style={{ color: 'var(--primary)' }}>
              View original plan
            </summary>
            <div className="mt-3 text-sm whitespace-pre-wrap" style={{ color: 'var(--on-surface)' }}>
              {listContent}
            </div>
          </details>
        )}
        {!listContent && (
          <Link href="/" className="text-sm font-semibold" style={{ color: '#00944A' }}>
            Plan a new shop →
          </Link>
        )}
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

function CheckoutCard({ structuredItems, storeTotals, listName }: { structuredItems?: StructuredItem[] | null; storeTotals: StoreTotal[]; listName: string }) {
  const [copied, setCopied] = useState(false);

  function buildPlainText() {
    if (structuredItems && structuredItems.length > 0) {
      const lines = structuredItems.map(item =>
        `${item.store_product_name ?? item.canonical_name} — ${storeDisplayName(item.store)} ${fmt(item.price)}`
      );
      const totals = storeTotals.map(t => `${storeDisplayName(t.store)}: ${fmt(t.total)}`).join(' · ');
      return `${listName}\n\n${lines.join('\n')}\n\n${totals}`;
    }
    return `${listName}\n\n${storeTotals.map(t => `${storeDisplayName(t.store)}: ${fmt(t.total)}`).join('\n')}`;
  }

  function handleCopy() {
    navigator.clipboard?.writeText(buildPlainText()).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Section title="Checkout">
      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--surface-container)' }}>
        {/* SuperValu integration */}
        <div className="flex items-center justify-between px-4"
          style={{ background: 'var(--surface-container-lowest)', borderBottom: '1px solid var(--surface-container)', minHeight: '56px' }}>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--on-background)' }}>Send to checkout</p>
              <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>Coming soon</p>
            </div>
          </div>
        </div>

        {/* Copy list */}
        <button onClick={handleCopy}
          className="w-full flex items-center justify-between px-4 text-left transition-opacity hover:opacity-80"
          style={{ background: 'var(--surface-container-lowest)', borderBottom: '1px solid var(--surface-container)', minHeight: '52px' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--surface-container)' }}>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-sm font-semibold" style={{ color: 'var(--on-background)' }}>
              {copied ? '✓ Copied to clipboard' : 'Copy list'}
            </span>
          </div>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--on-surface-variant)' }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Email list */}
        <button onClick={() => alert('Email list — coming soon!')}
          className="w-full flex items-center justify-between px-4 text-left transition-opacity hover:opacity-80"
          style={{ background: 'var(--surface-container-lowest)', minHeight: '52px' }}>
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
              className="flex-shrink-0 px-3.5 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all"
              style={isActive
                ? { background: '#00944A', color: '#fff' }
                : { background: 'var(--surface-container-lowest)', color: 'var(--on-surface)', border: '1px solid var(--outline-variant)' }}>
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
  const totalItems = hasStructured ? structuredItems!.length : 0;
  const currentItemNames = hasStructured ? structuredItems!.map(i => i.canonical_name) : [];

  function handleUpdateList() {
    router.push(conversationId ? `/dashboard/chat/${conversationId}` : `/?token=${encodeURIComponent(token)}`);
  }

  function handleShare() {
    const text = `${listName} — ${totalItems} items`;
    if (navigator.share) {
      navigator.share({ title: listName, text, url: window.location.href }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(window.location.href).catch(() => {});
    }
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
        {/* Hero card */}
        <HeroCard
          listName={listName}
          createdAt={createdAt}
          storeTotals={storeTotals}
          totalItems={totalItems}
          onUpdateList={handleUpdateList}
          onShare={handleShare}
        />

        {/* Quick actions */}
        <QuickActions conversationId={conversationId} token={token} />

        {/* Shopping list or fallback */}
        {hasStructured
          ? <ShoppingList items={structuredItems!} listId={activeListId} token={token} />
          : <FallbackCard listContent={listContent} />
        }

        {/* Household intelligence */}
        {householdMemory && currentItemNames.length > 0 && (
          <HouseholdIntelligence memory={householdMemory} currentItems={currentItemNames} />
        )}

        {/* Checkout card */}
        <CheckoutCard structuredItems={structuredItems} storeTotals={storeTotals} listName={listName} />

        {/* History switcher */}
        <HistorySwitcher allLists={allLists} activeListId={activeListId} token={token} />
      </main>
    </div>
  );
}
