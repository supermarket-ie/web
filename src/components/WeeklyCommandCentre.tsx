'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, CircleAlert, Clock3, Eye, Pencil, Plus, ReceiptText, ShoppingBasket, Sparkles } from 'lucide-react';
import { loadSession } from '@/lib/session';
import { trackEvent, trackEventOnce } from '@/lib/analytics';
import { HomePlanner, type HomePlannerJourneyState } from '@/components/HomePlanner';
import type { WeeklyPlanState } from '@/app/api/plan/weekly/route';
import type { CurrentShopLine } from '@/lib/shopping/current-shop-summary';

type HomeState = 'new' | 'progress' | 'ready';
type ProductWatch = { id: string; canonical_name: string | null; product_family: string | null; source_request: string | null; condition?: { kind?: string; amount?: number } };

function previewPlan(state: HomeState): WeeklyPlanState {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
  const weekStart = monday.toISOString().slice(0, 10);
  const ready = state === 'ready';
  const inProgress = state === 'progress';
  const lines: CurrentShopLine[] = ready ? [
    { label: 'Five planned dinners', category: 'Meals this week', quantity: 1, price: 39.62, unresolved: false },
    { label: 'Lunches and breakfasts', category: 'Meals this week', quantity: 1, price: 18.31, unresolved: false },
    { label: 'Milk, bread, eggs and fruit', category: 'Household essentials', quantity: 1, price: 15.18, unresolved: false },
    { label: 'Cleaning and toiletries', category: 'Household essentials', quantity: 1, price: 13.29, unresolved: false },
  ] : inProgress ? [
    { label: 'Chicken fajitas', category: 'Meals this week', quantity: 1, price: 12.4, unresolved: false },
    { label: 'Tomato and lentil pasta', category: 'Meals this week', quantity: 1, price: 7.85, unresolved: false },
    { label: 'One dinner still undecided', category: 'Meals this week', quantity: 1, price: null, unresolved: true },
    { label: 'Milk, bread and eggs', category: 'Everyday essentials', quantity: 1, price: 8.17, unresolved: false },
  ] : [];
  return {
    weekStart,
    meals: { dinners: Array.from({ length: ready ? 5 : inProgress ? 4 : 0 }, (_, index) => ({ day: `Day ${index + 1}`, name: 'Planned dinner', ingredients: [], estimatedCost: null, status: 'planned' as const })), lunches: [] },
    shoppingList: [], storeAssignment: null,
    budget: { target: 100, current: ready ? 86.4 : inProgress ? 28.42 : 0, onTrack: true },
    agentNotices: [], status: ready ? 'complete' : inProgress ? 'partial' : 'empty',
    currentShop: lines.length ? { id: 'preview-shop', name: 'This week\'s household shop', generatedAt: now.toISOString(), itemCount: ready ? 24 : 18, estimatedTotal: ready ? 86.4 : 28.42, unresolvedCount: ready ? 0 : 1, lines } : null,
  };
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-IE', opts)} – ${end.toLocaleDateString('en-IE', opts)}`;
}

function formatUpdated(date: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${new Date(date).toLocaleDateString('en-IE', { month: 'short', day: 'numeric' })}`;
}

function groupLines(lines: CurrentShopLine[]) {
  const groups = new Map<string, CurrentShopLine[]>();
  for (const line of lines) groups.set(line.category, [...(groups.get(line.category) ?? []), line]);
  return [...groups.entries()];
}

function ReceiptLine({ line }: { line: CurrentShopLine }) {
  return (
    <div className="flex items-start gap-3 border-b border-dashed border-[#d9ddd8] py-3 last:border-b-0">
      <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${line.unresolved ? 'bg-[#fff1d6] text-[#9a5b00]' : 'bg-[#e5f5e9] text-[#168049]'}`}>
        {line.unresolved ? <CircleAlert className="size-3.5" /> : <Check className="size-3.5" strokeWidth={2.5} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-5 text-[#263229]">{line.label}</span>
        <span className="block text-[11px] leading-4 text-[#879089]">{line.unresolved ? 'Still needs a product match' : line.quantity > 1 ? `Quantity ${line.quantity}` : 'Matched to a current product'}</span>
      </span>
      {line.price != null && <span className="font-mono text-xs font-semibold text-[#344039]">€{(line.price * line.quantity).toFixed(2)}</span>}
    </div>
  );
}

