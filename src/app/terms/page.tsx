import Link from "next/link";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header */}
      <header className="px-6 py-4 flex justify-between items-center max-w-6xl mx-auto">
        <Link href="/" className="text-2xl font-bold text-[#1B4D3E]">
          supermarket<span className="text-[#FF6B5B]">.ie</span>
        </Link>
        <nav className="hidden md:flex gap-8 text-gray-600">
          <Link href="/" className="hover:text-[#1B4D3E] transition">
            Home
          </Link>
        </nav>
      </header>

      {/* Content */}
      <main className="px-6 py-16 max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-[#1A1A1A] mb-8">Terms of Service</h1>
        <p className="text-gray-600 mb-8">Last updated: February 2026</p>

        <div className="prose prose-lg max-w-none text-gray-700 space-y-8">
          <section>
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">1. Agreement to Terms</h2>
            <p>
              By accessing or using supermarket.ie, you agree to be bound by these Terms of Service and our Privacy Policy. 
              If you do not agree to these terms, please do not use our service.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">2. Description of Service</h2>
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
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">3. User Accounts</h2>
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
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">4. Acceptable Use</h2>
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
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">5. Intellectual Property</h2>
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
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">6. Disclaimer of Warranties</h2>
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
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">7. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by Irish law, supermarket.ie shall not be liable for any indirect, 
              incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether 
              incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">8. Third-Party Links</h2>
            <p>
              Our service may contain links to third-party websites or services that are not owned or controlled by 
              supermarket.ie. We have no control over, and assume no responsibility for, the content, privacy policies, 
              or practices of any third-party websites or services.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">9. Termination</h2>
            <p>
              We may terminate or suspend your access to our service immediately, without prior notice or liability, 
              for any reason whatsoever, including without limitation if you breach these Terms.
            </p>
            <p className="mt-4">
              You may also terminate your account at any time by unsubscribing from our emails or contacting us directly.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">10. Changes to Terms</h2>
            <p>
              We reserve the right to modify or replace these Terms at any time. If a revision is material, we will 
              provide at least 30 days&apos; notice prior to any new terms taking effect. What constitutes a material 
              change will be determined at our sole discretion.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">11. Governing Law</h2>
            <p>
              These Terms shall be governed and construed in accordance with the laws of Ireland, without regard to 
              its conflict of law provisions. Any disputes arising from these Terms shall be subject to the exclusive 
              jurisdiction of the courts of Ireland.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-[#1A1A1A] mb-4">12. Contact Us</h2>
            <p>
              If you have any questions about these Terms of Service, please contact us at:
            </p>
            <p className="mt-4">
              <strong>Email:</strong> legal@supermarket.ie<br />
              <strong>Address:</strong> supermarket.ie, Ireland
            </p>
          </section>
        </div>
      </main>

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
