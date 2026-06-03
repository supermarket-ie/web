'use client';

import { useEffect, useState, type ReactNode } from 'react';
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
  {
    href: '/dashboard/agents',
    label: 'Agents',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
      </svg>
    ),
    match: (p: string) => p.startsWith('/dashboard/agents'),
  },
];

const HIDDEN_ON = ['/blog', '/compare', '/deals', '/shop', '/store', '/cost-of-weekly-shop', '/privacy', '/terms', '/contact', '/vendor', '/unsubscribe', '/list/request', '/list/share'];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [listToken, setListToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = loadSession();
    setListToken(session?.token ?? null);
    setReady(true);
  }, []);

  const hideNav = HIDDEN_ON.some(p => pathname.startsWith(p));
  const showNav = ready && !!listToken && !hideNav;

  function signOut() {
    clearSession();
    window.location.href = '/';
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* ── Header — always full width ── */}
      <header className="sticky top-0 z-40 w-full px-6 py-3.5" style={{ background: '#00944A' }}>
        <div className="flex justify-between items-center">
          <Link href="/" className="flex-shrink-0">
            <span className="text-[28px] font-extrabold tracking-tight" style={{ color: '#FFFFFF', letterSpacing: '-0.02em' }}>
              supermarket<span style={{ color: '#d4ffe5' }}>.ie</span>
            </span>
          </Link>
          {ready && (
            showNav ? (
              <button onClick={signOut} className="hidden md:inline-flex text-sm font-medium hover:opacity-80 transition-opacity" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Sign out
              </button>
            ) : (
              <Link href="/list/request" className="hidden md:inline-flex items-center px-5 py-2 text-sm font-semibold rounded-full hover:opacity-90 transition-opacity"
                style={{ border: '1.5px solid rgba(255,255,255,0.6)', color: '#FFFFFF' }}>
                Sign in
              </Link>
            )
          )}
        </div>
      </header>

      {/* ── Body: sidebar + content ── */}
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        {showNav && (
          <aside className="hidden md:flex flex-col flex-shrink-0 w-[200px] sticky top-[57px] self-start h-[calc(100vh-57px)]"
            style={{
              background: 'var(--surface-container-lowest)',
              borderRight: '1px solid var(--surface-container-low)',
            }}
          >
            <nav className="flex flex-col gap-0.5 px-3 pt-4 flex-1">
              {NAV_ITEMS.map(item => {
                const active = item.match(pathname);
                const href = item.href === '/list'
                  ? `/list?token=${encodeURIComponent(listToken!)}`
                  : item.href;
                return (
                  <Link
                    key={item.href}
                    href={href}
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-colors"
                    style={{
                      background: active ? 'var(--surface-container)' : 'transparent',
                      color: active ? 'var(--on-surface)' : 'var(--on-surface-variant)',
                      fontWeight: active ? 600 : 400,
                      textDecoration: 'none',
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-container-low)'; }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{ opacity: active ? 1 : 0.5, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="px-3 pb-6 pt-2" style={{ borderTop: '1px solid var(--surface-container-low)' }}>
              <button onClick={signOut} className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-opacity hover:opacity-70"
                style={{ color: 'var(--on-surface-variant)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign out
              </button>
            </div>
          </aside>
        )}

        {/* Main content */}
        <div className={`flex-1 min-w-0 ${showNav ? 'pb-20 md:pb-0' : ''}`}>
          {children}
        </div>
      </div>

      {/* ── Footer — full width, same as header ── */}
      <footer className="py-12 px-6" style={{ background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
            <Link href="/" className="font-extrabold text-xl" style={{ color: 'var(--inverse-on-surface)', letterSpacing: '-0.02em' }}>
              supermarket<span style={{ color: 'var(--primary-container)' }}>.ie</span>
            </Link>
            <nav className="flex gap-6 text-sm" style={{ color: 'rgba(249,246,245,0.5)' }}>
              <Link href="/privacy" className="hover:text-white transition">Privacy</Link>
              <Link href="/terms" className="hover:text-white transition">Terms</Link>
              <Link href="/contact" className="hover:text-white transition">Contact</Link>
            </nav>
          </div>
          <p className="text-center text-sm pt-8" style={{ color: 'rgba(249,246,245,0.3)' }}>
            © 2026 Gosuper Ltd (Company No. 700162) · supermarket.ie · Made with ❤️ in Ireland
          </p>
        </div>
      </footer>

      {/* Mobile bottom bar */}
      {showNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
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
                ? `/list?token=${encodeURIComponent(listToken!)}`
                : item.href;
              return (
                <Link key={item.href} href={href}
                  className="flex-1 flex flex-col items-center justify-center gap-1 py-3 relative"
                  style={{ color: active ? 'var(--primary)' : 'var(--on-surface-variant)' }}
                >
                  {item.icon}
                  <span className="text-[10px] font-semibold">{item.label}</span>
                  {active && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full"
                      style={{ background: 'var(--primary)' }} />
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