function LivingReceipt({ plan, state, token, watches, onBudgetUpdated }: { plan: WeeklyPlanState | null; state: HomeState; token: string | null; watches: ProductWatch[]; onBudgetUpdated: (budget: number | null) => void }) {
  const shop = plan?.currentShop ?? null;
  const activeShop = Boolean(shop && plan?.weekStart && shop.generatedAt.slice(0, 10) >= plan.weekStart);
  const lines = activeShop && shop ? shop.lines : [];
  const groups = groupLines(lines);
  const plannedDinners = plan?.meals.dinners.filter(meal => meal.status === 'planned').length ?? 0;
  const budgetTarget = plan?.budget.target ?? null;
  const estimate = activeShop && shop ? shop.estimatedTotal : plan?.budget.current ?? 0;
  const budgetDifference = budgetTarget == null ? null : budgetTarget - estimate;
  let visibleLineCount = 0;
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState(budgetTarget?.toString() ?? '');
  const [budgetStatus, setBudgetStatus] = useState<'idle' | 'saving' | 'error'>('idle');

  async function saveBudget() {
    const nextBudget = budgetInput.trim() ? Number(budgetInput) : null;
    if (nextBudget !== null && (!Number.isFinite(nextBudget) || nextBudget <= 0 || nextBudget > 5000)) {
      setBudgetStatus('error');
      return;
    }
    if (token === '__cookie__') {
      setBudgetStatus('idle');
      setEditingBudget(false);
      onBudgetUpdated(nextBudget);
      return;
    }
    setBudgetStatus('saving');
    const response = await fetch('/api/household', {
      method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weeklyBudget: nextBudget }),
    });
    if (!response.ok) { setBudgetStatus('error'); return; }
    setBudgetStatus('idle');
    setEditingBudget(false);
    onBudgetUpdated(nextBudget);
  }

  function focusAgent() {
    trackEvent('home_shop_action', { home_state: state, action: 'focus_agent' }, token ?? undefined);
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Tell your agent what to change"]')?.focus();
  }

  return (
    <aside className="overflow-hidden rounded-[1.75rem] border border-[#d9dfda] bg-[#fffefa] shadow-[0_24px_70px_rgba(42,53,45,0.10)]">
      <div className="border-b border-dashed border-[#cfd6d0] px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#168049]">Living receipt</p>
            <h2 className="mt-1 text-xl font-bold tracking-[-0.035em] text-[#1d2921]">This week&apos;s shop</h2>
            <p className="mt-0.5 text-[11px] text-[#89918c]">{plan?.weekStart ? formatWeekRange(plan.weekStart) : 'Current week'}</p>
          </div>
          <ReceiptText className="mt-1 size-5 text-[#839087]" />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
          <div><p className="text-[10px] uppercase tracking-wider text-[#8b948e]">Items</p><p className="mt-0.5 font-mono text-lg font-bold">{activeShop && shop ? shop.itemCount : plan?.shoppingList.length ?? 0}</p></div>
          <div><p className="text-[10px] uppercase tracking-wider text-[#8b948e]">Estimate</p><p className="mt-0.5 font-mono text-lg font-bold">{estimate > 0 ? `€${estimate.toFixed(2)}` : '—'}</p></div>
          <div>
            <div className="flex items-center gap-1.5"><p className="text-[10px] uppercase tracking-wider text-[#8b948e]">Budget</p><button type="button" onClick={() => { setBudgetInput(budgetTarget?.toString() ?? ''); setBudgetStatus('idle'); setEditingBudget(value => !value); }} aria-label="Edit weekly budget" className="rounded p-0.5 text-[#6d7870] hover:bg-[#edf4ef] hover:text-[#168049]"><Pencil className="size-3" /></button></div>
            {editingBudget ? (
              <div className="mt-1 flex items-center gap-1.5"><span className="text-xs font-bold">€</span><input aria-label="Weekly budget" type="number" min="1" max="5000" value={budgetInput} onChange={event => setBudgetInput(event.target.value)} placeholder="No limit" className="w-20 rounded-lg border border-[#cfd8d1] bg-white px-2 py-1 text-xs font-semibold outline-none focus:border-[#168049]" /><button type="button" onClick={() => void saveBudget()} disabled={budgetStatus === 'saving'} className="rounded-lg bg-[#173124] px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">{budgetStatus === 'saving' ? 'Saving' : 'Save'}</button></div>
            ) : <p className="mt-0.5 text-xs font-semibold text-[#3c493f]">{budgetDifference == null ? 'No target set' : budgetDifference >= 0 ? `€${budgetDifference.toFixed(2)} remaining` : `€${Math.abs(budgetDifference).toFixed(2)} over target`}</p>}
            {budgetStatus === 'error' && <p className="mt-1 text-[10px] text-red-700">Enter a budget between €1 and €5,000.</p>}
          </div>
          <div><p className="text-[10px] uppercase tracking-wider text-[#8b948e]">Meals</p><p className="mt-0.5 text-xs font-semibold text-[#3c493f]">{plannedDinners ? `${plannedDinners} of 7 dinners` : 'Not planned yet'}</p></div>
        </div>
      </div>

      <div className="min-h-[300px] px-5 py-3 sm:px-6">
        {groups.length > 0 ? groups.slice(0, 3).map(([category, categoryLines]) => {
          const shown = categoryLines.slice(0, Math.max(0, 8 - visibleLineCount));
          visibleLineCount += shown.length;
          if (!shown.length) return null;
          return <section key={category} className="py-2"><h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7a847d]">{category}</h3>{shown.map((line, index) => <ReceiptLine key={`${category}:${line.label}:${index}`} line={line} />)}</section>;
        }) : (
          <div className="flex min-h-[275px] flex-col items-center justify-center px-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-[#edf7f0] text-[#168049]"><ShoppingBasket className="size-5" /></span>
            <p className="mt-4 text-sm font-bold text-[#263229]">Your shop will take shape here</p>
            <p className="mt-1 max-w-[240px] text-xs leading-5 text-[#7b857e]">Products, meals, budget and choices will update as you work with your agent.</p>
          </div>
        )}
        {activeShop && shop && shop.itemCount > visibleLineCount && <p className="border-t border-dashed border-[#d9ddd8] py-3 text-center text-xs font-semibold text-[#69746c]">+ {shop.itemCount - visibleLineCount} more items in this shop</p>}
      </div>

      <div className="border-t border-dashed border-[#cfd6d0] px-5 py-5 sm:px-6">
        <div className="mb-4 rounded-2xl border border-[#eee0bd] bg-[#fff8e5] px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><Eye className="size-4 text-[#856315]" /><p className="text-xs font-bold text-[#4c4023]">Watching</p>{watches.length > 0 && <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-bold text-[#7a6228]">{watches.length}</span>}</div>
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('sm:agent-prefill', { detail: 'I want to watch a product' }))} className="inline-flex items-center gap-1 text-[11px] font-bold text-[#6c551f]"><Plus className="size-3" /> Add a watch</button>
          </div>
          {watches.length > 0 ? <div className="mt-2 space-y-1">{watches.slice(0, 2).map(watch => <p key={watch.id} className="truncate text-[11px] text-[#665a3d]">{watch.canonical_name || watch.product_family || watch.source_request || 'Product watch'}</p>)}</div> : <p className="mt-1 text-[11px] leading-4 text-[#7d7258]">Products and price conditions you ask your agent to monitor will appear here.</p>}
        </div>
        <div className={`mb-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${state === 'ready' ? 'bg-[#e9f7ed] text-[#27643d]' : state === 'progress' ? 'bg-[#fff4dd] text-[#7b5907]' : 'bg-[#f0f3f1] text-[#677169]'}`}>
          {state === 'ready' ? <Check className="size-4" /> : state === 'progress' ? <Clock3 className="size-4" /> : <Sparkles className="size-4" />}
          <span>{state === 'ready' ? 'Ready to review with current validated prices' : state === 'progress' && activeShop && shop?.unresolvedCount ? `${shop.unresolvedCount} choice${shop.unresolvedCount === 1 ? '' : 's'} still need attention` : state === 'progress' ? 'Your shop is taking shape' : 'Waiting for your direction'}</span>
        </div>
        {activeShop && shop ? (
          <Link href={`/list?token=${encodeURIComponent(token ?? '')}&list=${encodeURIComponent(shop.id)}`} onClick={() => trackEvent('home_shop_action', { home_state: state, action: 'review_shop', list_id: shop.id }, token ?? undefined)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0b1710] px-4 py-3.5 text-sm font-bold text-white transition hover:bg-[#173124]">Review my shop <ArrowUpRight className="size-4" /></Link>
        ) : (
          <button type="button" onClick={focusAgent} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0b1710] px-4 py-3.5 text-sm font-bold text-white transition hover:bg-[#173124]">{state === 'progress' ? 'Continue this shop' : 'Start with your agent'} <ArrowUpRight className="size-4" /></button>
        )}
        {activeShop && shop && <p className="mt-3 text-center font-mono text-[10px] text-[#9aa19c]">{formatUpdated(shop.generatedAt)}</p>}
      </div>
    </aside>
  );
}

