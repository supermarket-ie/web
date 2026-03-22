"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { HomeNav } from "@/components/HomeNav";
import { HomePlanner } from "@/components/HomePlannerGreen";
import { loadSession } from "@/lib/session";

export default function Home() {
  const [showCookieBanner, setShowCookieBanner] = useState(false);
  const [listUrl, setListUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const cookieConsent = localStorage.getItem("cookieConsent");
    if (!cookieConsent) setShowCookieBanner(true);
    const session = loadSession();
    if (session?.token) setListUrl(`/list?token=${session.token}`);
  }, []);

  const acceptCookies = () => {
    localStorage.setItem("cookieConsent", "accepted");
    setShowCookieBanner(false);
  };

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      {/* Cookie Banner */}
      {showCookieBanner && (
        <div className="fixed bottom-0 left-0 right-0 text-white p-4 z-50 shadow-2xl" style={{ background: 'rgba(14,14,14,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-300">
              We use cookies to improve your experience.{" "}
              <Link href="/privacy" className="underline hover:text-white">Privacy Policy</Link>
            </p>
            <button
              onClick={acceptCookies}
              className="px-5 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap text-[#004a23] font-semibold"
              style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="px-6 py-4 relative z-20 sticky top-0" style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>
              <svg viewBox="0 0 24 24" fill="none" className="w-[18px] h-[18px]">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="#004a23" strokeWidth="1.5" strokeLinejoin="round"/>
                <line x1="3" y1="6" x2="21" y2="6" stroke="#004a23" strokeWidth="1.5"/>
                <path d="M16 10a4 4 0 01-8 0" stroke="#004a23" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-[22px] font-bold tracking-tight text-[#2F2F2E]">
              supermarket<span className="text-[#006A35]">.ie</span>
            </span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/shop" className="text-[#5c5b5b] hover:text-[#006A35] transition text-sm font-medium hidden md:block">
              Prices
            </Link>
            <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="text-[#5c5b5b] hover:text-[#006A35] transition text-sm font-medium hidden md:block">
              Compare
            </Link>
            <Link href="/blog" className="text-[#5c5b5b] hover:text-[#006A35] transition text-sm font-medium hidden md:block">
              Blog
            </Link>
            <HomeNav />
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
        {menuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 shadow-lg px-6 py-4 flex flex-col gap-4 z-20" style={{ background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
            <Link href="/shop" className="text-[#2F2F2E] font-medium text-base py-1" onClick={() => setMenuOpen(false)}>Prices</Link>
            <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="text-[#2F2F2E] font-medium text-base py-1" onClick={() => setMenuOpen(false)}>Compare</Link>
            <Link href="/blog" className="text-[#2F2F2E] font-medium text-base py-1" onClick={() => setMenuOpen(false)}>Blog</Link>
            <Link href="/list/request" className="mt-1 px-4 py-3 rounded-xl text-sm font-semibold text-center text-[#004a23]" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }} onClick={() => setMenuOpen(false)}>Get started free</Link>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="px-6 pt-8 pb-16 md:pt-10 md:pb-24">
        <div className="max-w-6xl mx-auto">
          <div className="grid gap-12 items-start md:grid-cols-[7fr_5fr]">
            {/* Left: Copy */}
            <div>
              {/* Cyan vitality chip */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-widest mb-6" style={{ background: '#00DCFF', color: '#004956' }}>
                ✨ Ireland&apos;s first AI grocery planner
              </div>

              <h1 className="font-extrabold text-[#2F2F2E] leading-[1.08] mb-6" style={{ fontSize: 'clamp(2.8rem, 5vw, 4rem)', fontWeight: 800, letterSpacing: '-0.03em' }}>
                Tell us what you&apos;re cooking.<br />
                <span style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>We&apos;ll handle<br />the rest.</span>
              </h1>

              <p className="text-lg md:text-xl text-[#5c5b5b] leading-relaxed mb-8 max-w-lg">
                Our AI builds your weekly shopping list and finds the best prices across Tesco, Dunnes and SuperValu — in seconds.
              </p>

              {/* Value Props */}
              <div className="space-y-3 mb-8">
                {[
                  "Deals from Dunnes, Tesco, SuperValu, Lidl & Aldi",
                  "Save €20+ every week on your shop",
                  "Stop wasting hours comparing prices",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#6BFE9C' }}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#004a23" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="text-[#2F2F2E] font-medium">{item}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-4 items-start mb-3">
                <Link
                  href="/plan"
                  className="inline-flex items-center justify-center px-8 py-4 rounded-full text-lg font-semibold transition-all hover:-translate-y-0.5 text-[#004a23]"
                  style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)', boxShadow: '0 4px 20px rgba(0,106,53,0.25)' }}
                >
                  ✨ Plan my week
                  <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                {listUrl ? (
                  <Link
                    href={listUrl}
                    className="inline-flex items-center justify-center px-8 py-4 rounded-full text-lg font-semibold transition-all text-[#2F2F2E]"
                    style={{ background: '#EAE7E7' }}
                  >
                    My list
                  </Link>
                ) : (
                  <Link
                    href="/browse"
                    className="inline-flex items-center justify-center px-8 py-4 rounded-full text-lg font-semibold transition-all text-[#2F2F2E]"
                    style={{ background: '#EAE7E7' }}
                  >
                    Browse prices
                  </Link>
                )}
              </div>
              <div className="text-sm text-[#5c5b5b] mb-10">
                <span className="font-semibold text-[#2F2F2E]">100% free</span> · No signup needed to try
              </div>

            </div>

            {/* Right: HomePlanner */}
            <div className="relative">
              <div className="bg-white rounded-2xl shadow-xl p-5 min-h-[380px] flex flex-col" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
                <div className="flex items-center gap-3 mb-4 pb-4" style={{ borderBottom: '1px solid #F3F0EF' }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[#004a23] text-sm font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>S</div>
                  <div>
                    <div className="font-semibold text-[#2F2F2E] text-sm">supermarket.ie AI</div>
                    <div className="flex items-center gap-1.5 text-xs text-[#006A35]">
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: '#6BFE9C' }}/>
                      Online · Prices updated today
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  <HomePlanner />
                </div>
              </div>

              {/* Floating badge */}
              <div className="absolute -bottom-4 -left-4 bg-white rounded-xl shadow-lg p-3" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    <div className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-bold" style={{ background: '#006A35' }}>JK</div>
                    <div className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-bold" style={{ background: '#5c5b5b' }}>SM</div>
                    <div className="w-8 h-8 rounded-full border-2 border-white flex items-center justify-center text-white text-xs font-bold" style={{ background: '#004a23' }}>PL</div>
                  </div>
                  <div className="text-sm">
                    <div className="font-semibold text-[#2F2F2E]">2,400+</div>
                    <div className="text-[#5c5b5b] text-xs">Happy shoppers</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="py-8 px-6" style={{ background: '#F3F0EF' }}>
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-[#5c5b5b] text-xs font-bold uppercase tracking-widest mb-4">
            Trusted by Ireland&apos;s shoppers
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16">
            {["Dunnes", "Tesco", "SuperValu", "Lidl", "Aldi"].map((store) => (
              <span key={store} className="text-xl font-bold" style={{ color: 'rgba(175,173,172,0.8)' }}>{store}</span>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="py-20 px-6" style={{ background: '#F9F6F5' }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-16">
            <div className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4" style={{ background: '#EAE7E7', color: '#5c5b5b' }}>
              How it works
            </div>
            <h2 className="font-extrabold text-[#2F2F2E]" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 800, letterSpacing: '-0.02em' }}>
              Three steps to smarter<br />grocery shopping
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                num: "01",
                title: "Tell us about you",
                desc: "Household size, preferences, stores near you. Takes 30 seconds.",
                icon: "👤",
                dark: false,
              },
              {
                num: "02",
                title: "Get your weekly list",
                desc: "We scan every deal and build a personalised list just for you.",
                icon: "📋",
                dark: true,
              },
              {
                num: "03",
                title: "Shop & save",
                desc: "Use your list at any store. Watch the savings add up.",
                icon: "💰",
                dark: false,
              },
            ].map((step) => (
              <div
                key={step.num}
                className="rounded-2xl p-8 relative overflow-hidden"
                style={step.dark
                  ? { background: '#006A35', color: '#fff' }
                  : { background: '#fff', border: '1px solid rgba(175,173,172,0.2)' }
                }
              >
                {step.dark && (
                  <div className="absolute w-40 h-40 rounded-full top-0 right-0 translate-x-1/2 -translate-y-1/2" style={{ background: '#6BFE9C', opacity: 0.1 }} />
                )}
                <div className="text-4xl mb-4">{step.icon}</div>
                <div className="text-sm font-bold mb-2" style={{ color: step.dark ? '#6BFE9C' : '#006A35' }}>{step.num}</div>
                <h3 className="text-xl font-bold mb-2" style={{ color: step.dark ? '#fff' : '#2F2F2E' }}>{step.title}</h3>
                <p style={{ color: step.dark ? 'rgba(255,255,255,0.75)' : '#5c5b5b' }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 px-6" style={{ background: '#F3F0EF' }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4" style={{ background: '#EAE7E7', color: '#5c5b5b' }}>
                Why supermarket.ie
              </div>
              <h2 className="font-extrabold text-[#2F2F2E] mb-6" style={{ fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 800, letterSpacing: '-0.02em' }}>
                Groceries without<br />the mental load
              </h2>
              <p className="text-[#5c5b5b] text-lg mb-8">
                Stop spending your Sunday evening comparing flyers. We do the hard work so you can focus on what matters.
              </p>

              <div className="space-y-6">
                {[
                  {
                    icon: "⏱️",
                    title: "Save 2+ hours every week",
                    desc: "No more hunting through apps and leaflets",
                  },
                  {
                    icon: "💶",
                    title: "€80-100 saved monthly",
                    desc: "Real savings from real deals across all stores",
                  },
                  {
                    icon: "🧠",
                    title: "Less decision fatigue",
                    desc: "One smart list, zero stress",
                  },
                ].map((benefit) => (
                  <div key={benefit.title} className="flex gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#EAE7E7' }}>
                      <span className="text-2xl">{benefit.icon}</span>
                    </div>
                    <div>
                      <h3 className="font-bold text-[#2F2F2E] mb-1">{benefit.title}</h3>
                      <p className="text-[#5c5b5b] text-sm">{benefit.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats Card */}
            <div className="rounded-2xl p-8 text-white" style={{ background: '#0E0E0E' }}>
              <h3 className="text-xl font-bold mb-8">The average Irish family spends...</h3>
              <div className="space-y-6">
                <div>
                  <div className="font-extrabold" style={{ fontSize: 'clamp(3rem, 6vw, 4rem)', color: '#6BFE9C', letterSpacing: '-0.03em' }}>€12,000</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)' }}>per year on groceries</div>
                </div>
                <div className="h-px" style={{ background: 'rgba(255,255,255,0.1)' }}></div>
                <div>
                  <div className="font-extrabold" style={{ fontSize: 'clamp(3rem, 6vw, 4rem)', color: '#00DCFF', letterSpacing: '-0.03em' }}>€1,200+</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)' }}>potential yearly savings with us</div>
                </div>
              </div>
              <a
                href="#signup"
                className="mt-8 w-full px-6 py-4 rounded-full font-semibold flex items-center justify-center gap-2 text-[#004a23]"
                style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
              >
                Start saving today
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="py-20 px-6" style={{ background: '#F3F0EF' }}>
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-1 mb-6">
            {[...Array(5)].map((_, i) => (
              <svg key={i} className="w-6 h-6" fill="#6BFE9C" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          <blockquote className="text-2xl md:text-3xl font-bold text-[#2F2F2E] leading-relaxed mb-8">
            &ldquo;I used to spend my Sunday comparing Tesco and Dunnes prices. Now I just check the app and I&apos;m done in 5 minutes. Game changer.&rdquo;
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-[#004a23] font-bold text-lg" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}>SM</div>
            <div className="text-left">
              <div className="font-bold text-[#2F2F2E]">Sarah Murphy</div>
              <div className="text-[#5c5b5b]">Mum of 3, Dublin</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA / Sign Up */}
      <section id="signup" className="py-20 px-6" style={{ background: '#F9F6F5' }}>
        <div className="max-w-xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-8 md:p-10" style={{ border: '1px solid rgba(175,173,172,0.2)' }}>
            <div className="text-center mb-8">
              <h2 className="text-3xl md:text-4xl font-extrabold text-[#2F2F2E] mb-3" style={{ letterSpacing: '-0.02em' }}>
                Get your free list
              </h2>
              <p className="text-[#5c5b5b]">
                Join 2,400+ smart shoppers
              </p>
            </div>
            <div className="space-y-5">
              <Link
                href="/list/request"
                className="w-full block text-center px-6 py-4 rounded-full text-lg font-semibold transition-all text-[#004a23]"
                style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
              >
                Get my free list →
              </Link>
              <p className="text-center text-sm text-[#5c5b5b]">
                🔒 No spam, ever. Unsubscribe anytime.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 text-white" style={{ background: '#0E0E0E' }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
            <Link href="/" className="font-bold text-xl">
              supermarket<span style={{ color: '#6BFE9C' }}>.ie</span>
            </Link>
            <div className="flex gap-6 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              <Link href="/privacy" className="hover:text-white transition">Privacy</Link>
              <Link href="/terms" className="hover:text-white transition">Terms</Link>
              <Link href="/contact" className="hover:text-white transition">Contact</Link>
            </div>
          </div>
          <div className="pt-8 text-center text-sm" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)' }}>
            © 2026 Superdata Ltd · supermarket.ie · Made with ❤️ in Ireland
          </div>
        </div>
      </footer>
    </div>
  );
}
