import type { Metadata } from 'next';
import { LivingShopPrototype } from '@/components/LivingShopPrototype';

export const metadata: Metadata = {
  title: 'Living Shop concept',
  robots: { index: false, follow: false },
};

export default function LivingShopPreviewPage() {
  return <LivingShopPrototype />;
}