export function WeeklyCommandCentre({ visualPreviewState }: { visualPreviewState?: HomeState }) {
  const [plan, setPlan] = useState<WeeklyPlanState | null>(() => visualPreviewState ? previewPlan(visualPreviewState) : null);
  const [loading, setLoading] = useState(!visualPreviewState);
  const [token, setToken] = useState<string | null>(visualPreviewState ? '__cookie__' : null);
  const [journeyState, setJourneyState] = useState<HomePlannerJourneyState>({ hasConversation: false, hasProposedShop: false });
  const [watches, setWatches] = useState<ProductWatch[]>(() => visualPreviewState ? [
    { id: 'preview-watch-1', canonical_name: 'Pampers Baby-Dry Size 5', product_family: 'Nappies', source_request: 'Tell me when Pampers Size 5 drops below €15', condition: { kind: 'price_below', amount: 15 } },
    { id: 'preview-watch-2', canonical_name: 'Dairygold Spreadable 454g', product_family: 'Butter', source_request: 'Watch for a useful promotion', condition: { kind: 'promotion_started' } },
  ] : []);

  const fetchPlan = useCallback(async (sessionToken: string) => {
    try {
      const response = await fetch(`/api/plan/weekly?token=${encodeURIComponent(sessionToken)}`);
      if (!response.ok) return;
      const data = await response.json() as WeeklyPlanState & { error?: string };
      if (!data.error) setPlan(data);
    } catch {}
  }, []);

  useEffect(() => {
    if (visualPreviewState) return;
    const frame = requestAnimationFrame(() => {
      const sessionToken = loadSession()?.token ?? null;
      setToken(sessionToken);
      if (sessionToken) {
        void Promise.all([
          fetchPlan(sessionToken),
          fetch(`/api/agent/watches?token=${encodeURIComponent(sessionToken)}`).then(response => response.ok ? response.json() : { watches: [] }).then(data => setWatches(data.watches ?? [])),
        ]).finally(() => setLoading(false));
      }
      else setLoading(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [fetchPlan, visualPreviewState]);

  useEffect(() => {
    if (!token || visualPreviewState) return;
    const refreshAfterAgentTurn = () => fetchPlan(token).catch(() => {});
    window.addEventListener('sm:eve-turn-finished', refreshAfterAgentTurn);
    return () => window.removeEventListener('sm:eve-turn-finished', refreshAfterAgentTurn);
  }, [token, fetchPlan, visualPreviewState]);

  const homeState = useMemo<HomeState>(() => {
    const shop = plan?.currentShop;
    const activeShop = Boolean(shop && plan?.weekStart && shop.generatedAt.slice(0, 10) >= plan.weekStart);
    if (activeShop && shop?.unresolvedCount === 0) return 'ready';
    if (activeShop || journeyState.hasConversation || journeyState.hasProposedShop || plan?.status === 'partial') return 'progress';
    return 'new';
  }, [journeyState, plan]);

  const emptyStateCopy = homeState === 'ready' ? {
    eyebrow: 'Your shop is ready to review',
    title: 'A complete week, ready when you are.',
    description: 'Review the shop, ask for a change or add anything the household still needs.',
  } : homeState === 'progress' ? {
    eyebrow: 'Picking up this week\'s shop',
    title: 'Your shop is taking shape.',
    description: 'Continue where you left off, resolve a choice or ask your agent to change the plan.',
  } : undefined;

  useEffect(() => {
    if (loading || !token) return;
    trackEventOnce('signed_in_home_state_viewed', { home_state: homeState, has_current_shop: Boolean(plan?.currentShop), has_agent_continuity: journeyState.hasConversation }, token);
  }, [homeState, journeyState.hasConversation, loading, plan?.currentShop, token]);

  if (loading) return <div className="grid animate-pulse gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(310px,0.72fr)]"><div className="h-[610px] rounded-[2rem] bg-white/70" /><div className="h-[610px] rounded-[1.75rem] bg-white/70" /></div>;

  return (
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(310px,0.72fr)]">
      <section className="min-w-0 overflow-hidden rounded-[2rem] border border-[#dce5de] bg-white shadow-[0_30px_90px_rgba(34,61,43,0.13)]">
        {homeState !== 'new' && (
          <div className="flex items-center gap-3 border-b border-[#e3eae5] bg-[#f4faf6] px-5 py-3 sm:px-7">
            <span className="relative flex size-9 items-center justify-center rounded-xl bg-white text-[#168049] shadow-sm"><ShoppingBasket className="size-4" /><span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-white bg-[#67d58d]" /></span>
            <div className="min-w-0 flex-1"><p className="text-xs font-bold text-[#315c40]">Your agent is working with this week&apos;s shop</p><p className="mt-0.5 text-[10px] font-semibold text-[#7a867e]"><span className="text-[#168049]">Understand</span> <span className="mx-1">→</span> <span className="text-[#168049]">Check</span> <span className="mx-1">→</span> <span className={homeState === 'ready' ? 'text-[#168049]' : ''}>Prepare</span></p></div>
            <span className="hidden text-xs font-semibold text-[#4e5b52] sm:block">{homeState === 'ready' ? 'Ready to review' : 'Taking shape'}</span>
          </div>
        )}
        <HomePlanner primaryHeading signedInEmptyState={emptyStateCopy} onJourneyStateChange={setJourneyState} />
        {journeyState.hasConversation && <p className="border-t border-[#edf0ed] px-5 py-2.5 text-center text-[10px] text-[#8c958f]">This conversation is saved automatically. Household preferences, watches and validated shops remain under your control.</p>}
      </section>
      <LivingReceipt plan={plan} state={homeState} token={token} watches={watches} onBudgetUpdated={budget => setPlan(current => current ? { ...current, budget: { ...current.budget, target: budget, onTrack: budget == null || current.budget.current <= budget } } : current)} />
    </div>
  );
}
