'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadSession } from '@/lib/session';

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [listUrl, setListUrl] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (s?.token) setListUrl(`/list?token=${s.token}`);
  }, []);

  return (
    <header className="glass px-6 py-4 sticky top-0 z-20">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>
            <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="var(--on-primary-container)" strokeWidth="1.5" strokeLinejoin="round"/>
              <line x1="3" y1="6" x2="21" y2="6" stroke="var(--on-primary-container)" strokeWidth="1.5"/>
              <path d="M16 10a4 4 0 01-8 0" stroke="var(--on-primary-container)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-[20px] font-extrabold" style={{ color: 'var(--on-background)', letterSpacing: '-0.02em' }}>
            supermarket<span style={{ color: 'var(--primary)' }}>.ie</span>
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          <Link href="/shop"    className="text-sm font-medium hidden md:block transition-colors hover:text-primary" style={{ color: 'var(--on-surface)' }}>Prices</Link>
          <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="text-sm font-medium hidden md:block transition-colors hover:text-primary" style={{ color: 'var(--on-surface)' }}>Compare</Link>
          <Link href="/blog"    className="text-sm font-medium hidden md:block transition-colors hover:text-primary" style={{ color: 'var(--on-surface)' }}>Blog</Link>
          {listUrl ? (
            <Link href={listUrl} className="btn-primary hidden md:inline-flex px-4 py-2 text-sm">
              View my list →
            </Link>
          ) : (
            <Link href="/list/request" className="btn-primary hidden md:inline-flex px-4 py-2 text-sm">
              Get my list
            </Link>
          )}

          {/* Hamburger — mobile only */}
          <button className="md:hidden flex flex-col gap-1.5 p-1 ml-1" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
            <span className={`block w-5 h-0.5 transition-all duration-200 origin-center ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} style={{ background: 'var(--on-background)' }} />
            <span className={`block w-5 h-0.5 transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`}                                   style={{ background: 'var(--on-background)' }} />
            <span className={`block w-5 h-0.5 transition-all duration-200 origin-center ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`}    style={{ background: 'var(--on-background)' }} />
          </button>
        </nav>
      </div>

      {menuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 px-6 py-4 flex flex-col gap-4 z-20 shadow-lg"
          style={{ background: 'rgba(249,246,245,0.97)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}>
          <Link href="/shop"    className="font-medium text-base py-1" style={{ color: 'var(--on-background)' }} onClick={() => setMenuOpen(false)}>Prices</Link>
          <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="font-medium text-base py-1" style={{ color: 'var(--on-background)' }} onClick={() => setMenuOpen(false)}>Compare</Link>
          <Link href="/blog"    className="font-medium text-base py-1" style={{ color: 'var(--on-background)' }} onClick={() => setMenuOpen(false)}>Blog</Link>
          {listUrl ? (
            <Link href={listUrl} className="btn-primary mt-1 px-4 py-3 text-sm text-center" onClick={() => setMenuOpen(false)}>
              View my list →
            </Link>
          ) : (
            <Link href="/list/request" className="btn-primary mt-1 px-4 py-3 text-sm text-center" onClick={() => setMenuOpen(false)}>
              Get my list
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
