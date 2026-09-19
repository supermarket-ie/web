import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { PlanPage } from '@/components/PlanPage';
import {
  HeroSection,
  StoreLogosBar,
  ProductProofSection,
  HowItWorksSection,
  BenefitsSection,
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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ living_shop_preview?: string }>;
}) {
  const params = await searchParams;
  const previewState = process.env.VERCEL_ENV === 'preview' && ['new', 'progress', 'ready'].includes(params.living_shop_preview ?? '')
    ? params.living_shop_preview as 'new' | 'progress' | 'ready'
    : undefined;

  return (
    <div className="min-h-screen bg-surface noise-bg">
      {previewState && <script dangerouslySetInnerHTML={{ __html: `localStorage.setItem('sm_session', JSON.stringify({token:'__cookie__',familySize:'2',email:'preview@supermarket.ie',expiresAt:Date.now()+3600000}));` }} />}
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){try{var s=localStorage.getItem('sm_session');if(s&&JSON.parse(s).token){document.documentElement.style.setProperty('--hide-marketing','none');}}catch(e){}})();
      `.trim() }} />
      <CookieBanner />
      <SiteHeader />
      <PlanPage visualPreviewState={previewState} />

      <div id="homepage-marketing" style={{ display: 'var(--hide-marketing, block)' }}>
        <HeroSection />
        <StoreLogosBar />
        <ProductProofSection />
        <HowItWorksSection />
        <BenefitsSection />
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
