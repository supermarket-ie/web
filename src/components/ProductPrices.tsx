'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadSession } from '@/lib/session';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';

interface PriceRow {
  store: string;
  price: number;
  on_promotion: boolean;
  observed_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 4) return 'Updated today';
  if (hours < 24) return 'Updated today';
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Updated yesterday';
  return `Updated ${days} days ago`;
}

export function ProductPrices({ productId, stores }: { productId: string; stores: string[] }) {
  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (session?.token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate client-only state after mount
      setLoggedIn(true);
      setToken(session.token);
      // Fetch live prices
      fetch(`/api/products/${productId}/prices?token=${encodeURIComponent(session.token)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.prices) setPrices(d.prices);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [productId]);

  // Logged out — show gate
  if (!loggedIn) {
    return (
      <div className="rounded-2xl p-5 text-center mb-8"
        style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--on-background)' }}>
          Want to see prices?
        </p>
        <p className="text-xs mb-4" style={{ color: 'var(--on-surface-variant)' }}>
          Sign in to compare live prices across {stores.map(storeDisplayName).join(', ')}.
        </p>
        <Link href="/list/request"
          className="inline-block px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
          style={{ background: '#00944A' }}>
          See prices →
        </Link>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="mb-6 space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: 'var(--surface-container)' }} />
        ))}
      </div>
    );
  }

  // No prices found
  if (!prices || prices.length === 0) {
    return (
      <div className="rounded-2xl p-4 mb-6 text-center" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
        <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>No current prices available for this product.</p>
      </div>
    );
  }

  // Sort cheapest first
  const sorted = [...prices].sort((a, b) => a.price - b.price);
  const cheapest = sorted[0];
  const mostRecent = sorted.reduce((a, b) => new Date(a.observed_at) > new Date(b.observed_at) ? a : b);

  return (
    <div className="mb-6">
      <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--on-surface-variant)' }}>
        Live prices
      </h2>
      <div className="space-y-2">
        {sorted.map(p => {
          const s = storeStyle(p.store);
          const isCheapest = p.store === cheapest.store;
          return (
            <div key={p.store}
              className="flex items-center justify-between px-4 py-3 rounded-xl"
              style={{
                background: isCheapest ? s.light : 'var(--surface-container-lowest)',
                border: `1px solid ${isCheapest ? s.bg : 'var(--surface-container)'}`,
              }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: isCheapest ? s.bg : 'var(--on-background)' }}>
                  {storeDisplayName(p.store)}
                </span>
                {p.on_promotion && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: '#e85d04' }}>
                    DEAL
                  </span>
                )}
                {isCheapest && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: s.bg }}>
                    Cheapest
                  </span>
                )}
              </div>
              <span className="text-base font-bold" style={{ color: isCheapest ? s.bg : 'var(--on-background)' }}>
                €{p.price.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--on-surface-variant)' }}>
        {timeAgo(mostRecent.observed_at)}
      </p>

      {/* Plan CTA for logged-in users */}
      <div className="mt-4">
        <Link href="/"
          className="inline-block w-full text-center px-6 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
          style={{ background: '#00944A' }}>
          Plan my shop →
        </Link>
      </div>
    </div>
  );
}
