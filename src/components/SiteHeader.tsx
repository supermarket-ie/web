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
    <header className="px-6 py-3.5 sticky top-0 z-20" style={{ background: '#006A35' }}>
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-[24px] font-extrabold tracking-tight" style={{ color: '#FFFFFF', letterSpacing: '-0.02em' }}>
            supermarket<span style={{ color: '#6BFE9C' }}>.ie</span>
          </span>
        </Link>

        <nav className="flex items-center gap-8">
          <Link href="/shop" className="text-sm font-medium hidden md:block transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.9)' }}>Prices</Link>
          <Link href="/compare/supermarket-prices-ireland" className="text-sm font-medium hidden md:block transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.9)' }}>Compare</Link>
          <Link href="/blog" className="text-sm font-medium hidden md:block transition-opacity hover:opacity-80" style={{ color: 'rgba(255,255,255,0.9)' }}>Blog</Link>

          {mounted && (
            listUrl ? (
              <>
                <Link href={listUrl} className="hidden md:inline-flex items-center px-5 py-2 text-sm font-semibold rounded-full transition-opacity hover:opacity-90"
                  style={{ background: '#FFFFFF', color: '#006A35' }}>
                  View my list →
                </Link>
                <button onClick={signOut} className="hidden md:inline-flex text-sm font-medium transition-opacity hover:opacity-80"
                  style={{ color: 'rgba(255,255,255,0.75)' }}>
                  Sign out
                </button>
              </>
            ) : (
              <Link href="/list/request" className="hidden md:inline-flex items-center px-5 py-2 text-sm font-semibold rounded-full transition-opacity hover:opacity-90"
                style={{ border: '1.5px solid rgba(255,255,255,0.5)', color: '#FFFFFF' }}>
                Sign in
              </Link>
            )
          )}

          {/* Hamburger — mobile only */}
          <button className="md:hidden flex flex-col gap-1.5 p-1 ml-1" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
            <span className={`block w-5 h-0.5 transition-all duration-200 origin-center ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} style={{ background: '#FFFFFF' }} />
            <span className={`block w-5 h-0.5 transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`} style={{ background: '#FFFFFF' }} />
            <span className={`block w-5 h-0.5 transition-all duration-200 origin-center ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} style={{ background: '#FFFFFF' }} />
          </button>
        </nav>
      </div>

      {menuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 px-6 py-5 flex flex-col gap-4 z-20 shadow-lg"
          style={{ background: '#006A35' }}>
          <Link href="/shop" className="font-medium text-base py-1" style={{ color: '#FFFFFF' }} onClick={() => setMenuOpen(false)}>Prices</Link>
          <Link href="/compare/supermarket-prices-ireland" className="font-medium text-base py-1" style={{ color: '#FFFFFF' }} onClick={() => setMenuOpen(false)}>Compare</Link>
          <Link href="/blog" className="font-medium text-base py-1" style={{ color: '#FFFFFF' }} onClick={() => setMenuOpen(false)}>Blog</Link>

          {listUrl ? (
            <>
              <Link href={listUrl} className="mt-2 px-4 py-3 text-sm text-center font-semibold rounded-full"
                style={{ background: '#FFFFFF', color: '#006A35' }}
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
              style={{ border: '1.5px solid rgba(255,255,255,0.5)', color: '#FFFFFF' }}
              onClick={() => setMenuOpen(false)}>
              Sign in
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
