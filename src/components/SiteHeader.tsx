'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadSession, clearSession } from '@/lib/session';

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [listUrl, setListUrl] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const s = loadSession();
    if (s?.token) setListUrl(`/list?token=${s.token}`);
  }, []);

  function signOut() {
    clearSession();
    window.location.href = '/';
  }

  return (
    <header className="px-6 py-3.5 sticky top-0 z-20" style={{ background: '#00944A' }}>
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        {/* Logo — left */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[24px] font-extrabold tracking-tight" style={{ color: '#FFFFFF', letterSpacing: '-0.02em' }}>
            supermarket<span style={{ color: '#d4ffe5' }}>.ie</span>
          </span>
        </Link>

        {/* Nav — centered between logo and CTA */}
        <nav className="hidden md:flex items-center gap-10">
          <Link href="/shop" className="text-[15px] font-semibold transition-opacity hover:opacity-80" style={{ color: '#FFFFFF' }}>Prices</Link>
          <Link href="/compare/supermarket-prices-ireland" className="text-[15px] font-semibold transition-opacity hover:opacity-80" style={{ color: '#FFFFFF' }}>Compare</Link>
          <Link href="/blog" className="text-[15px] font-semibold transition-opacity hover:opacity-80" style={{ color: '#FFFFFF' }}>Blog</Link>
        </nav>

        {/* Right — CTA + hamburger */}
        <div className="flex items-center gap-4">
          {mounted && (
            listUrl ? (
              <>
                <Link href={listUrl} className="hidden md:inline-flex items-center px-5 py-2 text-sm font-semibold rounded-full transition-opacity hover:opacity-90"
                  style={{ background: '#FFFFFF', color: '#00944A' }}>
                  View my list →
                </Link>
                <button onClick={signOut} className="hidden md:inline-flex text-sm font-medium transition-opacity hover:opacity-80"
                  style={{ color: 'rgba(255,255,255,0.75)' }}>
                  Sign out
                </button>
              </>
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

      {menuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 px-6 py-5 flex flex-col gap-4 z-20 shadow-lg"
          style={{ background: '#00944A' }}>
          <Link href="/shop" className="font-semibold text-base py-1" style={{ color: '#FFFFFF' }} onClick={() => setMenuOpen(false)}>Prices</Link>
          <Link href="/compare/supermarket-prices-ireland" className="font-semibold text-base py-1" style={{ color: '#FFFFFF' }} onClick={() => setMenuOpen(false)}>Compare</Link>
          <Link href="/blog" className="font-semibold text-base py-1" style={{ color: '#FFFFFF' }} onClick={() => setMenuOpen(false)}>Blog</Link>

          {listUrl ? (
            <>
              <Link href={listUrl} className="mt-2 px-4 py-3 text-sm text-center font-semibold rounded-full"
                style={{ background: '#FFFFFF', color: '#00944A' }}
                onClick={() => setMenuOpen(false)}>
                View my list →
              </Link>
              <button onClick={signOut} className="text-sm text-center font-medium"
                style={{ color: 'rgba(255,255,255,0.75)' }}>
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
