"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { HomePlanner } from "@/components/HomePlanner";
import { loadSession } from "@/lib/session";

/*
 * Design System: Kinetic Vitality
 * Palette (STRICT — no orange, no coral, no warm red):
 *   primary:                  #006A35
 *   primary-container:        #6BFE9C
 *   on-primary-container:     #004a23
 *   surface:                  #F9F6F5
 *   surface-container-low:    #F3F0EF
 *   surface-container:        #EAE7E7
 *   surface-container-lowest: #FFFFFF
 *   on-background:            #2F2F2E
 *   on-surface-variant:       #5c5b5b
 *   outline-variant:          #afadac (ghost borders at 15% only)
 *   tertiary-container:       #00DCFF
 *   on-tertiary-container:    #004956
 *   inverse-surface:          #0E0E0E
 */

const PRICE_DATA = [
  {
    store: "Tesco",
    items: [
      { name: "Chicken breast (500g)", price: 4.49 },
      { name: "Semi-skimmed milk (2L)", price: 1.89 },
      { name: "Sliced pan", price: 1.39 },
      { name: "Butter (227g)", price: 2.49 },
    ],
    badge: null,
  },
  {
    store: "Dunnes",
    items: [
      { name: "Chicken breast (500g)", price: 4.29 },
      { name: "Semi-skimmed milk (2L)", price: 1.75 },
      { name: "Sliced pan", price: 1.29 },
      { name: "Butter (227g)", price: 2.39 },
    ],
    badge: "BEST VALUE",
  },
  {
    store: "SuperValu",
    items: [
      { name: "Chicken breast (500g)", price: 4.69 },
      { name: "Semi-skimmed milk (2L)", price: 1.95 },
      { name: "Sliced pan", price: 1.49 },
      { name: "Butter (227g)", price: 2.59 },
    ],
    badge: null,
  },
];

