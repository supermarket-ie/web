'use client';

import { useState } from 'react';
import Link from 'next/link';

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }} className="px-6 py-4 sticky top-0 z-20">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
            <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="#004a23" strokeWidth="1.5" strokeLinejoin="round"/>
              <line x1="3" y1="6" x2="21" y2="6" stroke="#004a23" strokeWidth="1.5"/>
              <path d="M16 10a4 4 0 01-8 0" stroke="#004a23" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-[20px] font-extrabold tracking-tight" style={{ color: '#2F2F2E', letterSpacing: '-0.02em' }}>
            supermarket<span style={{ color: '#006A35' }}>.ie</span>
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          <Link href="/shop" className="text-[#5c5b5b] hover:text-[#006A35] transition text-sm font-medium hidden md:block">Prices</Link>
          <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="text-[#5c5b5b] hover:text-[#006A35] transition text-sm font-medium hidden md:block">Compare</Link>
          <Link href="/blog" className="text-[#5c5b5b] hover:text-[#006A35] transition text-sm font-medium hidden md:block">Blog</Link>
          <Link href="/list/request" className="hidden md:block px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap text-[#004a23]" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
            Sign in
          </Link>
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden flex flex-col gap-1.5 p-1 ml-1"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
          >
            <span className={`block w-5 h-0.5 bg-[#2F2F2E] transition-all duration-200 origin-center ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[#2F2F2E] transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[#2F2F2E] transition-all duration-200 origin-center ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </nav>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 shadow-lg px-6 py-4 flex flex-col gap-4 z-20" style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
          <Link href="/shop" className="text-[#2F2F2E] font-medium text-base py-1" onClick={() => setMenuOpen(false)}>Prices</Link>
          <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="text-[#2F2F2E] font-medium text-base py-1" onClick={() => setMenuOpen(false)}>Compare</Link>
          <Link href="/blog" className="text-[#2F2F2E] font-medium text-base py-1" onClick={() => setMenuOpen(false)}>Blog</Link>
          <Link href="/list/request" className="mt-1 px-4 py-3 rounded-xl text-sm font-semibold text-center text-[#004a23]" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }} onClick={() => setMenuOpen(false)}>
            Sign in
          </Link>
        </div>
      )}
    </header>
  );
}
