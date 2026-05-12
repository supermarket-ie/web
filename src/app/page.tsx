'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { HomePlanner } from '@/components/HomePlanner';
import { LiveDealChip } from '@/components/LiveDealChip';
import { loadSession } from '@/lib/session';

export default function Home() {
  const [showCookieBanner, setShowCookieBanner] = useState(false);
  const [listUrl, setListUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!localStorage.getItem('cookieConsent')) setShowCookieBanner(true);
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
              We use cookies to improve your experience.{' '}
              <Link href="/privacy" className="underline hover:opacity-80" style={{ color: 'var(--primary-container)' }}>
                Privacy Policy
              </Link>
            </p>
            <button
              onClick={() => { localStorage.setItem('cookieConsent', 'accepted'); setShowCookieBanner(false); }}
              className="btn-primary px-5 py-2 text-sm whitespace-nowrap"
            >
              Accept
            </button>
          </div>
        </div>
      )}

      <SiteHeader />

      {/* ── Hero Section: AI Planner ─────────────────────────────────────── */}
      <section className="px-6 pt-10 pb-20 md:pt-14 md:pb-28" style={{ background: 'var(--surface)' }}>
        <div className="max-w-7xl mx-auto">
          <div className="grid gap-12 items-start lg:grid-cols-[1fr_600px] md:grid-cols-1">

            {/* Left: Copy & Trust Signals */}
            <div className="lg:pr-8">
              <div className="chip-tertiary mb-6">
                🛒 Free weekly shopping lists for Irish households
              </div>

              <h1 className="type-display text-on-background mb-6">
                Plan your weekly shop{' '}
                <span style={{
                  background: 'linear-gradient(135deg, var(--primary), var(--primary-container))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text'
                }}>
                  in seconds
                </span>
              </h1>

              <div className="mb-6">
                <LiveDealChip />
              </div>

              <p className="type-body-lg mb-8 max-w-lg" style={{ color: 'var(--on-surface)' }}>
                Tell us about your household. Our AI builds your complete weekly grocery list with the best prices across Tesco, Dunnes, SuperValu & Aldi.
              </p>

              <div className="space-y-3 mb-10">
                {[
                  '✓ Takes 30 seconds — just tap a few buttons',
                  '✓ Compares Tesco, Dunnes, SuperValu & Aldi prices',
                  '✓ Finds this week\'s deals automatically'
                ].map(item => (
                  <div key={item} className="flex items-center gap-3">
                    <span className="font-medium text-sm" style={{ color: 'var(--on-background)' }}>{item}</span>
                  </div>
                ))}
              </div>

              {listUrl && (
                <Link href={listUrl} className="btn-secondary px-8 py-4 text-lg inline-flex">
                  View my list →
                </Link>
              )}
            </div>

            {/* Right: Chat Interface */}
            <div className="relative">
              <div className="rounded-2xl p-6" style={{
                background: 'var(--surface-container-lowest)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.08)',
                minHeight: '500px'
              }}>
                <HomePlanner />
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── Social Proof Bar ─────────────────────────────────────────────── */}
      <section className="py-8 px-6" style={{ background: 'var(--surface-container-low)' }}>
        <div className="max-w-6xl mx-auto">
          <p className="type-label text-center mb-4" style={{ color: 'var(--on-surface)' }}>
            Prices from Ireland's biggest supermarkets
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16">
            {['Tesco', 'Dunnes', 'SuperValu'].map(store => (
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
              { num: '01', title: 'Tell us what you\'re cooking', desc: 'Chat with our AI about your weekly meals. Takes 30 seconds.', icon: '💬', dark: false },
              { num: '02', title: 'AI builds your list', desc: 'Our AI scans every deal and builds a personalised list just for your household.', icon: '🤖', dark: true },
              { num: '03', title: 'Shop & save', desc: 'Use your list at any store. Updated every week with the latest prices.', icon: '💰', dark: false },
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
                  { icon: '⏱️', title: 'Save 2+ hours every week', desc: 'No more hunting through apps and leaflets' },
                  { icon: '💶', title: '€80–100 saved monthly', desc: 'Real savings from real deals across all stores' },
                  { icon: '🧠', title: 'Less decision fatigue', desc: 'One smart list, zero stress' },
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
              <a href="#bottom-cta" className="btn-primary mt-8 w-full px-6 py-4 text-base">
                Start planning today
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
            "I used to spend my Sunday comparing Tesco and Dunnes prices. Now I just check the app and I'm done in 5 minutes. Game changer."
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

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <section id="bottom-cta" className="py-20 px-6" style={{ background: 'var(--surface-container-low)' }}>
        <div className="max-w-xl mx-auto text-center">
          <div className="rounded-2xl p-8 md:p-10"
            style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 8px 40px rgba(0,0,0,0.07)' }}>
            <div className="mb-6">
              <h2 className="type-headline text-on-background mb-2">Start planning your shop</h2>
              <p style={{ color: 'var(--on-surface)' }}>Join 2,400+ smart Irish shoppers</p>
            </div>
            <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
               className="btn-primary w-full px-6 py-4 text-lg font-bold">
              Plan my weekly shop →
            </a>
            <p className="text-xs mt-4" style={{ color: 'var(--on-surface-variant)' }}>
              🔒 No spam, ever · Unsubscribe anytime
            </p>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}