import { notFound } from 'next/navigation';

export const metadata = { robots: { index: false, follow: false } };

/** Preview-only viewport harness: exercises the actual homepage, agent and
 * registration controls at phone width without fixtures or authentication. */
export default function GuestShopMobilePreview() {
  if (process.env.VERCEL_ENV !== 'preview') notFound();
  return (
    <main className="min-h-screen bg-[#eaf1ec] p-6">
      <h1 className="mb-2 text-lg font-semibold">Guest shop · mobile layout check</h1>
      <p className="mb-5 text-sm">Live homepage at 390 × 844. Requests use the real guest agent.</p>
      <iframe title="Supermarket.ie mobile homepage" src="/" width="390" height="844" className="max-w-full rounded-2xl border border-[#c9d6ce] bg-white" />
    </main>
  );
}
