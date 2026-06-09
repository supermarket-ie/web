'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadSession } from '@/lib/session';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';
import { trackEvent } from '@/lib/analytics';
import { type RefreshData } from '@/components/SmartRefreshCard';
import { type HouseholdMemory } from '@/lib/planner-agent';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Agent notice card ─────────────────────────────────────────────────────────

function AgentNoticeCard({ data, token }: { data: RefreshData; token: string }) {
  const { lastList, priceDiff, thisWeekTotal, daysSince } = data;
  const saving = priceDiff.netChange > 0;
  const stale = daysSince >= 14;

  function handleSameAgain() {
    window.location.href = `/?sameAgain=1&token=${encodeURIComponent(token)}`;
  }
  function handleChange() {
    window.location.href = '/';
  }

  return (
    <div className="rounded-2xl overflow-hidden mb-6"
      style={{ border: '1px solid var(--surface-container)', background: 'var(--surface-container-lowest)' }}>

      {/* Header bar */}
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ background: '#00944A' }}>
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-bold">Your agent noticed</span>
        </div>
        <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.75)' }}>
          {daysSince === 0 ? 'Today' : daysSince === 1 ? 'Yesterday' : `${daysSince}d ago`}
        </span>
      </div>

      <div className="px-4 py-4">
        {/* Last shop total */}
        <div className="flex items-baseline justify-between mb-3">
          <span className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
            {stale ? 'Last shop' : 'Your usual shop this week'}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold" style={{ color: 'var(--on-background)' }}>
              €{thisWeekTotal.toFixed(2)}
            </span>
            {priceDiff.netChange !== 0 && (
              <span className="text-sm font-semibold"
                style={{ color: saving ? '#16a34a' : '#dc2626' }}>
                {saving ? `−€${priceDiff.netChange.toFixed(2)}` : `+€${Math.abs(priceDiff.netChange).toFixed(2)}`}
              </span>
            )}
          </div>
        </div>

        {/* Price movements */}
        <div className="space-y-1.5 mb-4">
          {priceDiff.cheaper > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span>🟢</span>
              <span style={{ color: 'var(--on-surface)' }}>
                <strong>{priceDiff.cheaper} item{priceDiff.cheaper !== 1 ? 's' : ''}</strong> cheaper this week
                <span className="ml-1 font-semibold" style={{ color: '#16a34a' }}>−€{priceDiff.cheaperAmount.toFixed(2)}</span>
              </span>
            </div>
          )}
          {priceDiff.dearer > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span>🔴</span>
              <span style={{ color: 'var(--on-surface)' }}>
                <strong>{priceDiff.dearer} item{priceDiff.dearer !== 1 ? 's' : ''}</strong> more expensive
                <span className="ml-1 font-semibold" style={{ color: '#dc2626' }}>+€{priceDiff.dearerAmount.toFixed(2)}</span>
              </span>
            </div>
          )}
          {priceDiff.promoSwaps > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span>🏷️</span>
              <span style={{ color: 'var(--on-surface)' }}>
                <strong>{priceDiff.promoSwaps} item{priceDiff.promoSwaps !== 1 ? 's' : ''}</strong> on promotion at a different store
              </span>
            </div>
          )}
          {priceDiff.cheaper === 0 && priceDiff.dearer === 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span>✅</span>
              <span style={{ color: 'var(--on-surface)' }}>Prices stable this week — same as last time</span>
            </div>
          )}
          {stale && (
            <div className="flex items-center gap-2 text-sm">
              <span>⏱️</span>
              <span style={{ color: 'var(--on-surface-variant)' }}>It's been {daysSince} days — anything changed?</span>
            </div>
          )}
        </div>

        {/* CTAs */}
        <div className="flex gap-2">
          <button onClick={handleSameAgain}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: '#00944A' }}>
            Same again →
          </button>
          <button onClick={handleChange}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: 'var(--surface-container)', color: 'var(--on-surface)', border: '1px solid var(--outline-variant)' }}>
            Change things
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Household memory card ─────────────────────────────────────────────────────

interface HouseholdProfile {
  adults?: number;
  children?: number;
  weekly_budget?: number;
  dietary?: string[];
  memory?: HouseholdMemory | null;
}

