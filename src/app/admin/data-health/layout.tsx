import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Retailer data health',
  robots: { index: false, follow: false },
};

export default function DataHealthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
