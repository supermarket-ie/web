'use client';

import { useState } from 'react';
import Link from 'next/link';

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }} className="px-6 py-4 sticky top-0 z-20">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="relative w-8 h-8">
            <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <defs>
                <linearGradient id="bagGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#006A35"/>
                  <stop offset="100%" stopColor="#6BFE9C"/>
                </linearGradient>
              </defs>
              <path d="M8 12C8 10.8954 8.89543 10 10 10H30C31.1046 10 32 10.8954 32 12V32C32 34.2091 30.2091 36 28 36H12C9.79086 36 8 34.2091 8 32V12Z" fill="url(#bagGrad)" />
              <path d="M14 10V8C14 5.79086 15.7909 4 18 4H22C24.2091 4 26 5.79086 26 8V10" stroke="#004a23" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M14 22h12M20 17v10" stroke="#004a23" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-[20px] font-bold tracking-tight text-[#2F2F2E]">
            supermarket<span className="text-[#006A35]">.ie</span>
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
