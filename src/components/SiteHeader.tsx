'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { loadSession, clearSession } from '@/lib/session';

const NAV_ITEMS = [
  { href: '/', label: 'Plan', match: (p: string) => p === '/' },
  { href: '/list', label: 'My List', match: (p: string) => p.startsWith('/list') && !p.startsWith('/list/request') },
  { href: '/dashboard', label: 'History', match: (p: string) => p.startsWith('/dashboard') && !p.startsWith('/dashboard/profile') },
  { href: '/dashboard/profile', label: 'Profile', match: (p: string) => p.startsWith('/dashboard/profile') },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [listToken, setListToken] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const s = loadSession();
    if (s?.token) setListToken(s.token);
  }, []);

  function signOut() {
    clearSession();
    window.location.href = '/';
  }

  const isSignedIn = mounted && !!listToken;

  return (
    <header className="px-6 py-3.5 sticky top-0 z-20" style={{ background: '#00944A' }}>
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[28px] font-extrabold tracking-tight" style={{ color: '#FFFFFF', letterSpacing: '-0.02em' }}>
            supermarket<span style={{ color: '#d4ffe5' }}>.ie</span>
          </span>
        </Link>

        {/* Desktop nav — signed-in users get full nav, signed-out get nothing */}
        {isSignedIn && (
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map(item => {
              const active = item.match(pathname);
              const href = item.href === '/list'
                ? `/list?token=${encodeURIComponent(listToken!)}`
                : item.href;
              return (
                <Link
                  key={item.href}
                  href={href}
                  className="px-4 py-2 rounded-full text-[14px] font-semibold transition-all"
                  style={{
                    background: active ? 'rgba(255,255,255,0.2)' : 'transparent',
                    color: '#FFFFFF',
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        {/* Right side */}
        <div className="flex items-center gap-3">
          {mounted && (
            isSignedIn ? (
              <button
                onClick={signOut}
                className="hidden md:inline-flex text-sm font-medium transition-opacity hover:opacity-80"
                style={{ color: 'rgba(255,255,255,0.75)' }}
              >
                Sign out
              </button>
            ) : (
              <Link href="/list/request" className="hidden md:inline-flex items-center px-5 py-2 text-sm font-semibold rounded-full transition-opacity hover:opacity-90"
                style={{ border: '1.5px solid rgba(255,255,255,0.6)', color: '#FFFFFF' }}>
                Sign in
              </Link>
            )
          )}

          {/* Hamburger — mobile only */}
          <button className="md:hidden flex flex-col gap-1.5 p-1" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
            <span className={`block w-5 h-0.5 transition-all duration-200 origin-center ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} style={{ background: '#FFFFFF' }} />
            <span className={`block w-5 h-0.5 transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`} style={{ background: '#FFFFFF' }} />
            <span className={`block w-5 h-0.5 transition-all duration-200 origin-center ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} style={{ background: '#FFFFFF' }} />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 px-6 py-5 flex flex-col gap-4 z-20 shadow-lg"
          style={{ background: '#00944A' }}>
          {isSignedIn ? (
            <>
              {NAV_ITEMS.map(item => {
                const href = item.href === '/list'
                  ? `/list?token=${encodeURIComponent(listToken!)}`
                  : item.href;
                return (
                  <Link key={item.href} href={href} className="font-semibold text-base py-1" style={{ color: '#FFFFFF' }} onClick={() => setMenuOpen(false)}>
                    {item.label}
                  </Link>
                );
              })}
              <button onClick={signOut} className="text-sm text-left font-medium mt-2" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Sign out
              </button>
            </>
          ) : (
            <Link href="/list/request" className="mt-2 px-4 py-3 text-sm text-center font-semibold rounded-full"
              style={{ border: '1.5px solid rgba(255,255,255,0.6)', color: '#FFFFFF' }}
              onClick={() => setMenuOpen(false)}>
              Sign in
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
