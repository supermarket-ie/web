import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'List your store on supermarket.ie',
  description: 'Reach thousands of Irish shoppers comparing grocery prices. List your store free — go live in under 10 minutes.',
};

const CATEGORIES = ['Groceries','Deli','Bakery','Butcher','Fishmonger','Pharmacy','Health & Beauty','Electronics','Restaurant','Convenience','Other'];

export default function VendorLandingPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <SiteHeader />

      {/* Hero */}
      <section className="px-6 py-16 md:py-24" style={{ background: 'var(--surface)' }}>
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="chip-tertiary mb-6">
              ✨ 2,400+ shoppers ready to discover you
            </div>
            <h1 className="type-display text-on-background mb-6">
              Put your store in front of Ireland&rsquo;s smartest shoppers
            </h1>
            <p className="type-body-lg mb-10" style={{ color: 'var(--on-surface)' }}>
              supermarket.ie is where Irish families compare prices and plan their weekly shop.
              List your products and reach customers who are actively looking to buy — for free.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/vendor/signup" className="btn-primary px-8 py-4 text-lg">
                Get listed free
                <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
                </svg>
              </Link>
              <Link href="/vendor/signin" className="btn-secondary px-8 py-4 text-lg">
                Sign in to dashboard
              </Link>
            </div>
            <p className="text-sm mt-4" style={{ color: 'var(--on-surface-variant)' }}>
              No card required · Live in under 10 minutes
            </p>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { value: '2,400+', label: 'Active shoppers', emoji: '🛒' },
              { value: 'Free',   label: 'To get started',  emoji: '✅' },
              { value: '<10 min', label: 'To go live',     emoji: '⚡' },
              { value: '5 stores', label: 'We compare against', emoji: '📊' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-5 text-center" style={{ background: 'var(--surface-container-lowest)' }}>
                <div className="text-2xl mb-2">{s.emoji}</div>
                <div className="type-title-lg text-on-background mb-1">{s.value}</div>
                <div className="text-sm" style={{ color: 'var(--on-surface)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="px-6 py-16" style={{ background: 'var(--surface-container-low)' }}>
        <div className="max-w-5xl mx-auto">
          <h2 className="type-title-lg text-on-background mb-2">All types of stores welcome</h2>
          <p className="mb-8" style={{ color: 'var(--on-surface)' }}>
            Groceries, deli, butcher, bakery, pharmacy, electronics and more.
          </p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(c => (
              <span key={c}
                className="px-4 py-2 rounded-full text-sm font-semibold"
                style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-20" style={{ background: 'var(--surface)' }}>
        <div className="max-w-5xl mx-auto">
          <h2 className="type-headline text-on-background mb-12 text-center">How it works</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { step: '01', emoji: '📝', title: 'Sign up free',    desc: 'Enter your business details, location and categories. Takes under 5 minutes.', dark: false },
              { step: '02', emoji: '📦', title: 'Add your products', desc: 'Set your prices on our catalogue of 57+ products, or add your own custom items.', dark: true },
              { step: '03', emoji: '🚀', title: 'Go live',          desc: 'Once approved (usually same day), your store appears to shoppers in your area.', dark: false },
            ].map(s => (
              <div key={s.step} className="rounded-2xl p-8 relative overflow-hidden"
                style={s.dark
                  ? { background: 'var(--primary)', color: '#fff' }
                  : { background: 'var(--surface-container-lowest)' }
                }>
                {s.dark && (
                  <div className="absolute w-40 h-40 rounded-full top-0 right-0 translate-x-1/2 -translate-y-1/2"
                    style={{ background: 'var(--primary-container)', opacity: 0.15 }} />
                )}
                <div className="text-4xl mb-4">{s.emoji}</div>
                <div className="type-label mb-2" style={{ color: s.dark ? 'var(--primary-container)' : 'var(--primary)' }}>
                  {s.step}
                </div>
                <h3 className="type-title-lg mb-2" style={{ color: s.dark ? '#fff' : 'var(--on-background)' }}>
                  {s.title}
                </h3>
                <p className="text-sm leading-relaxed"
                  style={{ color: s.dark ? 'rgba(255,255,255,0.78)' : 'var(--on-surface)' }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 py-20" style={{ background: 'var(--surface-container-low)' }}>
        <div className="max-w-4xl mx-auto">
          <h2 className="type-headline text-on-background mb-2 text-center">Simple, transparent pricing</h2>
          <p className="text-center mb-12" style={{ color: 'var(--on-surface)' }}>
            Start free. Upgrade when you&rsquo;re ready.
          </p>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                plan: 'Free', price: '€0', period: 'forever',
                features: ['Listed on supermarket.ie', 'Up to 20 products', 'Public storefront page', 'Basic profile'],
                cta: 'Get started', highlight: false,
              },
              {
                plan: 'Pro', price: '€49', period: '/month',
                features: ['Everything in Free', 'Unlimited products', 'Priority placement', 'Sales analytics', 'Custom store banner'],
                cta: 'Start Pro', highlight: true,
              },
              {
                plan: 'Featured', price: '€149', period: '/month',
                features: ['Everything in Pro', 'Homepage feature', 'Category spotlight', 'Dedicated account manager', 'Early access'],
                cta: 'Go Featured', highlight: false,
              },
            ].map(p => (
              <div key={p.plan} className="rounded-2xl p-6"
                style={p.highlight
                  ? { background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', color: 'var(--on-primary-container)' }
                  : { background: 'var(--surface-container-lowest)' }
                }>
                <div className="type-label mb-1"
                  style={{ color: p.highlight ? 'rgba(0,74,35,0.7)' : 'var(--primary)' }}>
                  {p.plan}
                </div>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-3xl font-extrabold"
                    style={{ color: p.highlight ? 'var(--on-primary-container)' : 'var(--on-background)', letterSpacing: '-0.02em' }}>
                    {p.price}
                  </span>
                  <span className="text-sm"
                    style={{ color: p.highlight ? 'rgba(0,74,35,0.65)' : 'var(--on-surface)' }}>
                    {p.period}
                  </span>
                </div>
                <ul className="space-y-2 mb-6">
                  {p.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm"
                      style={{ color: p.highlight ? 'var(--on-primary-container)' : 'var(--on-surface)' }}>
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24"
                        stroke={p.highlight ? 'var(--on-primary-container)' : 'var(--primary)'} strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/vendor/signup"
                  className="block text-center py-3 rounded-xl font-semibold text-sm transition-all"
                  style={p.highlight
                    ? { background: 'var(--surface-container-lowest)', color: 'var(--primary)' }
                    : { background: 'var(--inverse-surface)', color: 'var(--inverse-on-surface)' }
                  }>
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20" style={{ background: 'var(--inverse-surface)' }}>
        <div className="max-w-lg mx-auto text-center">
          <h2 className="type-headline mb-4" style={{ color: 'var(--inverse-on-surface)' }}>
            Ready to reach more customers?
          </h2>
          <p className="mb-8" style={{ color: 'rgba(249,246,245,0.6)' }}>
            Join Ireland&rsquo;s growing local commerce platform. Free to start, live in minutes.
          </p>
          <Link href="/vendor/signup" className="btn-primary px-8 py-4 text-lg">
            List my store free
            <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
            </svg>
          </Link>
          <p className="text-sm mt-4" style={{ color: 'rgba(249,246,245,0.4)' }}>
            Questions?{' '}
            <Link href="/contact" className="underline hover:opacity-80" style={{ color: 'var(--primary-container)' }}>
              Get in touch
            </Link>
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
