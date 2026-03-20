'use client';

import { useState } from 'react';
import Link from 'next/link';

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="px-6 py-4 border-b border-[#E8E2DC] bg-[#FFFBF7] sticky top-0 z-20">
      <div className="max-w-6xl mx-auto flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="relative w-8 h-8">
            <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <path d="M8 12C8 10.8954 8.89543 10 10 10H30C31.1046 10 32 10.8954 32 12V32C32 34.2091 30.2091 36 28 36H12C9.79086 36 8 34.2091 8 32V12Z" fill="#E17055" />
              <path d="M14 10V8C14 5.79086 15.7909 4 18 4H22C24.2091 4 26 5.79086 26 8V10" stroke="#E17055" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M20 17L17 30" stroke="#FFFBF7" strokeWidth="4" strokeLinecap="round" />
              <path d="M18 17C18 17 19 15 20 15C21 15 22 17 22 17" stroke="#00B894" strokeWidth="2" strokeLinecap="round" />
              <path d="M20 15V13" stroke="#00B894" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <span className="text-[20px] font-bold tracking-tight text-[#1D2324]">
            supermarket<span className="text-[#1D2324]">.ie</span>
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          <Link href="/shop" className="text-[#636E72] hover:text-[#1D2324] transition text-sm font-medium hidden md:block">Prices</Link>
          <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="text-[#636E72] hover:text-[#1D2324] transition text-sm font-medium hidden md:block">Compare</Link>
          <Link href="/blog" className="text-[#636E72] hover:text-[#1D2324] transition text-sm font-medium hidden md:block">Blog</Link>
          <Link href="/" className="hidden md:block bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all shadow-sm whitespace-nowrap">
            Get started free
          </Link>
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden flex flex-col gap-1.5 p-1 ml-1"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
          >
            <span className={`block w-5 h-0.5 bg-[#1D2324] transition-all duration-200 origin-center ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[#1D2324] transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-0.5 bg-[#1D2324] transition-all duration-200 origin-center ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
          </button>
        </nav>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-white border-b border-[#E8E2DC] shadow-lg px-6 py-4 flex flex-col gap-4 z-20">
          <Link href="/shop" className="text-[#1D2324] font-medium text-base py-1" onClick={() => setMenuOpen(false)}>Prices</Link>
          <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="text-[#1D2324] font-medium text-base py-1" onClick={() => setMenuOpen(false)}>Compare</Link>
          <Link href="/blog" className="text-[#1D2324] font-medium text-base py-1" onClick={() => setMenuOpen(false)}>Blog</Link>
          <Link href="/" className="mt-1 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-4 py-3 rounded-xl text-sm font-semibold text-center" onClick={() => setMenuOpen(false)}>
            Get started free
          </Link>
        </div>
      )}
    </header>
  );
}