export default function Page2() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [listUrl, setListUrl] = useState<string | null>(null);
  const [showCookieBanner, setShowCookieBanner] = useState(false);
  const [activeStore, setActiveStore] = useState(1); // Dunnes is best value

  useEffect(() => {
    const cookieConsent = localStorage.getItem("cookieConsent");
    if (!cookieConsent) setShowCookieBanner(true);
    const session = loadSession();
    if (session?.token) setListUrl(`/list?token=${session.token}`);
  }, []);

  const getTotal = (idx: number) =>
    PRICE_DATA[idx].items.reduce((s, i) => s + i.price, 0).toFixed(2);

  return (
    <div
      style={{
        background: "#F9F6F5",
        color: "#2F2F2E",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        minHeight: "100vh",
      }}
    >
      {/* ── Cookie Banner ── */}
      {showCookieBanner && (
        <div
          className="fixed bottom-0 left-0 right-0 z-50 px-6 py-4"
          style={{
            background: "rgba(14,14,14,0.92)",
            backdropFilter: "blur(24px)",
          }}
        >
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm" style={{ color: "rgba(249,246,245,0.6)" }}>
              We use cookies to improve your experience.{" "}
              <Link
                href="/privacy"
                style={{ color: "#6BFE9C", textDecoration: "underline" }}
              >
                Privacy Policy
              </Link>
            </p>
            <button
              onClick={() => {
                localStorage.setItem("cookieConsent", "accepted");
                setShowCookieBanner(false);
              }}
              className="px-6 py-2 rounded-full text-sm font-bold"
              style={{
                background: "linear-gradient(135deg, #006A35, #6BFE9C)",
                color: "#004a23",
              }}
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* ── Glassmorphism Nav — MUST be white/distinct from page bg ── */}
      <header
        className="fixed top-0 left-0 right-0 z-40 px-6 py-4"
        style={{
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: "1px solid rgba(175,173,172,0.12)",
        }}
      >
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #006A35, #6BFE9C)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5 w-[18px] h-[18px]">
                <path
                  d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"
                  stroke="#004a23"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <line x1="3" y1="6" x2="21" y2="6" stroke="#004a23" strokeWidth="1.5" />
                <path
                  d="M16 10a4 4 0 01-8 0"
                  stroke="#004a23"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <span
              className="text-xl font-extrabold"
              style={{ color: "#2F2F2E", letterSpacing: "-0.02em" }}
            >
              supermarket<span style={{ color: "#006A35" }}>.ie</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {[
              { label: "Prices", href: "/shop" },
              { label: "Compare", href: "/compare/supermarket-prices-ireland" },
              { label: "Blog", href: "/blog" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-semibold transition-colors"
                style={{ color: "#5c5b5b" }}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href={listUrl ?? "/list/request"}
              className="px-5 py-2.5 rounded-full text-sm font-bold transition-all"
              style={{
                background: "linear-gradient(135deg, #006A35, #6BFE9C)",
                color: "#004a23",
              }}
            >
              {listUrl ? "My list" : "Get started free"}
            </Link>
          </nav>

          {/* Hamburger */}
          <button
            className="md:hidden p-1 flex flex-col gap-1.5"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Menu"
          >
            {[
              menuOpen ? "rotate-45 translate-y-2" : "",
              menuOpen ? "opacity-0" : "",
              menuOpen ? "-rotate-45 -translate-y-2" : "",
            ].map((cls, i) => (
              <span
                key={i}
                className={`block w-5 h-0.5 transition-all duration-200 origin-center ${cls}`}
                style={{ background: "#2F2F2E" }}
              />
            ))}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div
            className="md:hidden absolute top-full left-0 right-0 px-6 py-5 flex flex-col gap-4"
            style={{
              background: "rgba(255,255,255,0.97)",
              backdropFilter: "blur(24px)",
            }}
          >
            {[
              ["Prices", "/shop"],
              ["Compare", "/compare/supermarket-prices-ireland"],
              ["Blog", "/blog"],
            ].map(([l, h]) => (
              <Link
                key={h}
                href={h}
                className="font-semibold text-base py-1"
                style={{ color: "#2F2F2E" }}
                onClick={() => setMenuOpen(false)}
              >
                {l}
              </Link>
            ))}
            <Link
              href="/list/request"
              className="mt-1 px-5 py-3 rounded-full text-sm font-bold text-center"
              style={{
                background: "linear-gradient(135deg, #006A35, #6BFE9C)",
                color: "#004a23",
              }}
              onClick={() => setMenuOpen(false)}
            >
              Get started free
            </Link>
          </div>
        )}
      </header>

      {/* ════════════════════════════════════════════
          HERO — Asymmetric 12-col bento grid
      ════════════════════════════════════════════ */}
      <section
        className="px-6 pt-32 pb-20"
        style={{ background: "#F9F6F5" }}
      >
        <div className="max-w-6xl mx-auto">
          <div
            className="grid gap-8 items-start"
            style={{
              gridTemplateColumns: "7fr 5fr",
            }}
          >
            {/* ── Left col (7) ── */}
            <div className="flex flex-col gap-8">
              {/* Headline block */}
              <div>
                {/* Vitality chips */}
                <div className="flex flex-wrap gap-2 mb-7">
                  {[
                    "✦ Ireland's first AI grocery planner",
                    "Live prices updated daily",
                    "100% free",
                  ].map((chip) => (
                    <span
                      key={chip}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold uppercase tracking-wider"
                      style={{ background: "#00DCFF", color: "#004956" }}
                    >
                      {chip}
                    </span>
                  ))}
                </div>

                <h1
                  className="font-extrabold leading-none mb-5"
                  style={{
                    fontSize: "clamp(2.8rem, 4.5vw, 4.5rem)",
                    letterSpacing: "-0.03em",
                    color: "#2F2F2E",
                  }}
                >
                  Tell us what<br />
                  you&apos;re cooking.
                </h1>
                <p
                  className="font-extrabold leading-none mb-7"
                  style={{
                    fontSize: "clamp(2.8rem, 4.5vw, 4.5rem)",
                    letterSpacing: "-0.03em",
                    color: "#006A35",
                  }}
                >
                  We&apos;ll handle<br />the rest.
                </p>

                <p
                  className="text-lg max-w-lg"
                  style={{ color: "#5c5b5b", lineHeight: 1.6 }}
                >
                  Our AI builds your weekly shopping list and finds the best
                  prices across Tesco, Dunnes and SuperValu — in seconds.
                </p>
              </div>

              {/* CTA row */}
              <div className="flex flex-col sm:flex-row gap-3 items-start">
                <Link
                  href="/plan"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full font-bold text-sm transition-all"
                  style={{
                    background: "linear-gradient(135deg, #006A35, #6BFE9C)",
                    color: "#004a23",
                    fontSize: "0.9375rem",
                  }}
                >
                  ✨ Plan my week
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 7l5 5m0 0l-5 5m5-5H6"
                    />
                  </svg>
                </Link>
                <Link
                  href={listUrl ?? "/shop"}
                  className="inline-flex items-center justify-center px-7 py-3.5 rounded-full font-bold text-sm transition-all"
                  style={{
                    background: "#EAE7E7",
                    color: "#2F2F2E",
                    fontSize: "0.9375rem",
                  }}
                >
                  {listUrl ? "My list" : "Browse prices"}
                </Link>
              </div>

              {/* ── Price comparison dark card ── */}
              <div
                className="rounded-2xl p-6"
                style={{ background: "#0E0E0E" }}
              >
                <div className="flex items-center justify-between mb-5">
                  <span
                    className="text-xs font-extrabold uppercase tracking-widest"
                    style={{ color: "rgba(249,246,245,0.4)" }}
                  >
                    Live Price Comparison
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
                    style={{ background: "rgba(107,254,156,0.12)", color: "#6BFE9C" }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full animate-pulse inline-block"
                      style={{ background: "#6BFE9C" }}
                    />
                    Updated today
                  </span>
                </div>

                {/* Store tabs */}
                <div className="flex gap-2 mb-5">
                  {PRICE_DATA.map((s, i) => (
                    <button
                      key={s.store}
                      onClick={() => setActiveStore(i)}
                      className="px-3 py-1.5 rounded-full text-xs font-bold transition-all"
                      style={{
                        background:
                          activeStore === i
                            ? s.badge
                              ? "#6BFE9C"
                              : "rgba(249,246,245,0.12)"
                            : "rgba(249,246,245,0.06)",
                        color:
                          activeStore === i
                            ? s.badge
                              ? "#004a23"
                              : "#F9F6F5"
                            : "rgba(249,246,245,0.4)",
                      }}
                    >
                      {s.store}
                      {s.badge && (
                        <span
                          className="ml-1.5 text-[10px]"
                          style={{ color: activeStore === i ? "#004a23" : "#6BFE9C" }}
                        >
                          ★
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Item rows */}
                <div className="flex flex-col gap-3">
                  {PRICE_DATA[activeStore].items.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between"
                    >
                      <span
                        className="text-sm"
                        style={{ color: "rgba(249,246,245,0.55)" }}
                      >
                        {item.name}
                      </span>
                      <span
                        className="font-extrabold text-sm"
                        style={{ color: "#F9F6F5" }}
                      >
                        €{item.price.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Divider */}
                <div
                  className="my-4"
                  style={{ height: 1, background: "rgba(249,246,245,0.08)" }}
                />

                {/* Total row */}
                <div className="flex items-center justify-between">
                  <span
                    className="text-sm font-bold"
                    style={{ color: "rgba(249,246,245,0.4)" }}
                  >
                    Basket total
                  </span>
                  <div className="flex items-center gap-2">
                    {PRICE_DATA[activeStore].badge && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider"
                        style={{ background: "#6BFE9C", color: "#004a23" }}
                      >
                        BEST VALUE
                      </span>
                    )}
                    <span
                      className="font-extrabold text-lg"
                      style={{
                        color: PRICE_DATA[activeStore].badge
                          ? "#6BFE9C"
                          : "#F9F6F5",
                        letterSpacing: "-0.02em",
                      }}
                    >
                      €{getTotal(activeStore)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right col (5) — AI Planner widget ── */}
            <div className="relative hidden md:block">
              <div
                className="rounded-2xl flex flex-col overflow-hidden"
                style={{
                  background: "#FFFFFF",
                  minHeight: 540,
                  boxShadow: "0 32px 72px rgba(0,106,53,0.1)",
                }}
              >
                {/* Widget header */}
                <div
                  className="flex items-center gap-3 px-5 py-4"
                  style={{
                    background: "linear-gradient(135deg, #006A35, #004a23)",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-sm flex-shrink-0"
                    style={{ background: "#6BFE9C", color: "#004a23" }}
                  >
                    S
                  </div>
                  <div>
                    <div
                      className="font-bold text-sm"
                      style={{ color: "#F9F6F5" }}
                    >
                      supermarket.ie AI
                    </div>
                    <div
                      className="flex items-center gap-1.5 text-xs"
                      style={{ color: "rgba(249,246,245,0.6)" }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full animate-pulse inline-block"
                        style={{ background: "#6BFE9C" }}
                      />
                      Online · Prices updated today
                    </div>
                  </div>
                </div>

                {/* Chat area */}
                <div className="flex-1 p-5">
                  <HomePlanner />
                </div>
              </div>

              {/* Social proof badge — anchored bottom-left */}
              <div
                className="absolute -bottom-5 -left-5 rounded-2xl px-4 py-3 flex items-center gap-3"
                style={{
                  background: "#FFFFFF",
                  boxShadow: "0 12px 32px rgba(47,47,46,0.10)",
                }}
              >
                <div className="flex -space-x-2">
                  {(
                    [
                      ["JK", "#006A35"],
                      ["SM", "#006576"],
                      ["PL", "#5c5b5b"],
                    ] as const
                  ).map(([init, bg]) => (
                    <div
                      key={init}
                      className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-extrabold"
                      style={{
                        background: bg,
                        borderColor: "#FFFFFF",
                        color: "#F9F6F5",
                      }}
                    >
                      {init}
                    </div>
                  ))}
                </div>
                <div>
                  <div
                    className="font-extrabold text-sm"
                    style={{ color: "#2F2F2E" }}
                  >
                    2,400+
                  </div>
                  <div className="text-xs" style={{ color: "#787676" }}>
                    Happy shoppers
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Mobile: HomePlanner below the left col */}
          <div className="md:hidden mt-8 relative">
            <div
              className="rounded-2xl flex flex-col overflow-hidden"
              style={{ background: "#FFFFFF", boxShadow: "0 24px 56px rgba(0,106,53,0.08)" }}
            >
              <div
                className="flex items-center gap-3 px-5 py-4"
                style={{ background: "linear-gradient(135deg, #006A35, #004a23)" }}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center font-extrabold text-sm"
                  style={{ background: "#6BFE9C", color: "#004a23" }}
                >
                  S
                </div>
                <div>
                  <div className="font-bold text-sm" style={{ color: "#F9F6F5" }}>
                    supermarket.ie AI
                  </div>
                  <div
                    className="flex items-center gap-1.5 text-xs"
                    style={{ color: "rgba(249,246,245,0.6)" }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full animate-pulse inline-block"
                      style={{ background: "#6BFE9C" }}
                    />
                    Online · Prices updated today
                  </div>
                </div>
              </div>
              <div className="p-5">
                <HomePlanner />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════
          TRUST BAR
      ════════════════════════════════════════════ */}
      <section className="py-10 px-6" style={{ background: "#F3F0EF" }}>
        <div className="max-w-6xl mx-auto">
          <p
            className="text-center text-xs font-bold mb-6 uppercase tracking-widest"
            style={{ color: "#afadac" }}
          >
            Trusted by families across Ireland
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16">
            {["Dunnes", "Tesco", "SuperValu", "Lidl", "Aldi"].map((store) => (
              <span
                key={store}
                className="text-base font-extrabold"
                style={{ color: "#afadac", letterSpacing: "-0.01em" }}
              >
                {store}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════
          HOW IT WORKS — #F3F0EF bg, white cards,
          middle card breaks to #006A35
      ════════════════════════════════════════════ */}
      <section className="py-24 px-6" style={{ background: "#F3F0EF" }}>
        <div className="max-w-6xl mx-auto">
          <div className="mb-14">
            <span
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-extrabold uppercase tracking-widest mb-6"
              style={{ background: "#EAE7E7", color: "#5c5b5b" }}
            >
              How it works
            </span>
            <h2
              className="font-extrabold"
              style={{
                fontSize: "clamp(2rem, 4vw, 3rem)",
                letterSpacing: "-0.02em",
                color: "#2F2F2E",
              }}
            >
              Three steps to<br />smarter shopping
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                num: "01",
                title: "Tell us about you",
                desc: "Household size, preferences, stores near you. Takes 30 seconds.",
                icon: (
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                ),
                dark: false,
              },
              {
                num: "02",
                title: "Get your weekly list",
                desc: "We scan every deal and build a personalised list just for you.",
                icon: (
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                  </svg>
                ),
                dark: true,
              },
              {
                num: "03",
                title: "Shop & save",
                desc: "Use your list at any store. Watch the savings add up week after week.",
                icon: (
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                  </svg>
                ),
                dark: false,
              },
            ].map((step, i) => (
              <div
                key={step.num}
                className="p-8 rounded-2xl relative overflow-hidden"
                style={{ background: step.dark ? "#006A35" : "#FFFFFF" }}
              >
                {step.dark && (
                  <div
                    className="absolute top-0 right-0 w-40 h-40 rounded-full opacity-15 pointer-events-none"
                    style={{
                      background: "#6BFE9C",
                      transform: "translate(35%, -35%)",
                    }}
                  />
                )}
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center mb-6"
                  style={{
                    background: step.dark
                      ? "rgba(107,254,156,0.15)"
                      : "#F3F0EF",
                    color: step.dark ? "#6BFE9C" : "#006A35",
                  }}
                >
                  {step.icon}
                </div>
                <div
                  className="text-xs font-extrabold mb-3 uppercase tracking-widest"
                  style={{ color: step.dark ? "#6BFE9C" : "#00DCFF" }}
                >
                  {step.num}
                </div>
                <h3
                  className="text-xl font-extrabold mb-3"
                  style={{
                    color: step.dark ? "#F9F6F5" : "#2F2F2E",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {step.title}
                </h3>
                <p
                  className="text-sm"
                  style={{
                    color: step.dark ? "rgba(249,246,245,0.65)" : "#5c5b5b",
                    lineHeight: 1.65,
                  }}
                >
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════
          BENEFITS — #F9F6F5, dark inverse card right
      ════════════════════════════════════════════ */}
      <section className="py-24 px-6" style={{ background: "#F9F6F5" }}>
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-14 items-center">
            {/* Left: editorial + benefit rows */}
            <div>
              <span
                className="inline-flex items-center px-4 py-2 rounded-full text-xs font-extrabold uppercase tracking-widest mb-6"
                style={{ background: "#EAE7E7", color: "#5c5b5b" }}
              >
                Why supermarket.ie
              </span>
              <h2
                className="font-extrabold mb-6"
                style={{
                  fontSize: "clamp(2rem, 4vw, 3rem)",
                  letterSpacing: "-0.02em",
                  color: "#2F2F2E",
                }}
              >
                Groceries without<br />the mental load
              </h2>
              <p
                className="text-lg mb-12"
                style={{ color: "#5c5b5b", lineHeight: 1.6 }}
              >
                Stop spending your Sunday evening comparing flyers. We do the
                hard work so you can focus on what matters.
              </p>

              <div className="flex flex-col gap-7">
                {[
                  {
                    title: "Save 2+ hours every week",
                    desc: "No more hunting through apps and leaflets",
                    icon: (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ),
                  },
                  {
                    title: "€80–100 saved monthly",
                    desc: "Real savings from real deals across all stores",
                    icon: (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 7.756a4.5 4.5 0 100 8.488M7.5 10.5h5.25m-5.25 3h5.25M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ),
                  },
                  {
                    title: "Less decision fatigue",
                    desc: "One smart list, zero stress",
                    icon: (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                    ),
                  },
                ].map((b) => (
                  <div key={b.title} className="flex gap-4 items-start">
                    <div
                      className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                      style={{ background: "#F3F0EF", color: "#006A35" }}
                    >
                      {b.icon}
                    </div>
                    <div>
                      <h3
                        className="font-extrabold mb-1"
                        style={{ color: "#2F2F2E" }}
                      >
                        {b.title}
                      </h3>
                      <p className="text-sm" style={{ color: "#5c5b5b" }}>
                        {b.desc}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: dramatic dark stats card */}
            <div className="p-10 rounded-2xl" style={{ background: "#0E0E0E" }}>
              <h3
                className="font-semibold mb-10 text-sm"
                style={{ color: "rgba(249,246,245,0.4)" }}
              >
                The average Irish family spends...
              </h3>
              <div className="flex flex-col gap-8">
                <div>
                  <div
                    className="font-extrabold"
                    style={{
                      fontSize: "clamp(3rem, 5vw, 4.5rem)",
                      color: "#6BFE9C",
                      letterSpacing: "-0.04em",
                      lineHeight: 1,
                    }}
                  >
                    €12,000
                  </div>
                  <div
                    className="text-sm mt-2"
                    style={{ color: "rgba(249,246,245,0.35)" }}
                  >
                    per year on groceries
                  </div>
                </div>
                <div
                  style={{ height: 1, background: "rgba(249,246,245,0.07)" }}
                />
                <div>
                  <div
                    className="font-extrabold"
                    style={{
                      fontSize: "clamp(3rem, 5vw, 4.5rem)",
                      color: "#00DCFF",
                      letterSpacing: "-0.04em",
                      lineHeight: 1,
                    }}
                  >
                    €1,200+
                  </div>
                  <div
                    className="text-sm mt-2"
                    style={{ color: "rgba(249,246,245,0.35)" }}
                  >
                    potential yearly savings with us
                  </div>
                </div>
              </div>
              <Link
                href="#signup"
                className="mt-10 w-full flex items-center justify-center gap-2 px-6 py-4 rounded-full font-bold transition-all"
                style={{
                  background: "linear-gradient(135deg, #006A35, #6BFE9C)",
                  color: "#004a23",
                }}
              >
                Start saving today
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════
          SOCIAL PROOF — #F3F0EF, large quote
      ════════════════════════════════════════════ */}
      <section className="py-24 px-6" style={{ background: "#F3F0EF" }}>
        <div className="max-w-3xl mx-auto text-center">
          {/* Stars */}
          <div className="inline-flex items-center gap-1 mb-8">
            {[...Array(5)].map((_, i) => (
              <svg key={i} className="w-6 h-6" fill="#6BFE9C" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>

          <blockquote
            className="font-bold mb-10"
            style={{
              fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
              color: "#2F2F2E",
              letterSpacing: "-0.02em",
              lineHeight: 1.25,
            }}
          >
            &ldquo;I used to spend my Sunday comparing Tesco and Dunnes
            prices. Now I just check the app and I&apos;m done in 5
            minutes. Game changer.&rdquo;
          </blockquote>

          <div className="flex items-center justify-center gap-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center font-extrabold text-lg"
              style={{ background: "#006A35", color: "#6BFE9C" }}
            >
              SM
            </div>
            <div className="text-left">
              <div className="font-extrabold" style={{ color: "#2F2F2E" }}>
                Sarah Murphy
              </div>
              <div className="text-sm" style={{ color: "#787676" }}>
                Mum of 3, Dublin
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════
          SIGN UP CTA — #F9F6F5, white elevated card,
          household size tiles
      ════════════════════════════════════════════ */}
      <section
        id="signup"
        className="py-24 px-6"
        style={{ background: "#F9F6F5" }}
      >
        <div className="max-w-lg mx-auto">
          <div
            className="p-10 rounded-2xl"
            style={{
              background: "#FFFFFF",
              boxShadow: "0 24px 64px rgba(0,106,53,0.07)",
            }}
          >
            <div className="text-center mb-10">
              <h2
                className="font-extrabold mb-3"
                style={{
                  fontSize: "clamp(2rem, 4vw, 2.8rem)",
                  color: "#2F2F2E",
                  letterSpacing: "-0.02em",
                }}
              >
                Get your free list
              </h2>
              <p className="text-sm" style={{ color: "#787676" }}>
                Join 2,400+ smart shoppers across Ireland
              </p>
            </div>

            <p
              className="text-sm font-extrabold mb-4"
              style={{ color: "#2F2F2E" }}
            >
              Household size
            </p>

            <div className="grid grid-cols-4 gap-3 mb-8">
              {[
                { value: "1", label: "Just me", icon: "👤" },
                { value: "2", label: "Couple", icon: "👥" },
                { value: "3-4", label: "3–4", icon: "👨‍👩‍👧" },
                { value: "5+", label: "5+", icon: "👨‍👩‍👧‍👦" },
              ].map((opt) => (
                <Link
                  key={opt.value}
                  href={`/list/request?size=${opt.value}`}
                  className="p-3 rounded-2xl text-center transition-all hover:scale-105"
                  style={{ background: "#EAE7E7", color: "#2F2F2E" }}
                >
                  <div className="text-2xl mb-1">{opt.icon}</div>
                  <div className="text-xs font-bold">{opt.label}</div>
                </Link>
              ))}
            </div>

            <Link
              href="/list/request"
              className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-full font-bold text-base transition-all"
              style={{
                background: "linear-gradient(135deg, #006A35, #6BFE9C)",
                color: "#004a23",
              }}
            >
              Get my free list →
            </Link>

            <p
              className="text-center text-xs mt-4"
              style={{ color: "#afadac" }}
            >
              🔒 No spam, ever. Unsubscribe anytime.
            </p>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════
          FOOTER — #0E0E0E, .ie accent in #6BFE9C
      ════════════════════════════════════════════ */}
      <footer className="py-16 px-6" style={{ background: "#0E0E0E" }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-10">
            <Link
              href="/"
              className="font-extrabold text-xl"
              style={{ color: "#F9F6F5", letterSpacing: "-0.02em" }}
            >
              supermarket<span style={{ color: "#6BFE9C" }}>.ie</span>
            </Link>
            <div
              className="flex gap-8 text-sm"
              style={{ color: "rgba(249,246,245,0.35)" }}
            >
              {[
                ["Privacy", "/privacy"],
                ["Terms", "/terms"],
                ["Contact", "/contact"],
              ].map(([l, h]) => (
                <Link
                  key={h}
                  href={h}
                  className="transition hover:text-white"
                >
                  {l}
                </Link>
              ))}
            </div>
          </div>
          <div
            className="pt-8 text-center text-xs"
            style={{
              borderTop: "1px solid rgba(249,246,245,0.06)",
              color: "rgba(249,246,245,0.2)",
            }}
          >
            © 2026 Gosuper Ltd (Company No. 700162) · supermarket.ie · Made with ❤️ in Ireland
          </div>
        </div>
      </footer>
    </div>
  );
}
