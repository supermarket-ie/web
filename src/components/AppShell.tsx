'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { loadSession, clearSession } from '@/lib/session';
import { AgentMark } from '@/components/homepage/AgentMark';

const NAV_ITEMS = [
  {
    href: '/',
    label: 'Home',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10h14V10" />
      </svg>
    ),
    match: (p: string) => p === '/',
  },
  {
    href: '/list',
    label: 'My Shop',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
    match: (p: string) => p.startsWith('/list') && !p.startsWith('/list/request') && !p.startsWith('/list/share'),
  },
  {
    href: '/shop',
    label: 'Browse',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    ),
    match: (p: string) => p.startsWith('/shop') || p.startsWith('/browse'),
  },
  {
    href: '/dashboard/profile',
    label: 'Household',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    match: (p: string) => p.startsWith('/dashboard/profile'),
  },
];

const HIDDEN_ON = ['/blog', '/compare', '/deals', '/store', '/cost-of-weekly-shop', '/privacy', '/terms', '/contact', '/vendor', '/unsubscribe', '/list/request', '/list/share'];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [listToken, setListToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = loadSession();
    const token = session?.token ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate client-only state after mount
    setListToken(token);
    setReady(true);

    // Old History route is no longer a primary destination. Direct visits remain
    // supported, but the generic dashboard landing returns signed-in users Home.
    if (token && pathname === '/dashboard') {
      router.replace('/');
    }

    function handleSessionReady(e: Event) {
      const newToken = (e as CustomEvent<{ token: string }>).detail?.token ?? null;
      if (newToken && newToken !== token) {
        setListToken(newToken);
        setReady(true);
      }
    }
    window.addEventListener('sm:session-ready', handleSessionReady);
    return () => window.removeEventListener('sm:session-ready', handleSessionReady);
  }, [pathname, router]);

  const hideNav = HIDDEN_ON.some(p => pathname.startsWith(p));
  const showNav = ready && !!listToken && !hideNav;
  const [menuOpen, setMenuOpen] = useState(false);

  function signOut() {
    clearSession();
    window.location.href = '/';
  }

  function resolveHref(href: string) {
    return href === '/list' ? `/list?token=${encodeURIComponent(listToken!)}` : href;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-40 w-full border-b border-black/[0.05] bg-white/90 px-5 py-3 backdrop-blur-xl sm:px-7">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between">
          <Link href="/" className="flex shrink-0 items-center gap-2.5" onClick={() => setMenuOpen(false)}>
            <AgentMark className="size-8" label="supermarket.ie" />
            <span className="text-[23px] font-semibold tracking-[-0.055em] text-[#132019]">
              supermarket<span className="text-[#168049]">.ie</span>
            </span>
          </Link>

          <div className="hidden sm:flex items-center gap-4">
            {!showNav && !hideNav && (
              <Link href="/shop" className="text-sm font-medium text-[#536058] transition-colors hover:text-[#132019]">
                Browse
              </Link>
            )}
            {ready && (
              showNav ? (
                <button onClick={signOut} className="text-sm font-medium text-[#536058] transition-colors hover:text-[#132019]">
                  Sign out
                </button>
              ) : (
                <Link href="/list/request" className="inline-flex items-center rounded-full bg-[#0b1710] px-5 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.02]">
                  Sign in
                </Link>
              )
            )}
          </div>

          <button className="flex size-9 items-center justify-center rounded-lg text-[#132019] transition-opacity hover:opacity-70 sm:hidden"
            onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
            {menuOpen ? (
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {menuOpen && (
          <div className="mt-3 flex flex-col gap-1 border-t border-black/[0.06] pb-2 sm:hidden">
            {!showNav && !hideNav && (
              <Link href="/shop" className="rounded-lg px-2 py-2.5 text-sm font-semibold text-[#132019] hover:bg-[#f3f6f3]" onClick={() => setMenuOpen(false)}>
                Browse
              </Link>
            )}
            {ready && (
              showNav ? (
                <button onClick={() => { setMenuOpen(false); signOut(); }}
                  className="rounded-lg px-2 py-2.5 text-left text-sm font-medium text-[#132019] hover:bg-[#f3f6f3]">
                  Sign out
                </button>
              ) : (
                <Link href="/list/request" className="rounded-lg px-2 py-2.5 text-sm font-semibold text-[#132019] hover:bg-[#f3f6f3]" onClick={() => setMenuOpen(false)}>
                  Sign in
                </Link>
              )
            )}
          </div>
        )}
      </header>

      <div className="flex flex-1">
        {showNav && (
          <aside className="hidden md:flex flex-col flex-shrink-0 sticky top-[57px] self-start h-[calc(100vh-57px)]"
            style={{ width: 220, background: '#fff', borderRight: '1px solid #eaeaea' }}>
            <nav className="flex flex-col pt-2 pb-2 flex-1 overflow-y-auto">
              {NAV_ITEMS.map(item => {
                const active = item.match(pathname);
                return (
                  <Link key={item.href} href={resolveHref(item.href)}
                    className="sidebar-nav-item" data-active={active ? 'true' : 'false'}
                    style={{ textDecoration: 'none' }}>
                    <span className="sidebar-nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div style={{ borderTop: '1px solid #eaeaea', padding: '8px 0' }}>
              <button onClick={signOut} className="sidebar-nav-item"
                style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span className="sidebar-nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </span>
                <span>Sign out</span>
              </button>
            </div>
          </aside>
        )}

        <div className={`flex-1 min-w-0 ${showNav ? 'pb-20 md:pb-0' : ''}`}>
          {children}
        </div>
      </div>

      <footer className="py-12 px-6" style={{ background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
            <Link href="/" className="font-extrabold text-xl" style={{ color: 'var(--inverse-on-surface)', letterSpacing: '-0.02em' }}>
              supermarket<span style={{ color: 'var(--primary-container)' }}>.ie</span>
            </Link>
            <nav className="flex gap-6 text-sm" style={{ color: 'rgba(249,246,245,0.5)' }}>
              <Link href="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</Link>
              <Link href="/terms" style={{ color: 'inherit', textDecoration: 'none' }}>Terms</Link>
              <Link href="/contact" style={{ color: 'inherit', textDecoration: 'none' }}>Contact</Link>
              <Link href="/vendor" style={{ color: 'inherit', textDecoration: 'none' }}>For vendors</Link>
            </nav>
          </div>
          <p className="text-center text-xs" style={{ color: 'rgba(249,246,245,0.35)' }}>
            © {new Date().getFullYear()} supermarket.ie — your household shopping agent for Ireland
          </p>
        </div>
      </footer>

      {showNav && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex"
          style={{ background: '#1C2B22', borderTop: '1px solid rgba(107,254,156,0.2)', height: 64, paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {NAV_ITEMS.map(item => {
            const active = item.match(pathname);
            return (
              <Link key={item.href} href={resolveHref(item.href)}
                className="flex-1 flex flex-col items-center justify-center gap-1 relative"
                style={{ textDecoration: 'none' }}>
                {active && (
                  <span className="absolute top-1.5 left-1/2 -translate-x-1/2 rounded-full"
                    style={{ width: 32, height: 3, background: '#6BFE9C' }} />
                )}
                <span style={{ color: active ? '#6BFE9C' : 'rgba(255,255,255,0.65)', marginTop: active ? 4 : 0 }}>
                  {item.icon}
                </span>
                <span style={{
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  color: active ? '#ffffff' : 'rgba(255,255,255,0.65)',
                  letterSpacing: '-0.01em',
                }}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      )}

      <style>{`
        .sidebar-nav-item {
          display: flex; align-items: center; gap: 8px;
          margin: 0 6px; padding: 5px 8px; border-radius: 6px;
          font-size: 14px; font-weight: 400; color: #000;
          letter-spacing: -0.01em; transition: background 0.1s; line-height: 1.4;
        }
        .sidebar-nav-item:hover { background: #f2f2f2; }
        .sidebar-nav-item[data-active="true"] { background: #ededed; font-weight: 500; }
        .sidebar-nav-icon {
          display: flex; align-items: center; justify-content: center;
          width: 18px; height: 18px; flex-shrink: 0; opacity: 0.7; color: #000;
        }
        .sidebar-nav-item[data-active="true"] .sidebar-nav-icon,
        .sidebar-nav-item:hover .sidebar-nav-icon { opacity: 1; }
      `}</style>
    </div>
  );
}
