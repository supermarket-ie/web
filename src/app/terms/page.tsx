import type { Metadata } from 'next';
import Link from "next/link";
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Terms of Service · supermarket.ie',
  description: 'Terms and conditions for using supermarket.ie, Ireland\'s AI grocery planning and price comparison service.',
};

export default function TermsOfService() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <SiteHeader />

      <main className="px-6 py-16 max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8" style={{ color: 'var(--on-background)' }}>Terms of Service</h1>
        <p className="mb-8" style={{ color: 'var(--on-surface)' }}>Last updated: February 2026</p>

        <div className="prose prose-lg max-w-none space-y-8" style={{ color: 'var(--on-surface)' }}>
          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>1. Agreement to Terms</h2>
            <p>
              By accessing or using supermarket.ie, you agree to be bound by these Terms of Service and our Privacy Policy. 
              If you do not agree to these terms, please do not use our service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>2. Description of Service</h2>
            <p>
              supermarket.ie provides personalised weekly shopping lists designed to help Irish families shop smarter. 
              Our service aggregates grocery information and provides recommendations based on your household preferences.
            </p>
            <p className="mt-4">
              The information we provide is for general informational purposes only. Prices, availability, and promotions 
              are subject to change and may vary by store location.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>3. User Accounts</h2>
            <p>
              To use our service, you must provide a valid email address. You are responsible for maintaining the 
              confidentiality of your account information and for all activities that occur under your account.
            </p>
            <p className="mt-4">You agree to:</p>
            <ul className="list-disc pl-6 mt-4 space-y-2">
              <li>Provide accurate and complete information</li>
              <li>Update your information if it changes</li>
              <li>Not share your account with others</li>
              <li>Notify us immediately of any unauthorized use of your account</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 mt-4 space-y-2">
              <li>Use our service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to our systems</li>
              <li>Interfere with or disrupt our service</li>
              <li>Scrape, harvest, or collect data from our service without permission</li>
              <li>Use automated systems or software to access our service</li>
              <li>Impersonate any person or entity</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>5. Intellectual Property</h2>
            <p>
              All content, features, and functionality of supermarket.ie, including but not limited to text, graphics, 
              logos, and software, are the property of supermarket.ie and are protected by Irish and international 
              copyright, trademark, and other intellectual property laws.
            </p>
            <p className="mt-4">
              You may not reproduce, distribute, modify, or create derivative works from any content on our site 
              without our express written permission.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>6. Disclaimer of Warranties</h2>
            <p>
              Our service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, either express or implied. 
              We do not guarantee that:
            </p>
            <ul className="list-disc pl-6 mt-4 space-y-2">
              <li>The service will be uninterrupted or error-free</li>
              <li>The information provided is accurate, complete, or current</li>
              <li>Any particular savings will be achieved</li>
              <li>Products recommended will be available at any particular store</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>7. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by Irish law, supermarket.ie shall not be liable for any indirect, 
              incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether 
              incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>8. Third-Party Links</h2>
            <p>
              Our service may contain links to third-party websites or services that are not owned or controlled by 
              supermarket.ie. We have no control over, and assume no responsibility for, the content, privacy policies, 
              or practices of any third-party websites or services.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>9. Termination</h2>
            <p>
              We may terminate or suspend your access to our service immediately, without prior notice or liability, 
              for any reason whatsoever, including without limitation if you breach these Terms.
            </p>
            <p className="mt-4">
              You may also terminate your account at any time by unsubscribing from our emails or contacting us directly.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>10. Changes to Terms</h2>
            <p>
              We reserve the right to modify or replace these Terms at any time. If a revision is material, we will 
              provide at least 30 days&apos; notice prior to any new terms taking effect. What constitutes a material 
              change will be determined at our sole discretion.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>11. Governing Law</h2>
            <p>
              These Terms shall be governed and construed in accordance with the laws of Ireland, without regard to 
              its conflict of law provisions. Any disputes arising from these Terms shall be subject to the exclusive 
              jurisdiction of the courts of Ireland.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--on-background)' }}>12. Contact Us</h2>
            <p>
              If you have any questions about these Terms of Service, please contact us at:
            </p>
            <p className="mt-4">
              <strong>Email:</strong> legal@supermarket.ie<br />
              <strong>Company:</strong> Gosuper Ltd, Company No. 700162, Ireland
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
