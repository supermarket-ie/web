import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'List your store on supermarket.ie',
  description: 'Reach thousands of Irish shoppers comparing grocery prices. List your store free — go live in under 10 minutes.',
};

const CATEGORIES = ['Groceries','Deli','Bakery','Butcher','Fishmonger','Pharmacy','Health & Beauty','Electronics','Restaurant','Convenience','Other'];

export default function VendorLandingPage() {
  return (
    <div className="min-h-screen bg-[#FFFBF7]">
      <header className="px-6 py-4 border-b border-[#E8E2DC] bg-white">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <Link href="/" className="text-[18px] font-bold tracking-tight text-[#1D2324]">
            supermarket<span className="text-[#E17055]">.ie</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/vendor/signin" className="text-sm font-semibold text-[#636E72] hover:text-[#1D2324] transition">Sign in</Link>
            <Link href="/vendor/signup" className="bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all shadow-sm">
              List my store →
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-16 md:py-24 border-b border-[#E8E2DC]">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-[#FEF3E2] text-[#E17055] px-3 py-1.5 rounded-full text-sm font-medium mb-5">
              <span className="w-2 h-2 bg-[#00B894] rounded-full"></span>
              2,400+ shoppers ready to discover you
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-[#1D2324] leading-tight mb-5">
              Put your store in front of Ireland&rsquo;s smartest shoppers
            </h1>
            <p className="text-[#636E72] text-lg mb-8 leading-relaxed">
              supermarket.ie is where Irish families compare prices and plan their weekly shop. List your products and reach customers who are actively looking to buy — for free.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/vendor/signup"
                className="inline-flex items-center justify-center bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-8 py-4 rounded-xl text-lg font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all shadow-lg shadow-[#E17055]/20">
                Get listed free
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
                </svg>
              </Link>
              <Link href="/vendor/signin" className="inline-flex items-center justify-center border-2 border-[#E8E2DC] text-[#636E72] px-8 py-4 rounded-xl text-lg font-semibold hover:border-[#1D2324] hover:text-[#1D2324] transition-all">
                Sign in to dashboard
              </Link>
            </div>
            <p className="text-sm text-[#B2BEC3] mt-4">No card required · Live in under 10 minutes</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { value: '2,400+', label: 'Active shoppers', emoji: '🛒' },
              { value: 'Free', label: 'To get started', emoji: '✅' },
              { value: '<10 min', label: 'To go live', emoji: '⚡' },
              { value: '5 stores', label: 'We compare against', emoji: '📊' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl border border-[#E8E2DC] p-5 text-center">
                <div className="text-2xl mb-2">{s.emoji}</div>
                <div className="text-2xl font-bold text-[#1D2324] mb-1">{s.value}</div>
                <div className="text-sm text-[#636E72]">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="px-6 py-16 border-b border-[#E8E2DC]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-[#1D2324] mb-2">All types of stores welcome</h2>
          <p className="text-[#636E72] mb-8">Groceries, deli, butcher, bakery, pharmacy, electronics and more.</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(c => (
              <span key={c} className="px-4 py-2 bg-white border border-[#E8E2DC] rounded-full text-sm font-medium text-[#636E72]">{c}</span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-16 border-b border-[#E8E2DC]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-[#1D2324] mb-10 text-center">How it works</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { step: '01', emoji: '📝', title: 'Sign up free', desc: 'Enter your business details, location and the categories you serve. Takes under 5 minutes.' },
              { step: '02', emoji: '📦', title: 'Add your products', desc: 'Set your prices on our catalogue of 57+ products, or add your own custom items.' },
              { step: '03', emoji: '🚀', title: 'Go live', desc: "Once approved (usually same day), your store appears to shoppers comparing prices in your area." },
            ].map(s => (
              <div key={s.step} className="bg-white rounded-2xl border border-[#E8E2DC] p-6">
                <div className="text-3xl mb-3">{s.emoji}</div>
                <div className="text-sm font-bold text-[#E17055] mb-2">{s.step}</div>
                <h3 className="text-lg font-bold text-[#1D2324] mb-2">{s.title}</h3>
                <p className="text-[#636E72] text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 py-16 bg-[#F5F0EB] border-b border-[#E8E2DC]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-[#1D2324] mb-2 text-center">Simple, transparent pricing</h2>
          <p className="text-[#636E72] text-center mb-10">Start free. Upgrade when you&rsquo;re ready.</p>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { plan: 'Free', price: '€0', period: 'forever', features: ['Listed on supermarket.ie', 'Up to 20 products', 'Public storefront page', 'Basic profile'], cta: 'Get started', highlight: false },
              { plan: 'Pro', price: '€49', period: '/month', features: ['Everything in Free', 'Unlimited products', 'Priority placement', 'Sales analytics', 'Custom store banner'], cta: 'Start Pro', highlight: true },
              { plan: 'Featured', price: '€149', period: '/month', features: ['Everything in Pro', 'Homepage feature', 'Category page spotlight', 'Dedicated account manager', 'Early access to new features'], cta: 'Go Featured', highlight: false },
            ].map(p => (
              <div key={p.plan} className={`rounded-2xl p-6 ${p.highlight ? 'bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white shadow-lg shadow-[#E17055]/20' : 'bg-white border border-[#E8E2DC]'}`}>
                <div className={`text-sm font-bold mb-1 ${p.highlight ? 'text-white/80' : 'text-[#E17055]'}`}>{p.plan}</div>
                <div className="flex items-baseline gap-1 mb-5">
                  <span className={`text-3xl font-bold ${p.highlight ? 'text-white' : 'text-[#1D2324]'}`}>{p.price}</span>
                  <span className={`text-sm ${p.highlight ? 'text-white/70' : 'text-[#636E72]'}`}>{p.period}</span>
                </div>
                <ul className="space-y-2 mb-6">
                  {p.features.map(f => (
                    <li key={f} className={`flex items-center gap-2 text-sm ${p.highlight ? 'text-white/90' : 'text-[#636E72]'}`}>
                      <svg className={`w-4 h-4 flex-shrink-0 ${p.highlight ? 'text-white' : 'text-[#5D9B8F]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/vendor/signup"
                  className={`block text-center py-3 rounded-xl font-semibold text-sm transition-all ${p.highlight ? 'bg-white text-[#E17055] hover:bg-white/90' : 'bg-[#1D2324] text-white hover:bg-[#2D3436]'}`}>
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-16">
        <div className="max-w-lg mx-auto text-center">
          <h2 className="text-2xl font-bold text-[#1D2324] mb-3">Ready to reach more customers?</h2>
          <p className="text-[#636E72] mb-6">Join Ireland&rsquo;s growing local commerce platform. Free to start, live in minutes.</p>
          <Link href="/vendor/signup"
            className="inline-flex items-center gap-2 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-8 py-4 rounded-xl font-semibold text-lg hover:from-[#D4604A] hover:to-[#C5533D] transition-all shadow-lg shadow-[#E17055]/20">
            List my store free
          </Link>
          <p className="text-sm text-[#B2BEC3] mt-4">Questions? <Link href="/contact" className="text-[#E17055] hover:underline">Get in touch</Link></p>
        </div>
      </section>

      <footer className="py-6 px-6 border-t border-[#E8E2DC]">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3 text-sm text-[#B2BEC3]">
          <Link href="/" className="font-bold text-[#1D2324]">supermarket.ie</Link>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-[#636E72]">Privacy</Link>
            <Link href="/terms" className="hover:text-[#636E72]">Terms</Link>
            <Link href="/contact" className="hover:text-[#636E72]">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
