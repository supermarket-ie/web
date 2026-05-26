'use client';

import Link from 'next/link';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';

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

// ─── Rich text rendering (same as ConversationChat) ─────────────────────

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

  // Parse store totals from the content for the visual badge section
  const storeTotals: Array<{ store: string; total: number; cheapest?: boolean }> = [];
  let inTotalsSection = false;

  for (const line of lines) {
    if (line.toLowerCase().includes('store total') || line.toLowerCase().includes('best value')) {
      inTotalsSection = true;
      continue;
    }
    if (inTotalsSection && line.trim() === '') break;
    if (inTotalsSection) {
      const m = line.match(/\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?:?\s*€?(\d+(?:\.\d{2})?)/i);
      if (m) {
        const total = parseFloat(m[2]);
        if (!isNaN(total)) storeTotals.push({ store: m[1].toLowerCase(), total });
      }
    }
  }
  if (storeTotals.length > 0) {
    const cheapest = storeTotals.reduce((min, c) => c.total < min.total ? c : min);
    cheapest.cheapest = true;
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
        // Skip store totals lines (rendered as badges above)
        if (line.match(/\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?:?\s*€?\d+/i)) return null;
        if (line.toLowerCase().includes('store total') || line.toLowerCase().includes('best value')) return null;
        return <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--on-surface)' }}><RichText text={line} /></p>;
      })}

      {/* Render store totals as visual badges at the bottom */}
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

export function SavedListView({ listContent, storeTotals, listName, createdAt, conversationId, token, allLists, activeListId }: Props) {
  // Sort store totals (cheapest first)
  const sorted = [...storeTotals].sort((a, b) => a.total - b.total);
  const cheapest = sorted[0];
  const priciest = sorted[sorted.length - 1];
  const saving = (cheapest && priciest && sorted.length > 1) ? Math.round((priciest.total - cheapest.total) * 100) / 100 : 0;

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

        {/* Store comparison strip */}
        {sorted.length > 0 && (
          <div className="grid gap-2 mb-6" style={{ gridTemplateColumns: `repeat(${Math.min(sorted.length, 3)}, 1fr)` }}>
            {sorted.map((st, i) => {
              const s = storeStyle(st.store);
              const isCheapest = i === 0 && sorted.length > 1;
              return (
                <div
                  key={st.store}
                  className="rounded-xl p-3 text-center"
                  style={{
                    background: isCheapest ? s.light : 'var(--surface-container-lowest)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                  }}
                >
                  <div
                    className="font-bold text-sm mb-1"
                    style={{ color: isCheapest ? s.bg : 'var(--on-background)' }}
                  >
                    {storeDisplayName(st.store)}
                  </div>
                  <div
                    className="text-lg font-bold"
                    style={{ color: isCheapest ? s.bg : 'var(--on-background)' }}
                  >
                    {fmt(st.total)}
                  </div>
                  {isCheapest && (
                    <div
                      className="text-[10px] font-semibold mt-1 rounded-full px-2 py-0.5 inline-block"
                      style={{ background: s.bg, color: '#fff' }}
                    >
                      Cheapest
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Saving banner */}
        {saving > 0 && cheapest && (
          <div className="rounded-xl p-4 mb-6 text-white" style={{ background: storeStyle(cheapest.store).bg }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm opacity-90">Best value this week</p>
                <p className="text-lg font-bold">{storeDisplayName(cheapest.store)} saves you {fmt(saving)}</p>
              </div>
              <div className="text-3xl font-bold">{fmt(cheapest.total)}</div>
            </div>
          </div>
        )}

        {/* List content */}
        {listContent ? (
          <div
            className="rounded-2xl p-5 mb-6"
            style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}
          >
            <FormattedListContent content={listContent} />
          </div>
        ) : (
          <div className="rounded-2xl p-8 mb-6 text-center" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
            <p className="text-lg mb-2" style={{ color: 'var(--on-background)' }}>List content unavailable</p>
            <p className="text-sm" style={{ color: 'var(--on-surface)' }}>
              The conversation for this list may have been deleted. Create a new list to get started.
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mb-8">
          {conversationId && (
            <Link
              href={`/dashboard/chat/${conversationId}`}
              className="flex-1 text-center py-3 px-4 rounded-xl font-semibold text-sm text-white transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #006A35, #00944A)' }}
            >
              💬 Modify in chat
            </Link>
          )}
          <Link
            href="/"
            className="flex-1 text-center py-3 px-4 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90"
            style={{ background: 'var(--surface-container)', color: 'var(--on-background)' }}
          >
            🛒 Plan new list
          </Link>
          <Link
            href="/dashboard"
            className="text-center py-3 px-4 rounded-xl font-semibold text-sm transition-opacity hover:opacity-90"
            style={{ background: 'var(--surface-container)', color: 'var(--on-background)' }}
          >
            Dashboard
          </Link>
        </div>

        {/* Other saved lists */}
        {allLists.length > 1 && (
          <div className="mb-8">
            <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--on-surface-variant)' }}>
              Other saved lists
            </h3>
            <div className="space-y-2">
              {allLists
                .filter(l => l.id !== activeListId)
                .map(list => {
                  const cheapestInList = list.store_totals?.[0];
                  return (
                    <Link
                      key={list.id}
                      href={`/list?token=${encodeURIComponent(token)}&list=${list.id}`}
                      className="block rounded-xl px-4 py-3 transition-opacity hover:opacity-80"
                      style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate" style={{ color: 'var(--on-background)' }}>{list.name}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
                            {timeAgo(list.created_at)}
                            {cheapestInList && (
                              <span className="ml-2 font-medium" style={{ color: 'var(--primary)' }}>
                                {storeDisplayName(cheapestInList.store)} {fmt(cheapestInList.total)}
                              </span>
                            )}
                          </p>
                        </div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--on-surface-variant)' }}>
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </div>
                    </Link>
                  );
                })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