function HouseholdMemoryCard({ profile }: { profile: HouseholdProfile }) {
  const [expanded, setExpanded] = useState(false);
  const { memory, dietary, weekly_budget, adults, children } = profile;

  const hasMemory = memory && memory.totalShops > 0;
  const hasProfile = (adults ?? 0) > 0 || (dietary ?? []).length > 0 || weekly_budget;
  if (!hasMemory && !hasProfile) return null;

  const storeName = memory?.usualStore
    ? memory.usualStore.charAt(0).toUpperCase() + memory.usualStore.slice(1)
    : null;

  return (
    <div className="rounded-2xl overflow-hidden mb-4"
      style={{ border: '1px solid var(--surface-container)', background: 'var(--surface-container-lowest)' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 flex items-center justify-between text-left transition-opacity hover:opacity-80"
        style={{ background: 'var(--surface-container-low)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>
          🧠 What your agent knows
        </span>
        <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
          {expanded ? '∧' : '›'}
        </span>
      </button>

      {expanded && (
        <div className="px-4 py-3 space-y-1.5">
          {hasMemory && (
            <p className="text-xs" style={{ color: 'var(--on-surface)' }}>
              <strong>{memory!.totalShops} shop{memory!.totalShops !== 1 ? 's' : ''}</strong>
              {memory!.avgWeeklySpend > 0 && <> · avg <strong>€{memory!.avgWeeklySpend.toFixed(2)}/week</strong></>}
              {storeName && <> · usually <strong>{storeName}</strong></>}
            </p>
          )}
          {(memory?.frequentItems ?? []).length > 0 && (
            <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
              <span className="font-medium" style={{ color: 'var(--on-surface)' }}>Always buys:</span>{' '}
              {memory!.frequentItems.slice(0, 6).join(', ')}
            </p>
          )}
          {(memory?.droppedItems ?? []).length > 0 && (
            <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
              <span className="font-medium" style={{ color: 'var(--on-surface)' }}>Avoids:</span>{' '}
              {memory!.droppedItems.join(', ')}
            </p>
          )}
          {(dietary ?? []).length > 0 && (
            <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
              <span className="font-medium" style={{ color: 'var(--on-surface)' }}>Dietary:</span>{' '}
              {dietary!.join(', ')}
            </p>
          )}
          {weekly_budget && (
            <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
              <span className="font-medium" style={{ color: 'var(--on-surface)' }}>Budget:</span>{' '}
              €{weekly_budget}/week
            </p>
          )}
          {!hasMemory && (
            <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
              Complete your first shop and I'll start learning your habits.
            </p>
          )}
          <div className="pt-1">
            <Link href="/dashboard/profile"
              className="text-xs font-semibold transition-opacity hover:opacity-70"
              style={{ color: '#00944A' }}>
              Edit preferences →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── First-time empty state ────────────────────────────────────────────────────

function FirstTimeCard() {
  return (
    <div className="rounded-2xl overflow-hidden mb-6"
      style={{ border: '1px solid var(--surface-container)', background: 'var(--surface-container-lowest)' }}>
      <div className="px-4 py-3" style={{ background: '#00944A' }}>
        <span className="text-white text-sm font-bold">Your agent is ready</span>
      </div>
      <div className="px-4 py-5">
        <p className="text-sm mb-1" style={{ color: 'var(--on-background)' }}>
          <strong>Tell me about your household</strong> and I'll build your first priced weekly list — across Tesco, Dunnes, SuperValu and Aldi.
        </p>
        <p className="text-xs mb-4" style={{ color: 'var(--on-surface-variant)' }}>
          Takes about 2 minutes. The more I know, the better the list.
        </p>
        <Link href="/"
          className="block w-full text-center py-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
          style={{ background: '#00944A' }}>
          Start planning →
        </Link>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

interface SavedList {
  id: string;
  name: string;
  store_totals: Array<{ store: string; total: number }> | null;
  created_at: string;
  generated_at: string | null;
  conversation_id: string | null;
}

interface Conversation {
  id: string;
  title: string;
  list_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export function Dashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [lists, setLists] = useState<SavedList[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [refreshData, setRefreshData] = useState<RefreshData | null>(null);
  const [householdProfile, setHouseholdProfile] = useState<HouseholdProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const loadData = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const [listsRes, convsRes, refreshRes, householdRes] = await Promise.all([
        fetch(`/api/lists?token=${encodeURIComponent(tok)}`),
        fetch(`/api/conversations?token=${encodeURIComponent(tok)}`),
        fetch(`/api/plan/refresh?token=${encodeURIComponent(tok)}`),
        fetch(`/api/household?token=${encodeURIComponent(tok)}`),
      ]);
      if (listsRes.ok) setLists((await listsRes.json()).lists ?? []);
      if (convsRes.ok) setConversations((await convsRes.json()).conversations ?? []);
      if (refreshRes.ok) {
        const d = await refreshRes.json();
        if (d.hasRecentList) setRefreshData(d);
      }
      if (householdRes.ok) {
        const d = await householdRes.json();
        if (d.household) setHouseholdProfile(d.household);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const session = loadSession();
    if (!session?.token) { router.push('/'); return; }
    setToken(session.token);
    trackEvent('dashboard_visit', undefined, session.token);
    loadData(session.token);
  }, [router, loadData]);

  async function deleteConversation(id: string) {
    if (!token) return;
    await fetch(`/api/conversations/${id}?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
    setConversations(prev => prev.filter(c => c.id !== id));
  }

  if (loading) {
    return (
      <div className="min-h-screen relative overflow-hidden noise-bg" style={{ background: 'var(--surface)' }}>
        <div className="relative z-10 max-w-2xl mx-auto px-4 pt-6 pb-24 space-y-3">
          <div className="h-24 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-lowest)' }} />
          <div className="h-40 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-lowest)' }} />
          <div className="h-16 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-lowest)' }} />
        </div>
      </div>
    );
  }

  const hasHistory = lists.length > 0 || conversations.length > 0;

  return (
    <div className="min-h-screen relative overflow-hidden noise-bg" style={{ background: 'var(--surface)' }}>
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="gradient-blob" style={{
          width: 500, height: 500,
          background: 'linear-gradient(135deg, rgba(0,106,53,0.10), rgba(107,254,156,0.07))',
          top: -200, left: -100,
        }} />
        <div className="gradient-blob" style={{
          width: 350, height: 350,
          background: 'linear-gradient(135deg, rgba(0,220,255,0.06), rgba(107,254,156,0.04))',
          top: '50%', right: -120,
        }} />
        <div className="absolute inset-0 dot-grid opacity-40" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 pt-6 pb-24">
        {/* Header */}
        <div className="rounded-2xl overflow-hidden mb-6"
          style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <div className="px-5 py-4 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #006A35 0%, #00944A 60%, #00a854 100%)' }}>
            <div className="absolute pointer-events-none" style={{
              width: 200, height: 200, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(0,220,255,0.12) 0%, transparent 70%)',
              top: -60, right: -40,
            }} />
            <div className="relative">
              <h1 className="font-bold text-xl leading-tight" style={{
                background: 'linear-gradient(135deg, #ffffff, #6BFE9C)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>History</h1>
              <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Your past shops, price changes, and spending patterns.
              </p>
            </div>
          </div>
        </div>

      {/* Agent notice / first-time card */}
      {refreshData ? (
        <AgentNoticeCard data={refreshData} token={token!} />
      ) : (
        <FirstTimeCard />
      )}

      {/* Household memory card */}
      {householdProfile && <HouseholdMemoryCard profile={householdProfile} />}

      {/* Past lists */}
      {lists.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#00DCFF', textShadow: '0 0 10px rgba(0,220,255,0.3)' }}>
            Past lists
          </h2>
          <div className="space-y-2">
            {lists.map(list => (
              <div key={list.id} className="rounded-2xl p-4"
                style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--on-background)' }}>
                      {list.name}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
                      {timeAgo(list.generated_at || list.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-3">
                    <Link href={`/list?token=${encodeURIComponent(token!)}&list=${list.id}`}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{ background: 'var(--surface-container)', color: 'var(--on-background)' }}>
                      View
                    </Link>
                    {list.conversation_id && (
                      <Link href={`/dashboard/chat/${list.conversation_id}`}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
                        style={{ background: '#006A35' }}>
                        Chat
                      </Link>
                    )}
                  </div>
                </div>
                {list.store_totals && list.store_totals.length > 0 && (
                  <StoreTotalBadges totals={list.store_totals} />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent conversations (without a linked list) */}
      {conversations.filter(c => !c.list_id).length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#00DCFF', textShadow: '0 0 10px rgba(0,220,255,0.3)' }}>
            Recent conversations
          </h2>
          <div className="space-y-2">
            {conversations.filter(c => !c.list_id).map(conv => (
              <div key={conv.id}
                className="rounded-2xl p-4 flex items-center justify-between group"
                style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
                <Link href={`/dashboard/chat/${conv.id}`} className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate" style={{ color: 'var(--on-background)' }}>
                    {conv.title}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
                    {conv.message_count} messages · {timeAgo(conv.updated_at)}
                  </p>
                </Link>
                <button onClick={() => deleteConversation(conv.id)}
                  className="ml-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--on-surface-variant)' }}>
                    <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* No history at all — prompt to start */}
      {!hasHistory && !refreshData && (
        <p className="text-xs text-center mt-8" style={{ color: 'var(--on-surface-variant)' }}>
          Your past lists and conversations will appear here.
        </p>
      )}

      </div>
    </div>
  );
}
