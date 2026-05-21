import type { Metadata } from 'next';
import Link from "next/link";
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Privacy Policy · supermarket.ie',
  description: 'How supermarket.ie collects, uses, and protects your personal data under GDPR and Irish data protection law.',
};

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <SiteHeader />

      <main className="px-6 py-16 max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8" style={{ color: 'var(--on-background)' }}>Privacy Policy</h1>
        <p className="mb-8" style={{ color: 'var(--on-surface)' }}>Last updated: February 2026</p>

        <div className="prose prose-lg max-w-none space-y-8" style={{ color: 'var(--on-surface)' }}>
          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>1. Introduction</h2>
            <p>
              Welcome to supermarket.ie. We respect your privacy and are committed to protecting your personal data. 
              This privacy policy explains how we collect, use, and safeguard your information when you use our service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>2. Information We Collect</h2>
            <p>We collect the following types of information:</p>
            <ul className="list-disc pl-6 mt-4 space-y-2">
              <li><strong>Email address:</strong> To send you your personalised shopping lists and service updates.</li>
              <li><strong>Household size:</strong> To customize your shopping recommendations.</li>
              <li><strong>Usage data:</strong> Anonymous analytics to improve our service.</li>
              <li><strong>Cookies:</strong> To remember your preferences and improve site functionality.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>3. How We Use Your Information</h2>
            <p>We use your information to:</p>
            <ul className="list-disc pl-6 mt-4 space-y-2">
              <li>Send you weekly personalised shopping lists</li>
              <li>Improve and personalize our service</li>
              <li>Communicate important updates about our service</li>
              <li>Analyze usage patterns to enhance user experience</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>4. Data Sharing</h2>
            <p>
              We do not sell, trade, or rent your personal information to third parties. We may share anonymized, 
              aggregated data for analytics purposes. We may use trusted service providers (e.g., email delivery services) 
              who process data on our behalf under strict confidentiality agreements.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>5. Cookies</h2>
            <p>
              We use cookies to enhance your experience on our site. Cookies are small text files stored on your device 
              that help us remember your preferences and understand how you use our service. You can control cookie 
              settings through your browser preferences.
            </p>
            <p className="mt-4">We use the following types of cookies:</p>
            <ul className="list-disc pl-6 mt-4 space-y-2">
              <li><strong>Essential cookies:</strong> Required for the site to function properly.</li>
              <li><strong>Analytics cookies:</strong> Help us understand how visitors use our site.</li>
              <li><strong>Preference cookies:</strong> Remember your settings and choices.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>6. Data Security</h2>
            <p>
              We implement appropriate technical and organizational measures to protect your personal data against 
              unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over 
              the Internet is 100% secure.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>7. Your Rights</h2>
            <p>Under GDPR and Irish data protection law, you have the right to:</p>
            <ul className="list-disc pl-6 mt-4 space-y-2">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data</li>
              <li>Object to processing of your data</li>
              <li>Data portability</li>
              <li>Withdraw consent at any time</li>
            </ul>
            <p className="mt-4">
              To exercise any of these rights, please contact us at privacy@supermarket.ie.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>8. Data Retention</h2>
            <p>
              We retain your personal data only for as long as necessary to provide our services to you, or as required 
              by law. If you unsubscribe from our service, we will delete your data within 30 days unless we are legally 
              required to retain it.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>9. Changes to This Policy</h2>
            <p>
              We may update this privacy policy from time to time. We will notify you of any significant changes by 
              posting the new policy on this page and updating the &quot;Last updated&quot; date.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>10. Contact Us</h2>
            <p>
              If you have any questions about this privacy policy or our data practices, please contact us at:
            </p>
            <p className="mt-4">
              <strong>Email:</strong> privacy@supermarket.ie<br />
              <strong>Company:</strong> Gosuper Ltd, Company No. 700162, Ireland
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
