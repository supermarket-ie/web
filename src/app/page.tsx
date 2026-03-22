"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { HomeNav } from "@/components/HomeNav";
import { HomePlanner } from "@/components/HomePlannerGreen";
import { SiteFooter } from "@/components/SiteFooter";
import { loadSession, clearSession } from "@/lib/session";

export default function Home() {
  const [showCookieBanner, setShowCookieBanner] = useState(false);
  const [listUrl, setListUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function signOut() { clearSession(); window.location.href = '/'; }

  useEffect(() => {
    if (!localStorage.getItem("cookieConsent")) setShowCookieBanner(true);
    const session = loadSession();
    if (session?.token) setListUrl(`/list?token=${session.token}`);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>

      {/* Cookie banner */}
      {showCookieBanner && (
        <div className="fixed bottom-0 left-0 right-0 p-4 z-50"
          style={{ background: 'rgba(14,14,14,0.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm" style={{ color: 'rgba(249,246,245,0.7)' }}>
              We use cookies to improve your experience.{" "}
              <Link href="/privacy" className="underline hover:opacity-80" style={{ color: 'var(--primary-container)' }}>
                Privacy Policy
              </Link>
            </p>
            <button
              onClick={() => { localStorage.setItem("cookieConsent", "accepted"); setShowCookieBanner(false); }}
              className="btn-primary px-5 py-2 text-sm whitespace-nowrap"
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* Header */}
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
            <span className="text-[22px] font-extrabold tracking-tight" style={{ color: 'var(--on-background)', letterSpacing: '-0.02em' }}>
              supermarket<span style={{ color: 'var(--primary)' }}>.ie</span>
            </span>
          </Link>

          <nav className="flex items-center gap-6">
            <Link href="/shop" className="text-sm font-medium hidden md:block transition-colors hover:text-primary" style={{ color: 'var(--on-surface)' }}>Prices</Link>
            <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="text-sm font-medium hidden md:block transition-colors hover:text-primary" style={{ color: 'var(--on-surface)' }}>Compare</Link>
            <Link href="/blog" className="text-sm font-medium hidden md:block transition-colors hover:text-primary" style={{ color: 'var(--on-surface)' }}>Blog</Link>
            <HomeNav />
            <button className="md:hidden flex flex-col gap-1.5 p-1 ml-1" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
              <span className={`block w-5 h-0.5 transition-all duration-200 origin-center ${menuOpen ? 'rotate-45 translate-y-2' : ''}`} style={{ background: 'var(--on-background)' }} />
              <span className={`block w-5 h-0.5 transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`} style={{ background: 'var(--on-background)' }} />
              <span className={`block w-5 h-0.5 transition-all duration-200 origin-center ${menuOpen ? '-rotate-45 -translate-y-2' : ''}`} style={{ background: 'var(--on-background)' }} />
            </button>
          </nav>
        </div>

        {menuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 px-6 py-4 flex flex-col gap-4 z-20 shadow-lg"
            style={{ background: 'rgba(249,246,245,0.97)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}>
            <Link href="/shop" className="font-medium text-base py-1" style={{ color: 'var(--on-background)' }} onClick={() => setMenuOpen(false)}>Prices</Link>
            <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="font-medium text-base py-1" style={{ color: 'var(--on-background)' }} onClick={() => setMenuOpen(false)}>Compare</Link>
            <Link href="/blog" className="font-medium text-base py-1" style={{ color: 'var(--on-background)' }} onClick={() => setMenuOpen(false)}>Blog</Link>
            {listUrl ? (
              <>
                <Link href={listUrl} className="btn-primary mt-1 px-4 py-3 text-sm text-center" onClick={() => setMenuOpen(false)}>
                  View my list →
                </Link>
                <button onClick={signOut} className="text-sm text-center font-medium"
                  style={{ color: 'var(--on-surface-variant)' }}>
                  Sign out
                </button>
              </>
            ) : (
              <Link href="/list/request" className="btn-primary mt-1 px-4 py-3 text-sm text-center" onClick={() => setMenuOpen(false)}>
                Get started free
              </Link>
            )}
          </div>
        )}
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="px-6 pt-10 pb-20 md:pt-14 md:pb-28" style={{ background: 'var(--surface)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid gap-12 items-start md:grid-cols-[7fr_5fr]">

            {/* Copy */}
            <div>
              <div className="chip-tertiary mb-6">
                ✨ Ireland&apos;s first AI grocery planner
              </div>

              <h1 className="type-display text-on-background mb-6">
                Tell us what you&apos;re cooking.<br />
                <span style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                  We&apos;ll handle<br />the rest.
                </span>
              </h1>

              <p className="type-body-lg mb-8 max-w-lg" style={{ color: 'var(--on-surface)' }}>
                Our AI builds your weekly shopping list and finds the best prices across Tesco, Dunnes and SuperValu — in seconds.
              </p>

              <div className="space-y-3 mb-10">
                {[
                  "Deals from Dunnes, Tesco, SuperValu, Lidl & Aldi",
                  "Save €20+ every week on your shop",
                  "Stop wasting hours comparing prices",
                ].map(item => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--primary-fixed)' }}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="var(--on-primary-container)" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="font-medium" style={{ color: 'var(--on-background)' }}>{item}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-4 items-start mb-4">
                <Link href="/plan" className="btn-primary px-8 py-4 text-lg"
                  style={{ boxShadow: '0 4px 24px rgba(0,106,53,0.25)' }}>
                  ✨ Plan my week
                  <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                {listUrl ? (
                  <Link href={listUrl} className="btn-secondary px-8 py-4 text-lg">My list</Link>
                ) : (
                  <Link href="/browse" className="btn-secondary px-8 py-4 text-lg">Browse prices</Link>
                )}
              </div>
              <p className="text-sm" style={{ color: 'var(--on-surface)' }}>
                <span className="font-semibold" style={{ color: 'var(--on-background)' }}>100% free</span> · No signup needed to try
              </p>
            </div>

            {/* AI Planner card */}
            <div className="relative">
              <div className="rounded-2xl p-5 min-h-[380px] flex flex-col" style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
                <div className="flex items-center gap-3 mb-4 pb-4" style={{ borderBottom: '1px solid var(--surface-container-low)' }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', color: 'var(--on-primary-container)' }}>
                    S
                  </div>
                  <div>
                    <div className="font-semibold text-sm" style={{ color: 'var(--on-background)' }}>supermarket.ie AI</div>
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--primary)' }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: 'var(--primary-container)' }} />
                      Online · Prices updated today
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  <HomePlanner />
                </div>
              </div>

              {/* Social proof badge */}
              <div className="absolute -bottom-4 -left-4 rounded-xl p-3"
                style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 4px 24px rgba(0,0,0,0.1)' }}>
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {[['JK', 'var(--primary)'], ['SM', 'var(--on-surface)'], ['PL', 'var(--on-primary-container)']].map(([init, bg]) => (
                      <div key={init} className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-white text-xs font-bold"
                        style={{ background: bg as string, borderColor: 'var(--surface-container-lowest)' }}>
                        {init}
                      </div>
                    ))}
                  </div>
                  <div className="text-sm">
                    <div className="font-semibold" style={{ color: 'var(--on-background)' }}>2,400+</div>
                    <div className="text-xs" style={{ color: 'var(--on-surface)' }}>Happy shoppers</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust bar ────────────────────────────────────────────────────── */}
      <section className="py-8 px-6" style={{ background: 'var(--surface-container-low)' }}>
        <div className="max-w-6xl mx-auto">
          <p className="type-label text-center mb-4" style={{ color: 'var(--on-surface)' }}>
            Trusted by Ireland&apos;s shoppers
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16">
            {["Dunnes", "Tesco", "SuperValu", "Lidl", "Aldi"].map(store => (
              <span key={store} className="text-xl font-bold" style={{ color: 'var(--on-surface-variant)' }}>{store}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 px-6" style={{ background: 'var(--surface)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-16">
            <span className="type-label inline-flex items-center px-3 py-1.5 rounded-full mb-4"
              style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
              How it works
            </span>
            <h2 className="type-headline text-on-background">
              Three steps to smarter<br />grocery shopping
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { num: "01", title: "Tell us about you",    desc: "Household size, preferences, stores near you. Takes 30 seconds.",                   icon: "👤", dark: false },
              { num: "02", title: "Get your weekly list", desc: "We scan every deal and build a personalised list just for you.",                     icon: "📋", dark: true  },
              { num: "03", title: "Shop & save",          desc: "Use your list at any store. Watch the savings add up.",                              icon: "💰", dark: false },
            ].map(step => (
              <div key={step.num} className="rounded-2xl p-8 relative overflow-hidden"
                style={step.dark
                  ? { background: 'var(--primary)', color: '#fff' }
                  : { background: 'var(--surface-container-lowest)' }
                }>
                {step.dark && (
                  <div className="absolute w-40 h-40 rounded-full top-0 right-0 translate-x-1/2 -translate-y-1/2"
                    style={{ background: 'var(--primary-container)', opacity: 0.12 }} />
                )}
                <div className="text-4xl mb-4">{step.icon}</div>
                <div className="type-label mb-2" style={{ color: step.dark ? 'var(--primary-container)' : 'var(--primary)' }}>
                  {step.num}
                </div>
                <h3 className="type-title-lg mb-2" style={{ color: step.dark ? '#fff' : 'var(--on-background)' }}>
                  {step.title}
                </h3>
                <p style={{ color: step.dark ? 'rgba(255,255,255,0.75)' : 'var(--on-surface)' }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Benefits ─────────────────────────────────────────────────────── */}
      <section className="py-20 px-6" style={{ background: 'var(--surface-container-low)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <span className="type-label inline-flex items-center px-3 py-1.5 rounded-full mb-4"
                style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
                Why supermarket.ie
              </span>
              <h2 className="type-headline text-on-background mb-6">
                Groceries without<br />the mental load
              </h2>
              <p className="type-body-lg mb-10" style={{ color: 'var(--on-surface)' }}>
                Stop spending your Sunday evening comparing flyers. We do the hard work so you can focus on what matters.
              </p>

              <div className="space-y-6">
                {[
                  { icon: "⏱️", title: "Save 2+ hours every week", desc: "No more hunting through apps and leaflets" },
                  { icon: "💶", title: "€80–100 saved monthly",    desc: "Real savings from real deals across all stores" },
                  { icon: "🧠", title: "Less decision fatigue",    desc: "One smart list, zero stress" },
                ].map(b => (
                  <div key={b.title} className="flex gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: 'var(--surface-container)' }}>
                      <span className="text-2xl">{b.icon}</span>
                    </div>
                    <div>
                      <h3 className="font-bold mb-1" style={{ color: 'var(--on-background)' }}>{b.title}</h3>
                      <p className="text-sm" style={{ color: 'var(--on-surface)' }}>{b.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats card */}
            <div className="rounded-2xl p-8" style={{ background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)' }}>
              <h3 className="type-title-lg mb-8" style={{ color: 'var(--inverse-on-surface)' }}>
                The average Irish family spends...
              </h3>
              <div className="space-y-6">
                <div>
                  <div className="price" style={{ fontSize: 'clamp(3rem, 6vw, 4rem)', color: 'var(--primary-container)' }}>€12,000</div>
                  <div style={{ color: 'rgba(249,246,245,0.5)' }}>per year on groceries</div>
                </div>
                <div className="h-px" style={{ background: 'rgba(249,246,245,0.1)' }} />
                <div>
                  <div className="price" style={{ fontSize: 'clamp(3rem, 6vw, 4rem)', color: 'var(--tertiary-container)' }}>€1,200+</div>
                  <div style={{ color: 'rgba(249,246,245,0.5)' }}>potential yearly savings with us</div>
                </div>
              </div>
              <a href="#signup" className="btn-primary mt-8 w-full px-6 py-4 text-base">
                Start saving today
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Testimonial ──────────────────────────────────────────────────── */}
      <section className="py-20 px-6" style={{ background: 'var(--surface)' }}>
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-1 mb-6">
            {[...Array(5)].map((_, i) => (
              <svg key={i} className="w-6 h-6" fill="var(--primary-container)" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          <blockquote className="text-2xl md:text-3xl font-bold leading-relaxed mb-8" style={{ color: 'var(--on-background)' }}>
            &ldquo;I used to spend my Sunday comparing Tesco and Dunnes prices. Now I just check the app and I&apos;m done in 5 minutes. Game changer.&rdquo;
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', color: 'var(--on-primary-container)' }}>
              SM
            </div>
            <div className="text-left">
              <div className="font-bold" style={{ color: 'var(--on-background)' }}>Sarah Murphy</div>
              <div style={{ color: 'var(--on-surface)' }}>Mum of 3, Dublin</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <section id="signup" className="py-20 px-6" style={{ background: 'var(--surface-container-low)' }}>
        <div className="max-w-xl mx-auto">
          <div className="rounded-2xl p-8 md:p-10 text-center"
            style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 8px 40px rgba(0,0,0,0.07)' }}>
            <h2 className="type-headline text-on-background mb-3">Get your free list</h2>
            <p className="mb-8" style={{ color: 'var(--on-surface)' }}>Join 2,400+ smart shoppers</p>
            <Link href="/list/request" className="btn-primary w-full px-6 py-4 text-lg mb-4">
              Get my free list →
            </Link>
            <p className="text-sm" style={{ color: 'var(--on-surface)' }}>
              🔒 No spam, ever. Unsubscribe anytime.
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
