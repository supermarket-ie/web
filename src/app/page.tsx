'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import {
  HeroSection,
  StoreLogosBar,
  HowItWorksSection,
  BenefitsSection,
  TestimonialsSection,
  FAQSection,
  BottomCTASection,
} from '@/components/homepage';
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
    <div className="min-h-screen bg-surface noise-bg">
      {/* Cookie banner */}
      {showCookieBanner && (
        <div
          className="fixed bottom-0 left-0 right-0 p-4 z-50"
          style={{
            background: 'rgba(14,14,14,0.94)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm" style={{ color: 'rgba(249,246,245,0.7)' }}>
              We use cookies to improve your experience.{' '}
              <Link
                href="/privacy"
                className="underline hover:opacity-80"
                style={{ color: 'var(--primary-container)' }}
              >
                Privacy Policy
              </Link>
            </p>
            <button
              onClick={() => {
                localStorage.setItem('cookieConsent', 'accepted');
                setShowCookieBanner(false);
              }}
              className="btn-primary px-5 py-2 text-sm whitespace-nowrap"
            >
              Accept
            </button>
          </div>
        </div>
      )}

      <SiteHeader />

      {/* Hero Section with AI Planner */}
      <HeroSection listUrl={listUrl} />

      {/* Social Proof Bar - Store Logos */}
      <StoreLogosBar />

      {/* How it works */}
      <HowItWorksSection />

      {/* Benefits Section */}
      <BenefitsSection />

      {/* Testimonials */}
      <TestimonialsSection />

      {/* FAQ Section */}
      <FAQSection />

      {/* Bottom CTA */}
      <BottomCTASection />

      <SiteFooter />
    </div>
  );
}
