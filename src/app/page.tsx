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
import { CookieBanner } from '@/components/homepage/CookieBanner';
import { faqs } from '@/components/homepage/FAQSection';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://supermarket.ie';

// FAQPage structured data — built from the same faqs array rendered on page
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer,
    },
  })),
};

export const metadata = {
  alternates: { canonical: BASE_URL },
};

export default function Home() {
  return (
    <div className="min-h-screen bg-surface noise-bg">
      {/* Cookie banner — client island, checks localStorage */}
      <CookieBanner />

      <SiteHeader />

      {/* Hero Section with AI Planner */}
      <HeroSection />

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

      {/* FAQPage structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </div>
  );
}
