'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { loadSession } from '@/lib/session';

type Watch = { id: string; type: string; canonical_name: string | null; product_family: string | null; source_request: string | null };
type SavedList = { id: string; name: string; created_at: string; store_totals: Array<{ store: string; total: number }> | null };
type Briefing = { summary: string; insights: Array<{ title: string; body: string }> };

export function HomeActivity() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [lists, setLists] = useState<SavedList[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);

  useEffect(() => {
    const token = loadSession()?.token;
    if (!token) return;
    Promise.all([
      fetch(`/api/agent/watches?token=${encodeURIComponent(token)}`).then(r => r.ok ? r.json() : { watches: [] }),
      fetch(`/api/lists?token=${encodeURIComponent(token)}`).then(r => r.ok ? r.json() : { lists: [] }),
      fetch(`/api/agent/briefing?token=${encodeURIComponent(token)}`).then(r => r.ok ? r.json() : null),
    ]).then(([watchData, listData, briefingData]) => {
      setWatches(watchData.watches ?? []);
      setLists((listData.lists ?? []).slice(0, 3));
      if (briefingData) setBriefing(briefingData);
    }).catch(() => {});
  }, []);

  if (!watches.length && !lists.length && !(briefing?.insights?.length)) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold" style={{ color: 'var(--on-surface)' }}>Activity</h2>
        <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>What we remember and watch</span>
      </div>

      {briefing?.insights?.length ? (
        <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#00944A' }}>Worth knowing</p>
          <div className="space-y-2">
            {briefing.insights.slice(0, 3).map((insight, i) => (
              <div key={i}>
                <p className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>{insight.title}</p>
                <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{insight.body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {watches.length ? (
        <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>Watching for you</p>
            <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{watches.length} active</span>
          </div>
          <div className="space-y-1.5">
            {watches.slice(0, 4).map(w => (
              <div key={w.id} className="flex items-start gap-2 text-xs">
                <span style={{ color: '#00944A' }}>●</span>
                <span style={{ color: 'var(--on-surface)' }}>{w.canonical_name || w.product_family || w.source_request || 'Product watch'}</span>
              </div>
            ))}
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--on-surface-variant)' }}>Ask Supermarket.ie to add, change or stop a watch.</p>
        </div>
      ) : null}

      {lists.length ? (
        <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--on-surface)' }}>Recent shops</p>
          <div className="space-y-2">
            {lists.map(list => {
              const total = Math.min(...(list.store_totals ?? []).map(s => s.total).filter(Number.isFinite));
              return (
                <Link key={list.id} href={`/list?id=${encodeURIComponent(list.id)}`} className="flex items-center justify-between text-sm" style={{ textDecoration: 'none', color: 'var(--on-surface)' }}>
                  <span className="truncate pr-3">{list.name || 'Saved shop'}</span>
                  <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{Number.isFinite(total) ? `€${total.toFixed(2)}` : new Date(list.created_at).toLocaleDateString('en-IE', { month: 'short', day: 'numeric' })}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
