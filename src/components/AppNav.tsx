'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { loadSession, clearSession } from '@/lib/session';

const NAV_ITEMS = [
  {
    href: '/',
    label: 'Plan',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    match: (p: string) => p === '/',
  },
  {
    href: '/list',
    label: 'My List',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 12h6M9 16h4" />
      </svg>
    ),
    match: (p: string) => p.startsWith('/list') && !p.startsWith('/list/request'),
  },
  {
    href: '/dashboard',
    label: 'History',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    match: (p: string) => p.startsWith('/dashboard') && !p.startsWith('/dashboard/profile'),
  },
  {
    href: '/dashboard/profile',
    label: 'Profile',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
    match: (p: string) => p.startsWith('/dashboard/profile'),
  },
];

const HIDDEN_ON = ['/blog', '/compare', '/deals', '/shop', '/store', '/cost-of-weekly-shop', '/privacy', '/terms', '/contact', '/vendor', '/unsubscribe', '/list/request', '/list/share'];

export function AppNav() {
  const pathname = usePathname();
  const [listToken, setListToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = loadSession();
    setListToken(session?.token ?? null);
    setReady(true);
  }, []);

  if (!ready || !listToken) return null;
  if (HIDDEN_ON.some(p => pathname.startsWith(p))) return null;

  function signOut() {
    clearSession();
    window.location.href = '/';
  }

  return (
    <>
      {/* ── Mobile: fixed bottom bar ─────────────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
        style={{
          background: 'var(--surface-container-lowest)',
          borderTop: '1px solid var(--surface-container)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="flex">
          {NAV_ITEMS.map(item => {
            const active = item.match(pathname);
            const href = item.href === '/list'
              ? `/list?token=${encodeURIComponent(listToken)}`
              : item.href;
            return (
              <Link
                key={item.href}
                href={href}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-3 relative"
                style={{ color: active ? 'var(--primary)' : 'var(--on-surface-variant)' }}
              >
                {item.icon}
                <span className="text-[10px] font-semibold">{item.label}</span>
                {active && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                    style={{ background: 'var(--primary)' }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ── Desktop: left sidebar — flush under the green header ── */}
      <aside
        className="hidden md:flex flex-col fixed left-0 bottom-0 z-30"
        style={{
          top: '56px',
          width: '220px',
          background: 'var(--surface-container-lowest)',
          borderRight: '1px solid var(--surface-container)',
        }}
      >
        <nav className="flex flex-col gap-0.5 px-3 pt-4 flex-1">
          {NAV_ITEMS.map(item => {
            const active = item.match(pathname);
            const href = item.href === '/list'
              ? `/list?token=${encodeURIComponent(listToken)}`
              : item.href;
            return (
              <Link
                key={item.href}
                href={href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: active ? '#00944A' : 'transparent',
                  color: active ? '#ffffff' : 'var(--on-surface-variant)',
                }}
              >
                <span style={{ opacity: active ? 1 : 0.65 }}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-6 pt-2" style={{ borderTop: '1px solid var(--surface-container)' }}>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-70"
            style={{ color: 'var(--on-surface-variant)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
