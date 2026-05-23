'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadSession } from '@/lib/session';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';
import { trackEvent } from '@/lib/analytics';
import { HouseholdEditor } from '@/components/HouseholdEditor';

interface Conversation {
  id: string;
  title: string;
  list_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface SavedList {
  id: string;
  name: string;
  meals_prompt: string | null;
  family_size: string;
  store_totals: Array<{ store: string; total: number }> | null;
  is_default: boolean;
  created_at: string;
  generated_at: string | null;
  conversation_id: string | null;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(dateStr).toLocaleDateString('en-IE', { month: 'short', day: 'numeric' });
}

function StoreTotalBadges({ totals }: { totals: Array<{ store: string; total: number }> }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {totals.map((t, i) => (
        <span key={i} className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
          style={{ background: storeStyle(t.store).bg }}>
          {storeDisplayName(t.store)} €{t.total.toFixed(2)}
        </span>
      ))}
    </div>
  );
}

export function Dashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [lists, setLists] = useState<SavedList[]>([]);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (!session?.token) {
      router.push('/');
      return;
    }
    setToken(session.token);
    trackEvent('dashboard_visit', undefined, session.token);
    loadData(session.token);
  }, [router]);

  async function loadData(tok: string) {
    setLoading(true);
    try {
      const [convRes, listsRes] = await Promise.all([
        fetch(`/api/conversations?token=${encodeURIComponent(tok)}`),
        fetch(`/api/lists?token=${encodeURIComponent(tok)}`),
      ]);
      if (convRes.ok) {
        const d = await convRes.json();
        setConversations(d.conversations ?? []);
      }
      if (listsRes.ok) {
        const d = await listsRes.json();
        setLists(d.lists ?? []);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function deleteConversation(id: string) {
    if (!token) return;
    try {
      await fetch(`/api/conversations/${id}?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
      setConversations(prev => prev.filter(c => c.id !== id));
    } catch {}
  }

  // Find the most recent list
  const lastList = lists.length > 0 ? lists[0] : null;

  if (loading) {
    return (
      <main className="flex-1 px-4 py-12 max-w-2xl mx-auto w-full">
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-low)' }} />
          ))}
        </div>
      </main>
    );
  }

  const hasData = conversations.length > 0 || lists.length > 0;

  return (
    <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
      {/* Welcome */}
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--on-background)' }}>
        👋 Welcome back
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--on-surface)' }}>
        Your grocery planning dashboard
      </p>

      {/* Primary CTA */}
      <Link
        href="/"
        className="block w-full text-center py-4 px-6 rounded-2xl font-bold text-lg text-white transition-opacity hover:opacity-90 mb-8"
        style={{ background: 'linear-gradient(135deg, #006A35, #00944A)' }}
      >
        🛒 Plan this week
        <span className="block text-sm font-normal mt-0.5 opacity-80">Get a new AI grocery list</span>
      </Link>

      {!hasData && (
        <div className="text-center py-12 rounded-2xl" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <p className="text-4xl mb-3">🛒</p>
          <p className="font-semibold text-base mb-1" style={{ color: 'var(--on-background)' }}>No lists yet</p>
          <p className="text-sm" style={{ color: 'var(--on-surface)' }}>
            Plan your first grocery list and it'll show up here
          </p>
        </div>
      )}

      {/* Last list card */}
      {lastList && (
        <section className="mb-8">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--on-surface-variant)' }}>
            📋 Your last list
          </h2>
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate" style={{ color: 'var(--on-background)' }}>
                  {lastList.name}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
                  {timeAgo(lastList.generated_at || lastList.created_at)}
                </p>
              </div>
            </div>
            {lastList.store_totals && lastList.store_totals.length > 0 && (
              <StoreTotalBadges totals={lastList.store_totals} />
            )}
            <div className="flex gap-2 mt-3">
              <Link
                href={`/list?token=${encodeURIComponent(token!)}`}
                className="flex-1 text-center px-3 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'var(--surface-container)', color: 'var(--on-background)' }}
              >
                View list
              </Link>
              {lastList.conversation_id && (
                <Link
                  href={`/dashboard/chat/${lastList.conversation_id}`}
                  className="flex-1 text-center px-3 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: '#006A35' }}
                >
                  Modify in chat 💬
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Recent conversations */}
      {conversations.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--on-surface-variant)' }}>
            💬 Recent conversations
          </h2>
          <div className="space-y-2">
            {conversations.map(conv => (
              <div
                key={conv.id}
                className="rounded-2xl p-4 flex items-center justify-between group transition-colors"
                style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}
              >
                <Link href={`/dashboard/chat/${conv.id}`} className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate" style={{ color: 'var(--on-background)' }}>
                    {conv.title}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
                    {conv.message_count} messages · {timeAgo(conv.updated_at)}
                  </p>
                </Link>
                <button
                  onClick={() => deleteConversation(conv.id)}
                  className="ml-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                  title="Delete conversation"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--on-surface-variant)' }}>
                    <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* All saved lists */}
      {lists.length > 1 && (
        <section className="mb-8">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--on-surface-variant)' }}>
            📦 All saved lists
          </h2>
          <div className="space-y-2">
            {lists.slice(1).map(list => (
              <div
                key={list.id}
                className="rounded-2xl p-4"
                style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--on-background)' }}>
                      {list.name}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
                      {timeAgo(list.generated_at || list.created_at)}
                    </p>
                  </div>
                </div>
                {list.store_totals && list.store_totals.length > 0 && (
                  <StoreTotalBadges totals={list.store_totals} />
                )}
                {list.conversation_id && (
                  <div className="mt-3">
                    <Link
                      href={`/dashboard/chat/${list.conversation_id}`}
                      className="text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{ color: '#006A35' }}
                    >
                      Continue chat →
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Household profile editor */}
      <section className="mb-8">
        <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--on-surface-variant)' }}>
          ⚙️ Your preferences
        </h2>
        <HouseholdEditor />
      </section>
    </main>
  );
}
