"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function Home() {
  const [familySize, setFamilySize] = useState<string>("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
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
    { value: "3-4", label: "Family of 3-4", icon: "👨‍👩‍👧" },
    { value: "5+", label: "5 or more", icon: "👨‍👩‍👧‍👦" },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Connect to Supabase
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Cookie Banner */}
      {showCookieBanner && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#1A1A1A] text-white p-4 z-50 shadow-lg">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-300">
              We use cookies to improve your experience. By continuing to use this site, you agree to our{" "}
              <Link href="/privacy" className="underline hover:text-white">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link href="/terms" className="underline hover:text-white">
                Terms of Service
              </Link>
              .
            </p>
            <button
              onClick={acceptCookies}
              className="bg-[#FF6B5B] text-white px-6 py-2 rounded-full text-sm font-semibold hover:bg-[#e55a4a] transition whitespace-nowrap"
            >
              Accept cookies
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="px-6 py-4 flex justify-between items-center max-w-6xl mx-auto">
        <Link href="/" className="text-2xl font-bold text-[#1B4D3E]">
          supermarket<span className="text-[#FF6B5B]">.ie</span>
        </Link>
        <nav className="hidden md:flex gap-8 text-gray-600">
          <a href="#how-it-works" className="hover:text-[#1B4D3E] transition">
            How it works
          </a>
          <a href="#signup" className="hover:text-[#1B4D3E] transition">
            Get started
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section className="px-6 pt-16 pb-24 max-w-6xl mx-auto">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-6xl font-bold text-[#1A1A1A] leading-tight mb-6">
            Smarter grocery shopping for{" "}
            <span className="text-[#1B4D3E]">Irish families</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl">
            Get a personalized weekly shopping list tailored to your household.
            Stop hunting through flyers. Start saving time and money.
          </p>
          <a
            href="#signup"
            className="inline-block bg-[#FF6B5B] text-white px-8 py-4 rounded-full text-lg font-semibold hover:bg-[#e55a4a] transition shadow-lg"
          >
            Get your free list →
          </a>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="bg-white py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-[#1A1A1A] mb-16">
            How it works
          </h2>
          <div className="grid md:grid-cols-3 gap-12">
            {[
              {
                step: "1",
                title: "Tell us about your household",
                desc: "Family size, dietary preferences, the basics.",
              },
              {
                step: "2",
                title: "Get your weekly list",
                desc: "Personalized picks with the best value across Irish supermarkets.",
              },
              {
                step: "3",
                title: "Shop smarter",
                desc: "Save time, save money, enjoy your week.",
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-16 h-16 bg-[#1B4D3E] text-white rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-6">
                  {item.step}
                </div>
                <h3 className="text-xl font-semibold text-[#1A1A1A] mb-3">
                  {item.title}
                </h3>
                <p className="text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Value Props */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: "🎯",
                title: "Tailored to your family",
                desc: "Lists sized for your household, not a generic template.",
              },
              {
                icon: "📅",
                title: "Updated weekly",
                desc: "Fresh picks every week based on what's actually good value.",
              },
              {
                icon: "⏱️",
                title: "No more flyer hunting",
                desc: "We do the legwork. You just shop.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="bg-white p-8 rounded-2xl shadow-sm"
              >
                <div className="text-4xl mb-4">{item.icon}</div>
                <h3 className="text-xl font-semibold text-[#1A1A1A] mb-2">
                  {item.title}
                </h3>
                <p className="text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sign Up Form */}
      <section id="signup" className="bg-[#1B4D3E] py-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Get your free weekly list
          </h2>
          <p className="text-[#a3d9c8] text-lg mb-10">
            Join Irish families who shop smarter. It&apos;s free.
          </p>

          {!submitted ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Family Size Selector */}
              <div>
                <label className="block text-white text-left mb-3 font-medium">
                  How big is your household?
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {familyOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFamilySize(option.value)}
                      className={`p-4 rounded-xl text-center transition ${
                        familySize === option.value
                          ? "bg-[#FF6B5B] text-white"
                          : "bg-white/10 text-white hover:bg-white/20"
                      }`}
                    >
                      <div className="text-2xl mb-1">{option.icon}</div>
                      <div className="text-sm">{option.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Email Input */}
              <div>
                <label className="block text-white text-left mb-3 font-medium">
                  Where should we send your list?
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full px-6 py-4 rounded-xl text-lg focus:outline-none focus:ring-4 focus:ring-[#FF6B5B]/50"
                />
              </div>

              <button
                type="submit"
                disabled={!familySize || !email}
                className="w-full bg-[#FF6B5B] text-white px-8 py-4 rounded-xl text-lg font-semibold hover:bg-[#e55a4a] transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send me my list →
              </button>

              <p className="text-[#a3d9c8] text-sm">
                Free forever. Unsubscribe anytime. No spam, we promise.
              </p>
            </form>
          ) : (
            <div className="bg-white/10 p-8 rounded-2xl">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="text-2xl font-bold text-white mb-2">
                You&apos;re in!
              </h3>
              <p className="text-[#a3d9c8]">
                We&apos;ll send your first personalized list this week. Keep an
                eye on your inbox.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 bg-[#0f3429]">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
            <Link href="/" className="text-white font-bold text-xl">
              supermarket<span className="text-[#FF6B5B]">.ie</span>
            </Link>
            <div className="flex gap-6 text-[#a3d9c8] text-sm">
              <Link href="/privacy" className="hover:text-white transition">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-white transition">
                Terms of Service
              </Link>
            </div>
          </div>
          <div className="text-center text-[#a3d9c8] text-sm">
            © 2026 supermarket.ie · Made in Ireland 🇮🇪
          </div>
        </div>
      </footer>
    </div>
  );
}
