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
    default: 'Supermarket.ie — Your AI Grocery Agent for Ireland',
    template: '%s | Supermarket.ie',
  },
  description:
    'Ask a grocery question and get a useful answer grounded in current Irish supermarket prices and ingredient data. Compare products and plan a smarter weekly shop.',
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
  applicationName: 'Supermarket.ie',
  authors: [{ name: 'Supermarket.ie', url: BASE_URL }],
  creator: 'Supermarket.ie',
  publisher: 'Supermarket.ie',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: 'website',
    locale: 'en_IE',
    url: BASE_URL,
    siteName: 'Supermarket.ie',
    title: 'Supermarket.ie — Your AI Grocery Agent for Ireland',
    description:
      'Ask a grocery question and get a useful answer grounded in current Irish supermarket prices and ingredient data.',
    images: [
      {
        url: '/og.jpg',
        width: 1200,
        height: 630,
        alt: 'Supermarket.ie — Your AI Grocery Agent for Ireland',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Supermarket.ie — Your AI Grocery Agent for Ireland',
    description: 'Current prices, ingredient intelligence and smarter weekly shops across Ireland.',
    images: ['/og.jpg'],
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
              name: 'Supermarket.ie',
              alternateName: ['Supermarket IE', 'Supermarket Ireland'],
              url: BASE_URL,
              description:
                'Ireland\'s AI grocery agent, grounded in current supermarket prices and ingredient data.',
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
                name: 'Supermarket.ie',
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
