'use client';

import { useState, useEffect, useCallback } from 'react';
import { loadSession } from '@/lib/session';
import { HomePlanner } from '@/components/HomePlanner';
import type { WeeklyPlanState, AgentNotice, MealSlot } from '@/app/api/plan/weekly/route';

// ── Date helpers ──────────────────────────────────────────────────────────────

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-IE', opts)} – ${end.toLocaleDateString('en-IE', opts)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusCard({
  label,
  value,
  sub,
  accent,
  dot,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  dot?: 'green' | 'amber' | 'none';
}) {
  return (
    <div
      className="rounded-2xl px-3 py-3 flex flex-col gap-0.5"
      style={{
        background: 'var(--surface-container-lowest)',
        border: '1px solid var(--surface-container)',
      }}
    >
      <div className="flex items-center gap-1.5">
        {dot && dot !== 'none' && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: dot === 'green' ? '#00944A' : '#F59E0B' }}
          />
        )}
        <span className="text-xs font-medium" style={{ color: 'var(--on-surface-variant)' }}>
          {label}
        </span>
      </div>
      <span
        className="text-base font-bold leading-tight"
        style={{ color: accent ? '#F59E0B' : 'var(--on-surface)' }}
      >
        {value}
      </span>
      <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
        {sub}
      </span>
    </div>
  );
}

function NoticeRow({ notice }: { notice: AgentNotice }) {
  const icon =
    notice.type === 'price_drop' ? '↓' :
    notice.type === 'promotion' ? '★' :
    notice.type === 'warning' ? '!' : '·';

  const iconColor =
    notice.type === 'price_drop' ? '#00944A' :
    notice.type === 'promotion' ? '#7C3AED' :
    notice.type === 'warning' ? '#F59E0B' :
    'var(--on-surface-variant)';

  return (
    <li className="flex items-start gap-2 text-sm" style={{ color: 'var(--on-surface)' }}>
      <span className="font-bold text-xs mt-0.5 w-3 flex-shrink-0 text-center" style={{ color: iconColor }}>
        {icon}
      </span>
      <span>{notice.message}</span>
    </li>
  );
}

function MealRow({ slot }: { slot: MealSlot }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--surface-container)' }}>
      <span className="text-xs font-semibold w-16 flex-shrink-0 mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>
        {slot.day.slice(0, 3)}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug" style={{ color: 'var(--on-surface)' }}>{slot.name}</p>
        {slot.description && (
          <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--on-surface-variant)' }}>{slot.description}</p>
        )}
      </div>
      {slot.estimatedCost != null && (
        <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#00944A' }}>€{slot.estimatedCost.toFixed(2)}</span>
      )}
    </div>
  );
}

