'use client';

import Link from 'next/link';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';

// ─── Types ──────────────────────────────────────────────────────────────

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
}

// ─── Helpers ────────────────────────────────────────────────────────────

function fmt(price: number) {
  return `€${price.toFixed(2)}`;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(dateStr).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
}

function shortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
}

// ─── List switcher tabs ──────────────────────────────────────────────────

function ListSwitcher({ allLists, activeListId, token }: { allLists: ListSummary[]; activeListId: string; token: string }) {
  if (allLists.length <= 1) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 mb-6 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
      {allLists.map(list => {
        const isActive = list.id === activeListId;
        const cheapest = list.store_totals?.[0];
        const total = cheapest ? fmt(cheapest.total) : null;
        return (
          <Link
            key={list.id}
            href={`/list?token=${encodeURIComponent(token)}&list=${list.id}`}
            className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap"
            style={isActive
              ? { background: '#00944A', color: '#fff' }
              : { background: 'var(--surface-container-lowest)', color: 'var(--on-surface)', border: '1px solid var(--surface-container)' }
            }
          >
            <span>{shortDate(list.created_at)}</span>
            {total && <span className="ml-1.5 opacity-75">{total}</span>}
          </Link>
        );
      })}
      <Link
        href="/"
        className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap"
        style={{ background: 'var(--surface-container-lowest)', color: '#00944A', border: '1px dashed #00944A' }}
      >
        + Plan new week
      </Link>
    </div>
  );
}

// ─── Structured item renderer ────────────────────────────────────────────

