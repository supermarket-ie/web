"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function Home() {
  const [familySize, setFamilySize] = useState<string>("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showCookieBanner, setShowCookieBanner] = useState(false);

  useEffect(() => {
    const cookieConsent = localStorage.getItem("cookieConsent");
    if (!cookieConsent) {
      setShowCookieBanner(true);
    }
  }, []);

  const acceptCookies = () => {
    localStorage.setItem("cookieConsent", "accepted");
    setShowCookieBanner(false);
  };

  const familyOptions = [
    { value: "1", label: "Just me", icon: "👤" },
    { value: "2", label: "Couple", icon: "👥" },
    { value: "3-4", label: "3-4 people", icon: "👨‍👩‍👧" },
    { value: "5+", label: "5+", icon: "👨‍👩‍👧‍👦" },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, familySize }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFBF7]">
      {/* Cookie Banner */}
      {showCookieBanner && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#2D3436]/95 backdrop-blur-sm text-white p-4 z-50 shadow-2xl">
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-300">
              We use cookies to improve your experience.{" "}
              <Link href="/privacy" className="underline hover:text-white">Privacy Policy</Link>
            </p>
            <button
              onClick={acceptCookies}
              className="bg-[#E17055] text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-[#d65f45] transition whitespace-nowrap"
            >
              Accept
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="px-6 py-4 border-b border-[#E8E2DC]">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2.5">
            {/* Logo Icon - Shopping bag with carrot */}
            <div className="relative w-9 h-9">
              <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                {/* Shopping bag */}
                <path 
                  d="M8 12C8 10.8954 8.89543 10 10 10H30C31.1046 10 32 10.8954 32 12V32C32 34.2091 30.2091 36 28 36H12C9.79086 36 8 34.2091 8 32V12Z" 
                  fill="#E17055"
                />
                {/* Bag handles */}
                <path 
                  d="M14 10V8C14 5.79086 15.7909 4 18 4H22C24.2091 4 26 5.79086 26 8V10" 
                  stroke="#E17055" 
                  strokeWidth="2.5" 
                  strokeLinecap="round"
                />
                {/* Carrot body */}
                <path 
                  d="M20 17L17 30" 
                  stroke="#FFFBF7" 
                  strokeWidth="4" 
                  strokeLinecap="round"
                />
                {/* Carrot leaves */}
                <path 
                  d="M18 17C18 17 19 15 20 15C21 15 22 17 22 17" 
                  stroke="#00B894" 
                  strokeWidth="2" 
                  strokeLinecap="round"
                />
                <path 
                  d="M20 15V13" 
                  stroke="#00B894" 
                  strokeWidth="2" 
                  strokeLinecap="round"
                />
              </svg>
            </div>
            {/* Wordmark */}
            <span className="text-[22px] font-bold tracking-tight text-[#1D2324]">
              supermarket<span className="text-[#1D2324]">.ie</span>
            </span>
          </Link>
          <nav className="flex items-center gap-6">
            <a href="#how-it-works" className="text-[#636E72] hover:text-[#1D2324] transition text-sm font-medium hidden md:block">
              How it works
            </a>
            <a
              href="#signup"
              className="bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:from-[#D4604A] hover:to-[#C5533D] active:from-[#C5533D] active:to-[#B84736] transition-all shadow-sm"
            >
              Get started free
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-16 md:py-24">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Left: Copy */}
            <div>
              <div className="inline-flex items-center gap-2 bg-[#FEF3E2] text-[#E17055] px-3 py-1.5 rounded-full text-sm font-medium mb-6">
                <span className="w-2 h-2 bg-[#00B894] rounded-full animate-pulse"></span>
                Now available across Ireland
              </div>
              
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-[#1D2324] leading-[1.1] tracking-tight mb-6">
                Your weekly shop,<br />
                <span className="bg-gradient-to-r from-[#E17055] to-[#D4604A] bg-clip-text text-transparent">sorted in minutes.</span>
              </h1>
              
              <p className="text-lg md:text-xl text-[#636E72] leading-relaxed mb-8 max-w-lg">
                Personalised weekly shopping lists based on your household — saving you time, money, and mental effort.
              </p>

              {/* Value Props */}
              <div className="space-y-3 mb-8">
                {[
                  "Deals from Dunnes, Tesco, SuperValu, Lidl & Aldi",
                  "Save €20+ every week on your shop",
                  "Stop wasting hours comparing prices",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-[#5D9B8F] flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="text-[#1D2324] font-medium">{item}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <a
                  href="#signup"
                  className="inline-flex items-center justify-center bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-8 py-4 rounded-xl text-lg font-semibold hover:from-[#D4604A] hover:to-[#C5533D] active:from-[#C5533D] active:to-[#B84736] transition-all shadow-lg shadow-[#E17055]/20 hover:shadow-xl hover:shadow-[#E17055]/30 hover:-translate-y-0.5"
                >
                  Start saving now
                  <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </a>
                <div className="text-sm text-[#636E72]">
                  <span className="font-semibold text-[#1D2324]">100% free</span> · No card required
                </div>
              </div>
            </div>

            {/* Right: Visual/Form Preview */}
            <div className="relative">
              <div className="bg-white rounded-2xl shadow-xl p-6 border border-[#E8E2DC]">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-full bg-[#F5F0EB] flex items-center justify-center">
                    <span className="text-xl">📋</span>
                  </div>
                  <div>
                    <div className="font-semibold text-[#1D2324]">This week&apos;s smart list</div>
                    <div className="text-sm text-[#636E72]">Personalised for a family of 4</div>
                  </div>
                </div>
                
                <div className="space-y-3">
                  {[
                    { store: "Tesco", item: "Chicken Breasts 1kg", price: "€7.99", saving: "€3.00" },
                    { store: "Lidl", item: "Organic Milk 2L", price: "€1.89", saving: "€0.60" },
                    { store: "Dunnes", item: "Wholegrain Bread", price: "€1.50", saving: "€0.49" },
                    { store: "Aldi", item: "Free Range Eggs 12pk", price: "€2.99", saving: "€1.00" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-[#FFFBF7] rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#E8E2DC] flex items-center justify-center text-xs font-bold text-[#636E72]">
                          {item.store.slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-medium text-[#1D2324] text-sm">{item.item}</div>
                          <div className="text-xs text-[#636E72]">{item.store}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-[#1D2324]">{item.price}</div>
                        <div className="text-xs text-[#5D9B8F] font-medium">Save {item.saving}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-4 border-t border-[#E8E2DC] flex justify-between items-center">
                  <span className="text-[#636E72]">Weekly savings</span>
                  <span className="text-2xl font-bold text-[#5D9B8F]">€23.40</span>
                </div>
              </div>

              {/* Floating badge */}
              <div className="absolute -bottom-4 -left-4 bg-white rounded-xl shadow-lg p-3 border border-[#E8E2DC]">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    <div className="w-8 h-8 rounded-full bg-[#5D9B8F] border-2 border-white flex items-center justify-center text-white text-xs font-bold">JK</div>
                    <div className="w-8 h-8 rounded-full bg-[#7B8A8E] border-2 border-white flex items-center justify-center text-white text-xs font-bold">SM</div>
                    <div className="w-8 h-8 rounded-full bg-[#9B8574] border-2 border-white flex items-center justify-center text-white text-xs font-bold">PL</div>
                  </div>
                  <div className="text-sm">
                    <div className="font-semibold text-[#1D2324]">2,400+</div>
                    <div className="text-[#636E72] text-xs">Happy shoppers</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="py-8 px-6 bg-white border-y border-[#E8E2DC]">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-[#636E72] text-sm mb-6">
            Trusted by families across Ireland · Deals from all major supermarkets
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16">
            {["Dunnes", "Tesco", "SuperValu", "Lidl", "Aldi"].map((store) => (
              <span key={store} className="text-xl font-bold text-[#B2BEC3]">{store}</span>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-[#1D2324] mb-4">
              How it works
            </h2>
            <p className="text-[#636E72] text-lg max-w-2xl mx-auto">
              Three simple steps to smarter grocery shopping
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                num: "01",
                title: "Tell us about you",
                desc: "Household size, preferences, stores near you. Takes 30 seconds.",
                icon: "👤",
              },
              {
                num: "02",
                title: "Get your weekly list",
                desc: "We scan every deal and build a personalised list just for you.",
                icon: "📋",
              },
              {
                num: "03",
                title: "Shop & save",
                desc: "Use your list at any store. Watch the savings add up.",
                icon: "💰",
              },
            ].map((step, i) => (
              <div key={step.num} className="relative">
                {i < 2 && (
                  <div className="hidden md:block absolute top-12 left-full w-full h-0.5 bg-[#E8E2DC] -translate-x-1/2 z-0"></div>
                )}
                <div className="relative bg-white rounded-2xl p-8 border border-[#E8E2DC] hover:border-[#5D9B8F]/40 hover:shadow-lg transition-all">
                  <div className="text-4xl mb-4">{step.icon}</div>
                  <div className="text-sm font-bold text-[#5D9B8F] mb-2">{step.num}</div>
                  <h3 className="text-xl font-bold text-[#1D2324] mb-2">{step.title}</h3>
                  <p className="text-[#636E72]">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-[#1D2324] mb-6">
                Groceries without<br />the mental load
              </h2>
              <p className="text-[#636E72] text-lg mb-8">
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
                    <div className="w-12 h-12 rounded-xl bg-[#F5F0EB] flex items-center justify-center flex-shrink-0">
                      <span className="text-2xl">{benefit.icon}</span>
                    </div>
                    <div>
                      <h3 className="font-bold text-[#1D2324] mb-1">{benefit.title}</h3>
                      <p className="text-[#636E72] text-sm">{benefit.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats Card */}
            <div className="bg-gradient-to-br from-[#1D2324] to-[#2D3436] rounded-2xl p-8 text-white">
              <h3 className="text-xl font-bold mb-8">The average Irish family spends...</h3>
              <div className="space-y-6">
                <div>
                  <div className="text-5xl font-bold text-[#E8A090]">€12,000</div>
                  <div className="text-[#9BA3A7]">per year on groceries</div>
                </div>
                <div className="h-px bg-white/10"></div>
                <div>
                  <div className="text-5xl font-bold text-[#7ABFB3]">€1,200+</div>
                  <div className="text-[#9BA3A7]">potential yearly savings with us</div>
                </div>
              </div>
              <a
                href="#signup"
                className="mt-8 w-full bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-6 py-4 rounded-xl font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all flex items-center justify-center gap-2"
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
      <section className="py-20 px-6 bg-[#F5F0EB]">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-1 mb-6">
            {[...Array(5)].map((_, i) => (
              <svg key={i} className="w-6 h-6 text-[#F9CA24]" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          <blockquote className="text-2xl md:text-3xl font-medium text-[#1D2324] leading-relaxed mb-8">
            &ldquo;I used to spend my Sunday comparing Tesco and Dunnes prices. Now I just check the app and I&apos;m done in 5 minutes. Game changer.&rdquo;
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <div className="w-14 h-14 rounded-full bg-[#5D9B8F] flex items-center justify-center text-white font-bold text-lg">SM</div>
            <div className="text-left">
              <div className="font-bold text-[#1D2324]">Sarah Murphy</div>
              <div className="text-[#636E72]">Mum of 3, Dublin</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA / Sign Up */}
      <section id="signup" className="py-20 px-6">
        <div className="max-w-xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-8 md:p-10 border border-[#E8E2DC]">
            <div className="text-center mb-8">
              <h2 className="text-3xl md:text-4xl font-bold text-[#1D2324] mb-3">
                Get your free list
              </h2>
              <p className="text-[#636E72]">
                Join 2,400+ smart shoppers across Ireland
              </p>
            </div>

            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-[#1D2324] mb-2">
                    Household size
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {familyOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFamilySize(option.value)}
                        className={`p-3 rounded-xl text-center transition-all border-2 ${
                          familySize === option.value
                            ? "border-[#E17055] bg-[#FEF3E2] text-[#E17055]"
                            : "border-[#E8E2DC] hover:border-[#E17055]/50 text-[#636E72]"
                        }`}
                      >
                        <div className="text-xl mb-1">{option.icon}</div>
                        <div className="text-xs font-medium">{option.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-[#1D2324] mb-2">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="w-full px-4 py-3.5 rounded-xl border-2 border-[#E8E2DC] focus:border-[#5D9B8F] focus:outline-none transition text-[#1D2324] placeholder:text-[#B2BEC3]"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!familySize || !email || submitting}
                  className="w-full bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-6 py-4 rounded-xl text-lg font-semibold hover:from-[#D4604A] hover:to-[#C5533D] active:from-[#C5533D] active:to-[#B84736] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:from-[#E17055] disabled:to-[#D4604A]"
                >
                  {submitting ? "Signing up..." : "Get my free list →"}
                </button>

                <p className="text-center text-sm text-[#636E72]">
                  🔒 No spam, ever. Unsubscribe anytime.
                </p>
              </form>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-[#5D9B8F]/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-[#5D9B8F]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-[#1D2324] mb-2">You&apos;re in!</h3>
                <p className="text-[#636E72]">
                  Check your inbox for your first personalised list.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 bg-[#1D2324] text-white">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
            <Link href="/" className="font-bold text-xl">
              supermarket<span className="text-white/60">.ie</span>
            </Link>
            <div className="flex gap-6 text-sm text-[#B2BEC3]">
              <Link href="/privacy" className="hover:text-white transition">Privacy</Link>
              <Link href="/terms" className="hover:text-white transition">Terms</Link>
              <a href="mailto:hello@supermarket.ie" className="hover:text-white transition">Contact</a>
            </div>
          </div>
          <div className="pt-8 border-t border-white/10 text-center text-white/40 text-sm">
            © 2026 supermarket.ie · Made with ❤️ in Ireland
          </div>
        </div>
      </footer>
    </div>
  );
}
