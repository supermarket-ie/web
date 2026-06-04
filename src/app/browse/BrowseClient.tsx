'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { type CATEGORY_CONFIG, type BrowseProduct } from '@/lib/category-config';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { loadSession } from '@/lib/session';

type CategoryConfig = typeof CATEGORY_CONFIG;

function groupByCategory(products: BrowseProduct[], cfg: CategoryConfig) {
  const groups = new Map<string, BrowseProduct[]>();
  for (const p of products) {
    const cat = p.category ?? 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(p);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    const oa = cfg[a]?.order ?? 99;
    const ob = cfg[b]?.order ?? 99;
    return oa !== ob ? oa - ob : a.localeCompare(b);
  });
}

const Logo = () => (
  <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
    <defs>
      <linearGradient id="browseBagGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#006A35"/>
        <stop offset="100%" stopColor="#6BFE9C"/>
      </linearGradient>
    </defs>
    <path d="M8 12C8 10.8954 8.89543 10 10 10H30C31.1046 10 32 10.8954 32 12V32C32 34.2091 30.2091 36 28 36H12C9.79086 36 8 34.2091 8 32V12Z" fill="url(#browseBagGrad)"/>
    <path d="M14 10V8C14 5.79086 15.7909 4 18 4H22C24.2091 4 26 5.79086 26 8V10" stroke="#004a23" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M14 22h12M20 17v10" stroke="#004a23" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

export function BrowseClient({ products, categoryConfig }: { products: BrowseProduct[]; categoryConfig: CategoryConfig }) {
  const grouped = groupByCategory(products, categoryConfig);
  const searchParams = useSearchParams();
  const [activeCategory, setActiveCategory] = useState<string | null>(() => {
    return null; // will be set from URL on mount
  });
  const [listUrl, setListUrl] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (session?.token) setListUrl(`/list?token=${session.token}`);
    // Initialise category from URL param
    const cat = searchParams.get('category');
    if (cat) setActiveCategory(cat);
  }, [searchParams]);

  const displayedGroups = activeCategory
    ? grouped.filter(([cat]) => cat === activeCategory)
    : grouped;

  const signInHref = listUrl ?? '/list/request';
  const signInLabel = listUrl ? 'View my list →' : 'Sign in for prices →';

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      <SiteHeader />

      {/* Page title */}
      <div className="px-4 md:px-6 pt-6 pb-2 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-[#2F2F2E]">Browse groceries</h1>
        <p className="text-[#5c5b5b] text-sm mt-1">{products.length} essentials · {grouped.length} categories</p>
      </div>

      {/* ── Instacart-style category icon strip ── */}
      <div className="px-4 md:px-6 py-5 max-w-5xl mx-auto overflow-visible">
        <div className="flex gap-3 overflow-x-auto overflow-y-visible pb-2 pt-2 -mx-1 px-1">
          {/* All */}
          <button onClick={() => setActiveCategory(null)}
            className="flex-shrink-0 flex flex-col items-center gap-1.5 w-[68px]">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all ${
              activeCategory === null
                ? 'shadow-md scale-105 ring-2 ring-[#006A35]'
                : 'bg-white hover:scale-105'
            }`} style={{ border: activeCategory !== null ? '2px solid rgba(175,173,172,0.2)' : undefined, background: activeCategory === null ? '#EAE7E7' : undefined }}>
              🛒
            </div>
            <span className={`text-[11px] font-semibold text-center leading-tight ${activeCategory === null ? 'text-[#006A35]' : 'text-[#5c5b5b]'}`}>All</span>
          </button>

          {grouped.map(([cat]) => {
            const cfg = categoryConfig[cat] ?? { emoji: '🛒', color: '#F5F0EB', order: 99 };
            const isActive = activeCategory === cat;
            return (
              <button key={cat} onClick={() => setActiveCategory(isActive ? null : cat)}
                className="flex-shrink-0 flex flex-col items-center gap-1.5 w-[68px]">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-all ${
                  isActive ? 'shadow-md scale-105 ring-2 ring-[#006A35]' : 'hover:scale-105'
                }`} style={{ border: !isActive ? '2px solid rgba(175,173,172,0.2)' : undefined, background: isActive ? '#EAE7E7' : cfg.color }}>
                  {cfg.emoji}
                </div>
                <span className={`text-[11px] font-semibold text-center leading-tight line-clamp-2 ${isActive ? 'text-[#006A35]' : 'text-[#5c5b5b]'}`}>
                  {cat}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Price unlock banner — logged-out only */}
      {!listUrl && (
        <div className="px-4 md:px-6 mb-4 max-w-5xl mx-auto">
          <div className="bg-white rounded-xl px-4 py-3 flex items-center gap-3" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
            <span className="text-xl flex-shrink-0">🔒</span>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-[#2F2F2E]">Prices hidden · </span>
              <span className="text-sm text-[#5c5b5b]">Sign in free to see live prices from all 5 stores</span>
            </div>
            <Link href="/list/request" className="flex-shrink-0 text-sm font-semibold text-[#006A35] hover:underline whitespace-nowrap">
              Unlock →
            </Link>
          </div>
        </div>
      )}

      {/* Product sections */}
      <main className="px-4 md:px-6 pb-16 max-w-5xl mx-auto space-y-8">
        {displayedGroups.map(([cat, items]) => {
          const cfg = categoryConfig[cat] ?? { emoji: '🛒', color: '#F5F0EB', order: 99 };
          const catId = `cat-${cat.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
          return (
            <section key={cat} id={catId} className="scroll-mt-20">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: cfg.color }}>
                  {cfg.emoji}
                </div>
                <div className="flex-1 flex items-baseline justify-between">
                  <h2 className="text-base font-bold text-[#2F2F2E]">{cat}</h2>
                  <span className="text-xs text-[#B2BEC3]">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                </div>
              </div>

              <div className="bg-white rounded-2xl divide-y divide-[#F3F0EF]" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
                {items.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)).map(product => (
                  <div key={product.id} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0" style={{ background: cfg.color }}>
                      {cfg.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[#2F2F2E] leading-snug">{product.canonical_name}</div>
                      {product.nutrition && (
                        <div className="flex gap-2 mt-0.5">
                          <span className="text-[10px] text-[#B2BEC3]">{product.nutrition.calories} kcal</span>
                          <span className="text-[10px] text-[#B2BEC3]">P {product.nutrition.protein}g</span>
                          <span className="text-[10px] text-[#B2BEC3]">C {product.nutrition.carbs}g</span>
                          <span className="text-[10px] text-[#B2BEC3]">F {product.nutrition.fat}g</span>
                        </div>
                      )}
                      <div className="text-[10px] text-[#B2BEC3] mt-0.5">{product.storeCount} store{product.storeCount !== 1 ? 's' : ''}</div>
                    </div>
                    <div className="flex-shrink-0">
                      {listUrl ? (
                        <Link href={listUrl} className="text-sm font-bold text-[#006A35] hover:underline">View →</Link>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-[#2F2F2E] blur-sm select-none">€0.00</span>
                          <svg className="w-3 h-3 text-[#B2BEC3]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </main>

      {/* Bottom CTA — logged-out only */}
      {!listUrl && (
        <section className="px-4 md:px-6 py-12" style={{ background: '#EAE7E7', borderTop: '1px solid rgba(175,173,172,0.2)' }}>
          <div className="max-w-md mx-auto text-center">
            <div className="text-3xl mb-3">🔓</div>
            <h2 className="text-xl font-bold text-[#2F2F2E] mb-2">Unlock live prices</h2>
            <p className="text-[#5c5b5b] text-sm mb-5">Free to sign up — see prices from Tesco, Dunnes, SuperValu, Lidl and Aldi. Save €20+ a week.</p>
            <Link href="/list/request"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full font-semibold transition-all text-[#004a23]"
              style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
              Get my free list
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
              </svg>
            </Link>
            <p className="text-xs mt-3" style={{ color: 'rgba(175,173,172,0.8)' }}>No card required · 2,400+ families signed up</p>
          </div>
        </section>
      )}

      <SiteFooter />
    </div>
  );
}
