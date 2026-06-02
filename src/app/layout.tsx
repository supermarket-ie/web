import type { Metadata } from 'next';
import Script from 'next/script';
import { Geist, Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { AppShell } from '@/components/AppShell';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: '--font-plus-jakarta',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
});

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.supermarket.ie').trim();

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'supermarket.ie — Ireland\'s smartest grocery list',
    template: '%s | supermarket.ie',
  },
  description:
    'Free weekly grocery lists with the best prices across Tesco, Dunnes Stores, SuperValu, Lidl and Aldi in Ireland. Save €1,200+ per year. Join 2,400+ Irish households.',
  keywords: [
    'Ireland grocery prices',
    'cheapest supermarket Ireland',
    'Irish grocery comparison',
    'Tesco Ireland prices',
    'Dunnes Stores prices',
    'SuperValu prices',
    'Lidl Ireland',
    'Aldi Ireland',
    'weekly shopping list Ireland',
    'grocery savings Ireland',
    'supermarket.ie',
  ],
  authors: [{ name: 'supermarket.ie', url: BASE_URL }],
  creator: 'supermarket.ie',
  publisher: 'supermarket.ie',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: 'website',
    locale: 'en_IE',
    url: BASE_URL,
    siteName: 'supermarket.ie',
    title: 'supermarket.ie — Ireland\'s smartest grocery list',
    description:
      'Free weekly grocery lists with the best prices across Tesco, Dunnes, SuperValu, Lidl and Aldi. Save €1,200+ per year.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'supermarket.ie — Ireland\'s smartest grocery list',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'supermarket.ie — Ireland\'s smartest grocery list',
    description: 'Free weekly grocery lists with the best prices across Irish supermarkets.',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: BASE_URL,
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: { url: '/apple-icon.png', sizes: '180x180' },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IE">
      <head>
        {/* Structured data: Website + SearchAction for AI/search */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'supermarket.ie',
              alternateName: 'Supermarket Ireland',
              url: BASE_URL,
              description:
                'Ireland\'s AI-powered grocery price comparison platform. Weekly shopping lists with the best prices across Tesco, Dunnes Stores, SuperValu, Lidl and Aldi.',
              potentialAction: {
                '@type': 'SearchAction',
                target: {
                  '@type': 'EntryPoint',
                  urlTemplate: `${BASE_URL}/api/products?q={search_term_string}`,
                },
                'query-input': 'required name=search_term_string',
              },
              publisher: {
                '@type': 'Organization',
                name: 'supermarket.ie',
                url: BASE_URL,
                logo: {
                  '@type': 'ImageObject',
                  url: `${BASE_URL}/icon.png`,
                },
                contactPoint: {
                  '@type': 'ContactPoint',
                  email: 'hello@supermarket.ie',
                  contactType: 'customer support',
                  areaServed: 'IE',
                  availableLanguage: 'English',
                },
                areaServed: {
                  '@type': 'Country',
                  name: 'Ireland',
                },
              },
            }),
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${plusJakartaSans.variable} antialiased`}>
        <AppShell>
          {children}
        </AppShell>
        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-8107ZXC1P5"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-8107ZXC1P5');
          `}
        </Script>
      </body>
    </html>
  );
}
