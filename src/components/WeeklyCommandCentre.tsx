'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadSession } from '@/lib/session';
import { HomePlanner } from '@/components/HomePlanner';
import type { WeeklyPlanState, AgentNotice, MealSlot } from '@/app/api/plan/weekly/route';

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-IE', opts)} – ${end.toLocaleDateString('en-IE', opts)}`;
}

function StatusCard({ label, value, sub, accent, dot }: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  dot?: 'green' | 'amber' | 'none';
}) {
  return (
    <div className="rounded-2xl px-3 py-3 flex flex-col gap-0.5" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
      <div className="flex items-center gap-1.5">
        {dot && dot !== 'none' && <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: dot === 'green' ? '#00944A' : '#F59E0B' }} />}
        <span className="text-xs font-medium" style={{ color: 'var(--on-surface-variant)' }}>{label}</span>
      </div>
      <span className="text-base font-bold leading-tight" style={{ color: accent ? '#F59E0B' : 'var(--on-surface)' }}>{value}</span>
      <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{sub}</span>
    </div>
  );
}

function NoticeRow({ notice }: { notice: AgentNotice }) {
  const icon = notice.type === 'price_drop' ? '↓' : notice.type === 'promotion' ? '★' : notice.type === 'warning' ? '!' : '·';
  const iconColor = notice.type === 'price_drop' ? '#00944A' : notice.type === 'promotion' ? '#7C3AED' : notice.type === 'warning' ? '#F59E0B' : 'var(--on-surface-variant)';
  return (
    <li className="flex items-start gap-2 text-sm" style={{ color: 'var(--on-surface)' }}>
      <span className="font-bold text-xs mt-0.5 w-3 text-center" style={{ color: iconColor }}>{icon}</span>
      <span>{notice.message}</span>
    </li>
  );
}

function MealRow({ slot }: { slot: MealSlot }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--surface-container)' }}>
      <span className="text-xs font-semibold w-16 mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>{slot.day.slice(0, 3)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug" style={{ color: 'var(--on-surface)' }}>{slot.name}</p>
        {slot.description && <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--on-surface-variant)' }}>{slot.description}</p>}
      </div>
      {slot.estimatedCost != null && <span className="text-xs font-semibold" style={{ color: '#00944A' }}>€{slot.estimatedCost.toFixed(2)}</span>}
    </div>
  );
}

export function WeeklyCommandCentre() {
  const [plan, setPlan] = useState<WeeklyPlanState | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDinners, setShowDinners] = useState(false);
  const [showLunches, setShowLunches] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const fetchPlan = useCallback(async (t: string) => {
    try {
      const res = await fetch(`/api/plan/weekly?token=${encodeURIComponent(t)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data.error) setPlan(data);
    } catch {}
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const session = loadSession();
      const t = session?.token ?? null;
      setToken(t);
      if (t) void fetchPlan(t).finally(() => setLoading(false));
      else setLoading(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [fetchPlan]);

  useEffect(() => {
    if (!token) return;
    const refreshAfterAgentTurn = () => fetchPlan(token).catch(() => {});
    window.addEventListener('sm:eve-turn-finished', refreshAfterAgentTurn);
    return () => window.removeEventListener('sm:eve-turn-finished', refreshAfterAgentTurn);
  }, [token, fetchPlan]);

  const dinners = plan?.meals.dinners ?? [];
  const lunches = plan?.meals.lunches ?? [];
  const plannedDinners = dinners.filter(d => d.status === 'planned');
  const plannedLunches = lunches.filter(l => l.status === 'planned');
  const shoppingTotal = plan?.budget.current ?? 0;
  const shoppingItems = plan?.shoppingList?.length ?? 0;
  const budget = plan?.budget;
  const weekLabel = plan?.weekStart ? formatWeekRange(plan.weekStart) : '—';
  const dinnersTotal = plannedDinners.reduce((s, m) => s + (m.estimatedCost ?? 0), 0);
  const lunchesTotal = plannedLunches.reduce((s, m) => s + (m.estimatedCost ?? 0), 0);

  if (loading) {
    return (
      <div className="flex flex-col gap-4 animate-pulse">
        <div className="h-8 rounded-xl w-40" style={{ background: 'var(--surface-container)' }} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-20 rounded-2xl" style={{ background: 'var(--surface-container)' }} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between pt-1">
        <div>
          <h2 className="text-base font-bold" style={{ color: 'var(--on-surface)' }}>This week</h2>
          <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{weekLabel}</p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: plan?.status === 'complete' ? '#00944A' : plan?.status === 'partial' ? 'var(--primary-container)' : 'var(--surface-container)', color: plan?.status === 'complete' ? '#fff' : plan?.status === 'partial' ? 'var(--on-primary-container)' : 'var(--on-surface-variant)' }}>
          {plan?.status === 'complete' ? 'Ready' : plan?.status === 'partial' ? 'In progress' : 'Not started'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatusCard label="Dinners" value={`${plannedDinners.length}/7`} sub={plannedDinners.length ? `€${dinnersTotal.toFixed(2)} est.` : 'Ask us to plan'} dot={plannedDinners.length ? 'green' : 'none'} />
        <StatusCard label="Lunches" value={`${plannedLunches.length}/5`} sub={plannedLunches.length ? `€${lunchesTotal.toFixed(2)} est.` : 'Ask us to plan'} dot={plannedLunches.length ? 'green' : 'none'} />
        <StatusCard label="Shopping" value={shoppingItems > 0 ? `${shoppingItems} items` : '—'} sub={shoppingTotal > 0 ? `€${shoppingTotal.toFixed(2)}` : 'No shop yet'} dot="none" />
        <StatusCard label="Budget" value={budget?.target ? `€${budget.current.toFixed(2)}` : '—'} sub={budget?.target ? `of €${budget.target} target` : 'No target set'} accent={!budget?.onTrack} dot={budget?.target ? (budget.onTrack ? 'green' : 'amber') : 'none'} />
      </div>

      {plan?.agentNotices && plan.agentNotices.length > 0 && (
        <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#00944A' }}>Worth knowing</p>
          <ul className="space-y-1.5">{plan.agentNotices.map((n, i) => <NoticeRow key={i} notice={n} />)}</ul>
        </div>
      )}

      {plannedDinners.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--surface-container)' }}>
          <button className="w-full flex items-center justify-between px-4 py-3" style={{ background: 'var(--surface-container-lowest)' }} onClick={() => setShowDinners(v => !v)}>
            <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>Dinners</span>
            <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{showDinners ? 'Hide' : `Show ${plannedDinners.length} meals`}</span>
          </button>
          {showDinners && <div className="px-4 pb-3" style={{ background: 'var(--surface-container-lowest)' }}>{plannedDinners.map((slot, i) => <MealRow key={i} slot={slot} />)}</div>}
        </div>
      )}

      {plannedLunches.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--surface-container)' }}>
          <button className="w-full flex items-center justify-between px-4 py-3" style={{ background: 'var(--surface-container-lowest)' }} onClick={() => setShowLunches(v => !v)}>
            <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>Lunches</span>
            <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{showLunches ? 'Hide' : `Show ${plannedLunches.length} meals`}</span>
          </button>
          {showLunches && <div className="px-4 pb-3" style={{ background: 'var(--surface-container-lowest)' }}>{plannedLunches.map((slot, i) => <MealRow key={i} slot={slot} />)}</div>}
        </div>
      )}

      <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--surface-container)' }}>
        <div className="px-4 py-2.5" style={{ background: 'var(--surface-container)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--on-surface)' }}>What do you need?</span>
        </div>
        <HomePlanner />
      </div>
    </div>
  );
}
