import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { CheckoutRuntimePreview } from './CheckoutRuntimePreview';

export const metadata: Metadata = {
  title: 'Prepare retailer trolley — supermarket.ie',
  robots: { index: false, follow: false },
};

export default async function CheckoutRuntimePage({
  params,
  searchParams,
}: {
  params: Promise<{ retailer: string }>;
  searchParams: Promise<{ list?: string }>;
}) {
  const [{ retailer }, { list }] = await Promise.all([params, searchParams]);
  if (retailer !== 'supervalu' || !list) notFound();

  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-[70vh] w-full max-w-2xl px-4 py-10">
        <p className="text-sm font-semibold text-emerald-700">Supermarket.ie Checkout Runtime</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Your weekly shop is ready</h1>
        <p className="mt-2 mb-8 text-slate-600">Review the mapped products before opening the retailer session.</p>
        <CheckoutRuntimePreview retailer={retailer} listId={list} />
      </main>
      <SiteFooter />
    </>
  );
}
