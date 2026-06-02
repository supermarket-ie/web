import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PlanPage } from '@/components/PlanPage';
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

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();

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
      <CookieBanner />
      <SiteHeader />

      {/* Signed-in: just the planner, no marketing content */}
      <PlanPage />

      {/* Signed-out: full marketing homepage (PlanPage renders null when signed in) */}
      <div id="homepage-marketing">
        <HeroSection />
        <StoreLogosBar />
        <HowItWorksSection />
        <BenefitsSection />
        <TestimonialsSection />
        <FAQSection />
        <BottomCTASection />
      </div>

      <SiteFooter />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </div>
  );
}