function StructuredItemList({ items, storeTotals }: { items: StructuredItem[]; storeTotals: StoreTotal[] }) {
  // Group by category
  const grouped = new Map<string, StructuredItem[]>();
  for (const item of items) {
    const cat = item.category ?? 'Other';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(item);
  }
  const categories = Array.from(grouped.keys()).sort();

  return (
    <div className="space-y-4">
      {categories.map(cat => (
        <div key={cat}>
          <h4 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--primary)' }}>
            {cat}
          </h4>
          <div className="space-y-1">
            {grouped.get(cat)!.map((item, i) => {
              const s = storeStyle(item.store);
              return (
                <div key={i} className="flex items-center gap-3 py-1.5 px-2 rounded-xl"
                  style={{ background: 'var(--surface-container-lowest)' }}>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate block" style={{ color: 'var(--on-background)' }}>
                      {item.store_product_name ?? item.canonical_name}
                      {item.on_promotion && <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: '#e85d04' }}>DEAL</span>}
                    </span>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white flex-shrink-0"
                    style={{ background: s.bg }}>
                    {storeDisplayName(item.store)}
                  </span>
                  <span className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--on-background)' }}>
                    {fmt(item.price)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Store totals */}
      {storeTotals.length > 0 && (
        <div className="pt-4 border-t" style={{ borderColor: 'var(--surface-container)' }}>
          <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--on-surface-variant)' }}>
            Store totals
          </h4>
          <div className="flex flex-wrap gap-2">
            {storeTotals.map((t, i) => (
              <div key={i} className="px-4 py-2.5 rounded-xl text-white text-sm font-bold flex items-center gap-2"
                style={{ background: storeStyle(t.store).bg }}>
                <span>{storeDisplayName(t.store)}</span>
                <span>{fmt(t.total)}</span>
                {t.item_count && <span className="text-[10px] opacity-75">{t.item_count} items</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Rich text rendering (markdown fallback) ─────────────────────────────

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} style={{ color: 'var(--on-background)' }}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

function FormattedListContent({ content }: { content: string }) {
  const lines = content.split('\n');

  const storeTotals: Array<{ store: string; total: number; items?: number; cheapest?: boolean }> = [];
  let inTotalsSection = false;

  for (const line of lines) {
    if (line.toLowerCase().includes('store total') || line.toLowerCase().includes('best value')) {
      inTotalsSection = true;
      continue;
    }
    if (inTotalsSection && line.trim() === '') break;
    if (inTotalsSection) {
      const m = line.match(/\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?:?\s*€?(\d+(?:\.\d{2})?)\s*(?:\((\d+)\s*items?\))?/i);
      if (m) {
        const total = parseFloat(m[2]);
        const items = m[3] ? parseInt(m[3], 10) : undefined;
        if (!isNaN(total)) storeTotals.push({ store: m[1].toLowerCase(), total, items });
      }
    }
  }
  if (storeTotals.length > 0) {
    const maxItems = Math.max(...storeTotals.map(t => t.items ?? 0));
    if (maxItems > 0) {
      const threshold = Math.floor(maxItems * 0.7);
      const candidates = storeTotals.filter(t => (t.items ?? 0) >= threshold);
      if (candidates.length > 0) {
        const cheapest = candidates.reduce((min, c) => c.total < min.total ? c : min);
        cheapest.cheapest = true;
      }
    } else {
      const sorted = [...storeTotals].sort((a, b) => b.total - a.total);
      const highest = sorted[0].total;
      const lowest = sorted[sorted.length - 1].total;
      if (lowest / highest >= 0.7) {
        const cheapest = storeTotals.reduce((min, c) => c.total < min.total ? c : min);
        cheapest.cheapest = true;
      } else {
        sorted[0].cheapest = true;
      }
    }
  }

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />;
        if (line.startsWith('### ')) return (
          <h3 key={i} className="font-bold text-base mt-5 mb-2 pt-3 border-t first:border-t-0 first:pt-0" style={{ color: 'var(--on-background)', borderColor: 'var(--surface-container)' }}>
            <RichText text={line.slice(4)} />
          </h3>
        );
        if (line.startsWith('## ')) return (
          <h2 key={i} className="font-bold text-lg mt-6 mb-2" style={{ color: 'var(--on-background)' }}>
            <RichText text={line.slice(3)} />
          </h2>
        );
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4 && !line.slice(2, -2).includes('**')) return (
          <h4 key={i} className="text-xs font-bold uppercase tracking-wider mt-4 mb-1" style={{ color: 'var(--primary)' }}>
            {line.slice(2, -2)}
          </h4>
        );
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={i} className="flex items-start gap-2 py-0.5 pl-1">
              <span className="text-xs mt-1.5 flex-shrink-0" style={{ color: 'var(--primary)' }}>●</span>
              <p className="text-sm leading-relaxed flex-1" style={{ color: 'var(--on-surface)' }}>
                <RichText text={line.slice(2)} />
              </p>
            </div>
          );
        }
        if (line.startsWith('---')) return <hr key={i} className="my-4" style={{ borderColor: 'var(--surface-container)' }} />;
        if (line.startsWith('💡') || line.startsWith('🔔') || line.startsWith('⚠️')) return (
          <div key={i} className="mt-3 p-3 rounded-xl" style={{ background: 'var(--primary-fixed)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--on-primary-container)' }}><RichText text={line} /></p>
          </div>
        );
        if (line.match(/\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?:?\s*€?\d+/i)) return null;
        if (line.toLowerCase().includes('store total') || line.toLowerCase().includes('best value')) return null;
        return <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--on-surface)' }}><RichText text={line} /></p>;
      })}

      {storeTotals.length > 0 && (
        <div className="mt-6 pt-4 border-t" style={{ borderColor: 'var(--surface-container)' }}>
          <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--on-surface-variant)' }}>
            Store totals
          </h4>
          <div className="flex flex-wrap gap-2">
            {storeTotals.map((t, i) => (
              <div key={i} className="px-4 py-2.5 rounded-xl text-white text-sm font-bold flex items-center gap-2" style={{ background: storeStyle(t.store).bg }}>
                <span>{storeDisplayName(t.store)}</span>
                <span>€{t.total.toFixed(2)}</span>
                {t.cheapest && <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">Best</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export function SavedListView({ listContent, structuredItems, storeTotals, listName, createdAt, conversationId, token, allLists, activeListId }: Props) {
  const sorted = [...storeTotals].sort((a, b) => b.total - a.total);
  const highest = sorted[0]?.total ?? 0;
  const lowest = sorted[sorted.length - 1]?.total ?? 0;
  const totalsComparable = highest > 0 && (lowest / highest) >= 0.7;

  let recommended: typeof sorted[0] | null = null;
  let saving = 0;

  if (totalsComparable && sorted.length > 1) {
    const cheapestFirst = [...sorted].sort((a, b) => a.total - b.total);
    recommended = cheapestFirst[0];
    saving = Math.round((cheapestFirst[cheapestFirst.length - 1].total - cheapestFirst[0].total) * 100) / 100;
  } else if (sorted.length > 0) {
    recommended = sorted[0];
    saving = 0;
  }

  const displaySorted = totalsComparable
    ? [...storeTotals].sort((a, b) => a.total - b.total)
    : [...storeTotals].sort((a, b) => b.total - a.total);

  // Use structured items if available, fall back to markdown
  const hasStructured = structuredItems && structuredItems.length > 0;

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <main className="max-w-2xl mx-auto px-4 pb-16">
        {/* Title */}
        <div className="pt-8 pb-4">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--on-background)' }}>{listName}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--on-surface-variant)' }}>
            Created {timeAgo(createdAt)}
          </p>
        </div>

        {/* List switcher — shown when multiple lists exist */}
        <ListSwitcher allLists={allLists} activeListId={activeListId} token={token} />

        {/* Store comparison strip */}
        {displaySorted.length > 0 && (
          <div className="grid gap-2 mb-6" style={{ gridTemplateColumns: `repeat(${Math.min(displaySorted.length, 3)}, 1fr)` }}>
            {displaySorted.map((st) => {
              const s = storeStyle(st.store);
              const isRecommended = recommended?.store === st.store;
              return (
                <div key={st.store} className="rounded-xl p-3 text-center"
                  style={{ background: isRecommended ? s.light : 'var(--surface-container-lowest)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                  <div className="font-bold text-sm mb-1" style={{ color: isRecommended ? s.bg : 'var(--on-background)' }}>
                    {storeDisplayName(st.store)}
                  </div>
                  <div className="text-lg font-bold" style={{ color: isRecommended ? s.bg : 'var(--on-background)' }}>
                    {fmt(st.total)}
                  </div>
                  {isRecommended && (
                    <div className="text-[10px] font-semibold mt-1 rounded-full px-2 py-0.5 inline-block" style={{ background: s.bg, color: '#fff' }}>
                      {totalsComparable ? 'Cheapest' : 'Most items'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Saving banner */}
        {saving > 0 && recommended && totalsComparable && (
          <div className="rounded-xl p-4 mb-6 text-white" style={{ background: storeStyle(recommended.store).bg }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-90">Best value this week</p>
                <p className="text-lg font-bold">{storeDisplayName(recommended.store)} saves you {fmt(saving)}</p>
              </div>
              <div className="text-3xl font-bold">{fmt(recommended.total)}</div>
            </div>
          </div>
        )}

        {/* List content — structured preferred, markdown fallback */}
        <div className="rounded-2xl p-5 mb-6" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          {hasStructured ? (
            <StructuredItemList items={structuredItems!} storeTotals={displaySorted} />
          ) : listContent ? (
            <FormattedListContent content={listContent} />
          ) : (
            <div className="py-4 text-center">
              <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
                List content unavailable. <Link href="/" className="font-semibold" style={{ color: 'var(--primary)' }}>Plan a new list →</Link>
              </p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mb-8">
          {conversationId && (
            <Link href={`/dashboard/chat/${conversationId}`}
              className="flex-1 text-center py-3 px-4 rounded-xl font-semibold text-sm text-white transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #006A35, #00944A)' }}>
              💬 Modify in chat
            </Link>
          )}
          <Link href="/"
            className="flex-1 text-center py-3 px-4 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90"
            style={{ background: 'var(--surface-container)', color: 'var(--on-background)' }}>
            🗓️ Plan new week
          </Link>
          <Link href="/dashboard"
            className="text-center py-3 px-4 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90"
            style={{ background: 'var(--surface-container)', color: 'var(--on-background)' }}>
            Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}

// ─── Types ──────────────────────────────────────────────────────────────

interface StoreTotal {
  store: string;
  total: number;
}

interface ListSummary {
  id: string;
  name: string;
  store_totals: StoreTotal[];
  created_at: string;
}

interface Props {
  listContent: string | null;
  storeTotals: StoreTotal[];
  listName: string;
  createdAt: string;
  conversationId: string | null;
  token: string;
  allLists: ListSummary[];
  activeListId: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