function ActionButton({
  label,
  loading,
  onClick,
  variant = 'primary',
}: {
  label: string;
  loading?: boolean;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm font-semibold transition-opacity"
      style={
        variant === 'primary'
          ? { background: '#00944A', color: '#fff', opacity: loading ? 0.6 : 1 }
          : {
              background: 'var(--surface-container)',
              color: 'var(--on-surface)',
              border: '1px solid var(--surface-container)',
              opacity: loading ? 0.6 : 1,
            }
      }
    >
      {loading ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Planning…
        </span>
      ) : (
        label
      )}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function WeeklyCommandCentre() {
  const [plan, setPlan] = useState<WeeklyPlanState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [showDinners, setShowDinners] = useState(false);
  const [showLunches, setShowLunches] = useState(false);

  const session = loadSession();
  const token = session?.token;

  const fetchPlan = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/plan/weekly?token=${encodeURIComponent(token)}`);
      if (res.ok) setPlan(await res.json());
    } catch {}
  }, [token]);

  useEffect(() => {
    fetchPlan().finally(() => setLoading(false));
  }, [fetchPlan]);

  async function handleQuickAction(type: 'dinners' | 'lunches') {
    if (!token) return;
    setActionLoading(type);
    try {
      await fetch('/api/agents/meal-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, config: { type } }),
      });
      await fetchPlan();
      if (type === 'dinners') setShowDinners(true);
      else setShowLunches(true);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSameAsLastWeek() {
    if (!token) return;
    setActionLoading('same');
    try {
      // Generate dinners + lunches in sequence
      await fetch('/api/agents/meal-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, config: { type: 'dinners' } }),
      });
      await fetch('/api/agents/meal-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, config: { type: 'lunches' } }),
      });
      await fetchPlan();
      setShowDinners(true);
      setShowLunches(true);
    } finally {
      setActionLoading(null);
    }
  }

  // ── Derived values ──

  const dinners = plan?.meals.dinners ?? [];
  const lunches = plan?.meals.lunches ?? [];
  const plannedDinners = dinners.filter(d => d.status === 'planned');
  const plannedLunches = lunches.filter(l => l.status === 'planned');
  const shoppingTotal = plan?.budget.current ?? 0;
  const shoppingItems = plan?.shoppingList?.length ?? 0;
  const budget = plan?.budget;
  const weekLabel = plan?.weekStart ? formatWeekRange(plan.weekStart) : '—';
  const hasDinners = plannedDinners.length > 0;
  const hasLunches = plannedLunches.length > 0;

  const dinnersTotal = plannedDinners.reduce((s, m) => s + (m.estimatedCost ?? 0), 0);
  const lunchesTotal = plannedLunches.reduce((s, m) => s + (m.estimatedCost ?? 0), 0);

  if (loading) {
    return (
      <div className="flex flex-col gap-4 animate-pulse">
        <div className="h-8 rounded-xl w-40" style={{ background: 'var(--surface-container)' }} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-20 rounded-2xl" style={{ background: 'var(--surface-container)' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between pt-1">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--on-surface)' }}>This week</h2>
          <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{weekLabel}</p>
        </div>
        <span
          className="text-xs font-semibold px-2.5 py-1 rounded-full"
          style={{
            background: plan?.status === 'complete' ? '#00944A' : plan?.status === 'partial' ? 'var(--primary-container)' : 'var(--surface-container)',
            color: plan?.status === 'complete' ? '#fff' : plan?.status === 'partial' ? 'var(--on-primary-container)' : 'var(--on-surface-variant)',
          }}
        >
          {plan?.status === 'complete' ? 'Complete' : plan?.status === 'partial' ? 'In progress' : 'Not started'}
        </span>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatusCard
          label="Dinners"
          value={`${plannedDinners.length}/7`}
          sub={hasDinners ? `€${dinnersTotal.toFixed(2)} est.` : 'Not planned'}
          dot={hasDinners ? 'green' : 'none'}
        />
        <StatusCard
          label="Lunches"
          value={`${plannedLunches.length}/5`}
          sub={hasLunches ? `€${lunchesTotal.toFixed(2)} est.` : 'Not planned'}
          dot={hasLunches ? 'green' : 'none'}
        />
        <StatusCard
          label="Shopping"
          value={shoppingItems > 0 ? `${shoppingItems} items` : '—'}
          sub={shoppingTotal > 0 ? `€${shoppingTotal.toFixed(2)}` : 'No list yet'}
          dot="none"
        />
        <StatusCard
          label="Budget"
          value={budget?.target ? `€${budget.current.toFixed(2)}` : '—'}
          sub={budget?.target ? `of €${budget.target} target` : 'No target set'}
          accent={!budget?.onTrack}
          dot={budget?.target ? (budget.onTrack ? 'green' : 'amber') : 'none'}
        />
      </div>

      {/* Agent notices */}
      {plan?.agentNotices && plan.agentNotices.length > 0 && (
        <div
          className="rounded-2xl px-4 py-3"
          style={{
            background: 'var(--surface-container-lowest)',
            border: '1px solid var(--surface-container)',
          }}
        >
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--on-surface-variant)' }}>
            Agent insights
          </p>
          <ul className="space-y-1.5">
            {plan.agentNotices.map((n, i) => (
              <NoticeRow key={i} notice={n} />
            ))}
          </ul>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex gap-2">
        <ActionButton
          label="Plan dinners"
          loading={actionLoading === 'dinners'}
          onClick={() => handleQuickAction('dinners')}
        />
        <ActionButton
          label="Plan lunches"
          loading={actionLoading === 'lunches'}
          onClick={() => handleQuickAction('lunches')}
        />
        <ActionButton
          label="Same as last week"
          variant="secondary"
          loading={actionLoading === 'same'}
          onClick={handleSameAsLastWeek}
        />
      </div>

      {/* Dinners preview */}
      {hasDinners && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid var(--surface-container)' }}
        >
          <button
            className="w-full flex items-center justify-between px-4 py-3"
            style={{ background: 'var(--surface-container-lowest)' }}
            onClick={() => setShowDinners(v => !v)}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>
              Dinners
            </span>
            <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
              {showDinners ? 'Hide' : 'Show'} {plannedDinners.length} meals
            </span>
          </button>
          {showDinners && (
            <div className="px-4 pb-2" style={{ background: 'var(--surface-container-lowest)' }}>
              {plannedDinners.map((slot, i) => (
                <MealRow key={i} slot={slot} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lunches preview */}
      {hasLunches && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid var(--surface-container)' }}
        >
          <button
            className="w-full flex items-center justify-between px-4 py-3"
            style={{ background: 'var(--surface-container-lowest)' }}
            onClick={() => setShowLunches(v => !v)}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>
              Lunches
            </span>
            <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
              {showLunches ? 'Hide' : 'Show'} {plannedLunches.length} meals
            </span>
          </button>
          {showLunches && (
            <div className="px-4 pb-2" style={{ background: 'var(--surface-container-lowest)' }}>
              {plannedLunches.map((slot, i) => (
                <MealRow key={i} slot={slot} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chat section */}
      {!chatOpen ? (
        <button
          onClick={() => setChatOpen(true)}
          className="w-full rounded-2xl px-4 py-3 text-left text-sm transition-opacity hover:opacity-80"
          style={{
            background: 'var(--surface-container-lowest)',
            border: '1px solid var(--surface-container)',
            color: 'var(--on-surface-variant)',
          }}
        >
          <span className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Ask anything about your plan…
          </span>
        </button>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--surface-container)' }}>
          <div className="flex items-center justify-between px-4 py-2.5" style={{ background: 'var(--surface-container)', borderBottom: '1px solid var(--surface-container)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--on-surface)' }}>Chat with your planner</span>
            <button
              onClick={() => setChatOpen(false)}
              className="text-xs"
              style={{ color: 'var(--on-surface-variant)' }}
            >
              Close
            </button>
          </div>
          <HomePlanner />
        </div>
      )}
    </div>
  );
}
