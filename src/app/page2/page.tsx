"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { HomePlanner } from "@/components/HomePlanner";
import { loadSession } from "@/lib/session";

// Design System: High-Velocity Freshness / Kinetic Vitality
// Colors: primary #006A35, primary-container #6BFE9C, surface #F9F6F5
// surface-container-low #F3F0EF, surface-container-lowest #FFFFFF
// on-background #2F2F2E, tertiary-container #00DCFF
// No borders — tonal layering only. Plus Jakarta Sans throughout.

export default function Page2() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [listUrl, setListUrl] = useState<string | null>(null);
  const [showCookieBanner, setShowCookieBanner] = useState(false);

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
    <div className="min-h-screen" style={{ background: "#F9F6F5", color: "#2F2F2E", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

      {/* Cookie Banner */}
      {showCookieBanner && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-6 py-4" style={{ background: "rgba(14,14,14,0.92)", backdropFilter: "blur(24px)" }}>
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm" style={{ color: "rgba(249,246,245,0.7)" }}>
              We use cookies to improve your experience.{" "}
              <Link href="/privacy" className="underline" style={{ color: "#6BFE9C" }}>Privacy Policy</Link>
            </p>
            <button
              onClick={acceptCookies}
              className="px-6 py-2 rounded-full text-sm font-bold transition-all"
              style={{ background: "linear-gradient(135deg, #006A35, #6BFE9C)", color: "#004a23" }}
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* Glassmorphism Nav */}
      <header className="fixed top-0 left-0 right-0 z-40 px-6 py-4" style={{ background: "rgba(249,246,245,0.7)", backdropFilter: "blur(24px)" }}>
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <div className="relative w-9 h-9">
              <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <path d="M8 12C8 10.8954 8.89543 10 10 10H30C31.1046 10 32 10.8954 32 12V32C32 34.2091 30.2091 36 28 36H12C9.79086 36 8 34.2091 8 32V12Z" fill="#006A35"/>
                <path d="M14 10V8C14 5.79086 15.7909 4 18 4H22C24.2091 4 26 5.79086 26 8V10" stroke="#006A35" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M20 17L17 30" stroke="#6BFE9C" strokeWidth="4" strokeLinecap="round"/>
                <path d="M18 17C18 17 19 15 20 15C21 15 22 17 22 17" stroke="#F9F6F5" strokeWidth="2" strokeLinecap="round"/>
                <path d="M20 15V13" stroke="#F9F6F5" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-xl font-extrabold tracking-tight" style={{ color: "#2F2F2E", letterSpacing: "-0.02em" }}>
              supermarket<span style={{ color: "#006A35" }}>.ie</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {[
              { label: "Prices", href: "/shop" },
              { label: "Compare", href: "/compare/tesco-vs-dunnes-vs-supervalu" },
              { label: "Blog", href: "/blog" },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="text-sm font-semibold transition-colors" style={{ color: "#5c5b5b" }}>
                {item.label}
              </Link>
            ))}
            {listUrl ? (
              <Link href={listUrl} className="px-5 py-2 rounded-full text-sm font-bold transition-all" style={{ background: "#EAE7E7", color: "#2F2F2E" }}>
                My list
              </Link>
            ) : (
              <Link href="/list/request" className="px-5 py-2 rounded-full text-sm font-bold transition-all" style={{ background: "linear-gradient(135deg, #006A35, #6BFE9C)", color: "#004a23" }}>
                Get started free
              </Link>
            )}
          </nav>

          {/* Hamburger — mobile */}
          <button className="md:hidden flex flex-col gap-1.5 p-1" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
            <span className={`block w-5 h-0.5 transition-all duration-200 origin-center ${menuOpen ? "rotate-45 translate-y-2" : ""}`} style={{ background: "#2F2F2E" }} />
            <span className={`block w-5 h-0.5 transition-all duration-200 ${menuOpen ? "opacity-0" : ""}`} style={{ background: "#2F2F2E" }} />
            <span className={`block w-5 h-0.5 transition-all duration-200 origin-center ${menuOpen ? "-rotate-45 -translate-y-2" : ""}`} style={{ background: "#2F2F2E" }} />
          </button>
        </div>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 px-6 py-5 flex flex-col gap-4" style={{ background: "rgba(249,246,245,0.97)", backdropFilter: "blur(24px)" }}>
            <Link href="/shop" className="font-semibold text-base py-1" style={{ color: "#2F2F2E" }} onClick={() => setMenuOpen(false)}>Prices</Link>
            <Link href="/compare/tesco-vs-dunnes-vs-supervalu" className="font-semibold text-base py-1" style={{ color: "#2F2F2E" }} onClick={() => setMenuOpen(false)}>Compare</Link>
            <Link href="/blog" className="font-semibold text-base py-1" style={{ color: "#2F2F2E" }} onClick={() => setMenuOpen(false)}>Blog</Link>
            <Link href="/list/request" className="mt-1 px-5 py-3 rounded-full text-sm font-bold text-center" style={{ background: "linear-gradient(135deg, #006A35, #6BFE9C)", color: "#004a23" }} onClick={() => setMenuOpen(false)}>
              Get started free
            </Link>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="px-6 pt-36 pb-24" style={{ background: "#F9F6F5" }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">

            {/* Left: Copy */}
            <div>
              {/* Vitality chip */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold mb-8" style={{ background: "#00DCFF", color: "#004956" }}>
                <span>✦</span> Ireland&apos;s first AI grocery planner
              </div>

              <h1 className="text-5xl md:text-6xl font-extrabold leading-none mb-6" style={{ letterSpacing: "-0.02em", color: "#2F2F2E" }}>
                Tell us what<br />you&apos;re cooking.<br />
                <span style={{ color: "#006A35" }}>We&apos;ll handle<br />the rest.</span>
              </h1>

              <p className="text-lg leading-relaxed mb-8 max-w-md" style={{ color: "#5c5b5b" }}>
                Our AI builds your weekly shopping list and finds the best prices across Tesco, Dunnes and SuperValu — in seconds.
              </p>

              {/* Value props — no bullets, tonal chips */}
              <div className="flex flex-col gap-3 mb-10">
                {[
                  "Deals from Dunnes, Tesco, SuperValu, Lidl & Aldi",
                  "Save €20+ every week on your shop",
                  "Stop wasting hours comparing prices",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#6BFE9C" }}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#004a23" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="font-medium text-sm" style={{ color: "#2F2F2E" }}>{item}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <Link
                  href="/plan"
                  className="inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-bold transition-all"
                  style={{ background: "linear-gradient(135deg, #006A35, #6BFE9C)", color: "#004a23" }}
                >
                  ✨ Plan my week
                  <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                {listUrl ? (
                  <Link href={listUrl} className="inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-bold transition-all" style={{ background: "#EAE7E7", color: "#2F2F2E" }}>
                    My list
                  </Link>
                ) : (
                  <Link href="/shop" className="inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-bold transition-all" style={{ background: "#EAE7E7", color: "#2F2F2E" }}>
                    Browse prices
                  </Link>
                )}
              </div>

              <p className="mt-4 text-sm" style={{ color: "#787676" }}>
                <span className="font-bold" style={{ color: "#2F2F2E" }}>100% free</span> · No signup needed to try
              </p>
            </div>

            {/* Right: Live AI Planner — preserved exactly, reskinned container */}
            <div className="relative">
              <div className="rounded-2xl p-5 flex flex-col min-h-[400px]" style={{ background: "#FFFFFF", boxShadow: "0 24px 48px rgba(47,47,46,0.06)" }}>
                {/* Chat header */}
                <div className="flex items-center gap-3 mb-4 pb-4" style={{ borderBottom: "1px solid rgba(175,173,172,0.15)" }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-extrabold flex-shrink-0" style={{ background: "linear-gradient(135deg, #006A35, #6BFE9C)", color: "#004a23" }}>S</div>
                  <div>
                    <div className="font-bold text-sm" style={{ color: "#2F2F2E" }}>supermarket.ie AI</div>
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: "#006A35" }}>
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: "#6BFE9C" }} />
                      Online · Prices updated today
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  <HomePlanner />
                </div>
              </div>

              {/* Floating social proof badge */}
              <div className="absolute -bottom-4 -left-4 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: "#FFFFFF", boxShadow: "0 12px 32px rgba(47,47,46,0.08)" }}>
                <div className="flex -space-x-2">
                  {[["JK", "#006A35"], ["SM", "#006576"], ["PL", "#5c5b5b"]].map(([init, bg]) => (
                    <div key={init} className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold" style={{ background: bg as string, borderColor: "#FFFFFF", color: "#F9F6F5" }}>{init}</div>
                  ))}
                </div>
                <div>
                  <div className="font-extrabold text-sm" style={{ color: "#2F2F2E" }}>2,400+</div>
                  <div className="text-xs" style={{ color: "#787676" }}>Happy shoppers</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Bar — tonal shift, no border */}
      <section className="py-10 px-6" style={{ background: "#F3F0EF" }}>
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-sm font-medium mb-6" style={{ color: "#787676" }}>
            Trusted by families across Ireland · Deals from all major supermarkets
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16">
            {["Dunnes", "Tesco", "SuperValu", "Lidl", "Aldi"].map((store) => (
              <span key={store} className="text-lg font-extrabold" style={{ color: "#afadac", letterSpacing: "-0.01em" }}>{store}</span>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-24 px-6" style={{ background: "#F9F6F5" }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold mb-6" style={{ background: "#EAE7E7", color: "#5c5b5b" }}>
              HOW IT WORKS
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold" style={{ letterSpacing: "-0.02em", color: "#2F2F2E" }}>
              Three steps to<br />smarter shopping
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { num: "01", title: "Tell us about you", desc: "Household size, preferences, stores near you. Takes 30 seconds.", icon: "👤" },
              { num: "02", title: "Get your weekly list", desc: "We scan every deal and build a personalised list just for you.", icon: "📋" },
              { num: "03", title: "Shop & save", desc: "Use your list at any store. Watch the savings add up.", icon: "💰" },
            ].map((step) => (
              <div key={step.num} className="p-8 rounded-2xl" style={{ background: "#FFFFFF" }}>
                <div className="text-4xl mb-6">{step.icon}</div>
                <div className="text-xs font-extrabold mb-3" style={{ color: "#6BFE9C", letterSpacing: "0.1em" }}>{step.num}</div>
                <h3 className="text-xl font-extrabold mb-3" style={{ color: "#2F2F2E", letterSpacing: "-0.01em" }}>{step.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "#5c5b5b", lineHeight: "1.6" }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-24 px-6" style={{ background: "#F3F0EF" }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold mb-6" style={{ background: "#EAE7E7", color: "#5c5b5b" }}>
                WHY SUPERMARKET.IE
              </div>
              <h2 className="text-4xl md:text-5xl font-extrabold mb-6" style={{ letterSpacing: "-0.02em", color: "#2F2F2E" }}>
                Groceries without<br />the mental load
              </h2>
              <p className="text-lg leading-relaxed mb-12" style={{ color: "#5c5b5b", lineHeight: "1.6" }}>
                Stop spending your Sunday evening comparing flyers. We do the hard work so you can focus on what matters.
              </p>

              <div className="flex flex-col gap-8">
                {[
                  { icon: "⏱️", title: "Save 2+ hours every week", desc: "No more hunting through apps and leaflets" },
                  { icon: "💶", title: "€80–100 saved monthly", desc: "Real savings from real deals across all stores" },
                  { icon: "🧠", title: "Less decision fatigue", desc: "One smart list, zero stress" },
                ].map((benefit) => (
                  <div key={benefit.title} className="flex gap-5">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-2xl" style={{ background: "#FFFFFF" }}>
                      {benefit.icon}
                    </div>
                    <div>
                      <h3 className="font-extrabold mb-1" style={{ color: "#2F2F2E" }}>{benefit.title}</h3>
                      <p className="text-sm" style={{ color: "#5c5b5b" }}>{benefit.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats card — dark surface */}
            <div className="p-10 rounded-2xl" style={{ background: "#0E0E0E", color: "#F9F6F5" }}>
              <h3 className="text-xl font-bold mb-10" style={{ color: "rgba(249,246,245,0.7)" }}>The average Irish family spends...</h3>
              <div className="flex flex-col gap-8">
                <div>
                  <div className="text-6xl font-extrabold" style={{ color: "#6BFE9C", letterSpacing: "-0.02em" }}>€12,000</div>
                  <div className="text-sm mt-1" style={{ color: "rgba(249,246,245,0.5)" }}>per year on groceries</div>
                </div>
                <div className="h-px" style={{ background: "rgba(249,246,245,0.08)" }} />
                <div>
                  <div className="text-6xl font-extrabold" style={{ color: "#00DCFF", letterSpacing: "-0.02em" }}>€1,200+</div>
                  <div className="text-sm mt-1" style={{ color: "rgba(249,246,245,0.5)" }}>potential yearly savings with us</div>
                </div>
              </div>
              <Link
                href="#signup"
                className="mt-10 w-full flex items-center justify-center gap-2 px-6 py-4 rounded-full font-bold transition-all"
                style={{ background: "linear-gradient(135deg, #006A35, #6BFE9C)", color: "#004a23" }}
              >
                Start saving today
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="py-24 px-6" style={{ background: "#F9F6F5" }}>
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-1 mb-8">
            {[...Array(5)].map((_, i) => (
              <svg key={i} className="w-5 h-5" fill="#6BFE9C" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          <blockquote className="text-2xl md:text-3xl font-bold leading-snug mb-10" style={{ color: "#2F2F2E", letterSpacing: "-0.01em" }}>
            &ldquo;I used to spend my Sunday comparing Tesco and Dunnes prices. Now I just check the app and I&apos;m done in 5 minutes. Game changer.&rdquo;
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center font-extrabold text-lg" style={{ background: "#006A35", color: "#6BFE9C" }}>SM</div>
            <div className="text-left">
              <div className="font-extrabold" style={{ color: "#2F2F2E" }}>Sarah Murphy</div>
              <div className="text-sm" style={{ color: "#787676" }}>Mum of 3, Dublin</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA / Sign Up */}
      <section id="signup" className="py-24 px-6" style={{ background: "#F3F0EF" }}>
        <div className="max-w-lg mx-auto">
          <div className="p-10 rounded-2xl" style={{ background: "#FFFFFF", boxShadow: "0 24px 48px rgba(47,47,46,0.06)" }}>
            <div className="text-center mb-10">
              <h2 className="text-4xl font-extrabold mb-3" style={{ color: "#2F2F2E", letterSpacing: "-0.02em" }}>
                Get your free list
              </h2>
              <p className="text-sm" style={{ color: "#787676" }}>
                Join 2,400+ smart shoppers across Ireland
              </p>
            </div>

            <div className="space-y-5">
              <p className="text-sm font-bold" style={{ color: "#2F2F2E" }}>Household size</p>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { value: "1", label: "Just me", icon: "👤" },
                  { value: "2", label: "Couple", icon: "👥" },
                  { value: "3-4", label: "3–4", icon: "👨‍👩‍👧" },
                  { value: "5+", label: "5+", icon: "👨‍👩‍👧‍👦" },
                ].map((opt) => (
                  <Link
                    key={opt.value}
                    href={`/list/request?size=${opt.value}`}
                    className="p-3 rounded-2xl text-center transition-all"
                    style={{ background: "#F3F0EF", color: "#2F2F2E" }}
                  >
                    <div className="text-xl mb-1">{opt.icon}</div>
                    <div className="text-xs font-bold">{opt.label}</div>
                  </Link>
                ))}
              </div>

              <Link
                href="/list/request"
                className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-full font-bold transition-all"
                style={{ background: "linear-gradient(135deg, #006A35, #6BFE9C)", color: "#004a23" }}
              >
                Get my free list →
              </Link>

              <p className="text-center text-xs" style={{ color: "#787676" }}>
                🔒 No spam, ever. Unsubscribe anytime.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-6" style={{ background: "#0E0E0E", color: "#F9F6F5" }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-10">
            <Link href="/" className="font-extrabold text-xl" style={{ color: "#F9F6F5", letterSpacing: "-0.02em" }}>
              supermarket<span style={{ color: "#6BFE9C" }}>.ie</span>
            </Link>
            <div className="flex gap-8 text-sm" style={{ color: "rgba(249,246,245,0.5)" }}>
              <Link href="/privacy" className="transition hover:text-white">Privacy</Link>
              <Link href="/terms" className="transition hover:text-white">Terms</Link>
              <Link href="/contact" className="transition hover:text-white">Contact</Link>
            </div>
          </div>
          <div className="pt-8 text-center text-xs" style={{ color: "rgba(249,246,245,0.3)", borderTop: "1px solid rgba(249,246,245,0.06)" }}>
            © 2026 Superdata Ltd · supermarket.ie · Made with ❤️ in Ireland
          </div>
        </div>
      </footer>
    </div>
  );
}
