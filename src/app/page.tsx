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
    <div className="min-h-screen bg-gradient-to-b from-[#f8faf9] to-[#eef5f2]">
      {/* Cookie Banner */}
      {showCookieBanner && (
        <div className="fixed bottom-0 left-0 right-0 bg-[#1A1A1A]/95 backdrop-blur-sm text-white p-4 z-50 shadow-2xl border-t border-white/10">
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
              className="bg-[#FF6B5B] text-white px-6 py-2 rounded-full text-sm font-semibold hover:bg-[#e55a4a] transition-all hover:scale-105 whitespace-nowrap"
            >
              Accept cookies
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="px-6 py-5 flex justify-between items-center max-w-6xl mx-auto">
        <Link href="/" className="text-2xl font-bold text-[#1B4D3E] hover:opacity-80 transition">
          supermarket<span className="text-[#FF6B5B]">.ie</span>
        </Link>
        <nav className="hidden md:flex gap-8 text-gray-600">
          <a href="#how-it-works" className="hover:text-[#1B4D3E] transition font-medium">
            How it works
          </a>
          <a href="#signup" className="hover:text-[#1B4D3E] transition font-medium">
            Get started
          </a>
        </nav>
      </header>

      {/* Hero */}
      <section className="px-6 pt-16 pb-24 max-w-6xl mx-auto relative">
        {/* Decorative elements */}
        <div className="absolute top-10 right-10 w-72 h-72 bg-[#1B4D3E]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-10 left-10 w-64 h-64 bg-[#FF6B5B]/5 rounded-full blur-3xl" />
        
        <div className="max-w-3xl relative">
          <div className="inline-block bg-[#1B4D3E]/10 text-[#1B4D3E] px-4 py-2 rounded-full text-sm font-semibold mb-6">
            🇮🇪 Made for families in Ireland
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-[#1A1A1A] leading-tight mb-6">
            Smarter grocery shopping for{" "}
            <span className="text-[#1B4D3E] relative">
              Irish families
              <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 200 8" fill="none">
                <path d="M1 5.5C47 2 153 2 199 5.5" stroke="#FF6B5B" strokeWidth="3" strokeLinecap="round"/>
              </svg>
            </span>
          </h1>
          <p className="text-xl text-gray-600 mb-10 max-w-2xl leading-relaxed">
            Get a personalised weekly shopping list tailored to your household.
            Stop hunting through flyers. Start saving time and money.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <a
              href="#signup"
              className="inline-block bg-[#FF6B5B] text-white px-8 py-4 rounded-full text-lg font-semibold hover:bg-[#e55a4a] transition-all shadow-lg shadow-[#FF6B5B]/25 hover:shadow-xl hover:shadow-[#FF6B5B]/30 hover:-translate-y-0.5"
            >
              Get your free list →
            </a>
            <div className="flex items-center gap-3 text-gray-500 text-sm">
              <div className="flex -space-x-2">
                <div className="w-8 h-8 rounded-full bg-[#1B4D3E] flex items-center justify-center text-white text-xs">JM</div>
                <div className="w-8 h-8 rounded-full bg-[#2a6b5a] flex items-center justify-center text-white text-xs">SK</div>
                <div className="w-8 h-8 rounded-full bg-[#3d8b76] flex items-center justify-center text-white text-xs">LD</div>
              </div>
              <span>Joined by 500+ families</span>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="py-8 px-6 border-y border-[#1B4D3E]/10 bg-white/50">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-gray-400 text-sm mb-6 uppercase tracking-wider font-medium">
            Curated deals from Ireland&apos;s top supermarkets
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 opacity-60">
            <span className="text-2xl font-bold text-gray-400">Dunnes</span>
            <span className="text-2xl font-bold text-gray-400">Tesco</span>
            <span className="text-2xl font-bold text-gray-400">SuperValu</span>
            <span className="text-2xl font-bold text-gray-400">Lidl</span>
            <span className="text-2xl font-bold text-gray-400">Aldi</span>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { value: "€20+", label: "Average weekly savings", icon: "💰" },
              { value: "2hrs", label: "Saved on planning", icon: "⏱️" },
              { value: "100%", label: "Free to use", icon: "✨" },
            ].map((stat) => (
              <div key={stat.label} className="text-center p-8 rounded-2xl bg-white shadow-sm hover:shadow-md transition-shadow">
                <div className="text-4xl mb-3">{stat.icon}</div>
                <div className="text-4xl font-bold text-[#1B4D3E] mb-2">{stat.value}</div>
                <div className="text-gray-600">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" className="bg-white py-24 px-6 relative overflow-hidden">
        {/* Decorative background */}
        <div className="absolute top-0 left-0 w-full h-full opacity-[0.02]">
          <div className="absolute top-20 left-20 w-40 h-40 border-2 border-[#1B4D3E] rounded-full" />
          <div className="absolute bottom-20 right-20 w-60 h-60 border-2 border-[#FF6B5B] rounded-full" />
        </div>
        
        <div className="max-w-6xl mx-auto relative">
          <div className="text-center mb-16">
            <span className="text-[#FF6B5B] font-semibold text-sm uppercase tracking-wider">Simple & Easy</span>
            <h2 className="text-3xl md:text-4xl font-bold text-[#1A1A1A] mt-3">
              How it works
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-12">
            {[
              {
                step: "1",
                title: "Tell us about your household",
                desc: "Family size, dietary preferences, the basics. Takes 30 seconds.",
              },
              {
                step: "2",
                title: "Get your weekly list",
                desc: "Personalised picks with the best value across Irish supermarkets.",
              },
              {
                step: "3",
                title: "Shop smarter",
                desc: "Save time, save money, enjoy your week. It's that simple.",
              },
            ].map((item, index) => (
              <div key={item.step} className="text-center group">
                <div className="relative inline-block mb-6">
                  <div className="w-20 h-20 bg-gradient-to-br from-[#1B4D3E] to-[#2a6b5a] text-white rounded-2xl flex items-center justify-center text-3xl font-bold shadow-lg shadow-[#1B4D3E]/20 group-hover:scale-105 transition-transform">
                    {item.step}
                  </div>
                  {index < 2 && (
                    <div className="hidden md:block absolute top-1/2 left-full w-full h-0.5 bg-gradient-to-r from-[#1B4D3E]/20 to-transparent -translate-y-1/2 ml-4" />
                  )}
                </div>
                <h3 className="text-xl font-semibold text-[#1A1A1A] mb-3">
                  {item.title}
                </h3>
                <p className="text-gray-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Value Props */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-[#FF6B5B] font-semibold text-sm uppercase tracking-wider">Why Choose Us</span>
            <h2 className="text-3xl md:text-4xl font-bold text-[#1A1A1A] mt-3">
              Built for busy families
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: "🎯",
                title: "Tailored to your family",
                desc: "Lists sized for your household, not a generic template. We consider your family size and preferences.",
              },
              {
                icon: "📅",
                title: "Updated weekly",
                desc: "Fresh picks every week based on what's actually good value. Always current, never stale.",
              },
              {
                icon: "🛒",
                title: "No more flyer hunting",
                desc: "We do the legwork scanning all the deals. You just shop with confidence.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="bg-white p-8 rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-100 hover:border-[#1B4D3E]/20 group hover:-translate-y-1"
              >
                <div className="text-5xl mb-5 group-hover:scale-110 transition-transform">{item.icon}</div>
                <h3 className="text-xl font-semibold text-[#1A1A1A] mb-3">
                  {item.title}
                </h3>
                <p className="text-gray-600 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="py-16 px-6 bg-[#1B4D3E]/5">
        <div className="max-w-4xl mx-auto text-center">
          <div className="text-6xl mb-6">"</div>
          <blockquote className="text-2xl md:text-3xl text-[#1A1A1A] font-medium leading-relaxed mb-8">
            Finally, someone who understands that Irish families don&apos;t have time to compare 5 different supermarket apps every week.
          </blockquote>
          <div className="flex items-center justify-center gap-4">
            <div className="w-12 h-12 rounded-full bg-[#1B4D3E] flex items-center justify-center text-white font-semibold">SM</div>
            <div className="text-left">
              <div className="font-semibold text-[#1A1A1A]">Sarah M.</div>
              <div className="text-gray-500 text-sm">Mother of 3, Dublin</div>
            </div>
          </div>
        </div>
      </section>

      {/* Sign Up Form */}
      <section id="signup" className="bg-gradient-to-br from-[#1B4D3E] to-[#0f3429] py-24 px-6 relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#FF6B5B]/10 rounded-full blur-3xl" />
        
        <div className="max-w-2xl mx-auto text-center relative">
          <span className="inline-block bg-white/10 text-white/90 px-4 py-2 rounded-full text-sm font-medium mb-6">
            ✨ 100% Free — No Credit Card Required
          </span>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Get your free weekly list
          </h2>
          <p className="text-[#a3d9c8] text-lg mb-10">
            Join Irish families who shop smarter. Takes 30 seconds.
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
                      className={`p-4 rounded-xl text-center transition-all ${
                        familySize === option.value
                          ? "bg-[#FF6B5B] text-white shadow-lg shadow-[#FF6B5B]/30 scale-105"
                          : "bg-white/10 text-white hover:bg-white/20 hover:scale-102"
                      }`}
                    >
                      <div className="text-2xl mb-1">{option.icon}</div>
                      <div className="text-sm font-medium">{option.label}</div>
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
                  className="w-full px-6 py-4 rounded-xl text-lg focus:outline-none focus:ring-4 focus:ring-[#FF6B5B]/50 shadow-inner"
                />
              </div>

              <button
                type="submit"
                disabled={!familySize || !email}
                className="w-full bg-[#FF6B5B] text-white px-8 py-4 rounded-xl text-lg font-semibold hover:bg-[#e55a4a] transition-all shadow-lg shadow-[#FF6B5B]/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none hover:shadow-xl hover:-translate-y-0.5"
              >
                Send me my list →
              </button>

              <p className="text-[#a3d9c8] text-sm">
                🔒 Your data is safe. Unsubscribe anytime. No spam, we promise.
              </p>
            </form>
          ) : (
            <div className="bg-white/10 backdrop-blur-sm p-10 rounded-2xl border border-white/20">
              <div className="text-6xl mb-4">🎉</div>
              <h3 className="text-2xl font-bold text-white mb-3">
                You&apos;re in!
              </h3>
              <p className="text-[#a3d9c8] text-lg">
                We&apos;ll send your first personalised list this week. Keep an
                eye on your inbox.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 bg-[#0a2820]">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
            <Link href="/" className="text-white font-bold text-xl hover:opacity-80 transition">
              supermarket<span className="text-[#FF6B5B]">.ie</span>
            </Link>
            <div className="flex gap-8 text-[#a3d9c8] text-sm">
              <Link href="/privacy" className="hover:text-white transition">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-white transition">
                Terms of Service
              </Link>
              <a href="mailto:hello@supermarket.ie" className="hover:text-white transition">
                Contact
              </a>
            </div>
          </div>
          <div className="pt-8 border-t border-white/10 text-center text-[#6b9b8a] text-sm">
            © 2026 supermarket.ie · Made with ❤️ in Ireland 🇮🇪
          </div>
        </div>
      </footer>
    </div>
  );
}
