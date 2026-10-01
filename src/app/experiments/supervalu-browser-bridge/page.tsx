import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { buildSupervaluBrowserBridgeUrl } from '@/lib/shopping/retailer-handoff/supervalu-browser-bridge';

export const dynamic = 'force-dynamic';

export default async function SupervaluBrowserBridgeExperimentPage() {
  if (process.env.VERCEL_ENV === 'production') notFound();

  const { data, error } = await supabaseAdmin
    .from('store_products')
    .select('store_product_name, store_sku, store_url')
    .eq('store', 'supervalu')
    .eq('url_status', 'resolved')
    .not('store_sku', 'is', null)
    .like('store_url', '%/rsid/%/product/%')
    .limit(3);

  if (error || !data?.length) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold">SuperValu browser bridge</h1>
        <p className="mt-4 text-sm text-muted-foreground">No mapped SuperValu products were available for the proof of concept.</p>
      </main>
    );
  }

  const items = data
    .filter((row) => row.store_sku && row.store_url)
    .map((row) => ({
      sku: row.store_sku as string,
      quantity: 1,
      name: row.store_product_name ?? undefined,
      productUrl: row.store_url as string,
    }));

  if (!items.length) notFound();

  const handoffUrl = buildSupervaluBrowserBridgeUrl(items);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">Preview experiment · not available in production</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">SuperValu browser basket handoff</h1>
      <p className="mt-4 text-base leading-7 text-muted-foreground">
        This proof of concept sends three mapped products into the shopper&apos;s own SuperValu browser session. The shopper signs in directly with SuperValu; Supermarket.ie does not receive retailer credentials or payment details.
      </p>

      <div className="mt-8 rounded-2xl border p-5">
        <h2 className="font-semibold">Test basket</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {items.map((item) => (
            <li key={item.sku} className="flex justify-between gap-4">
              <span>{item.name || item.sku}</span>
              <span className="text-muted-foreground">x1</span>
            </li>
          ))}
        </ul>
      </div>

      <a
        className="mt-6 inline-flex rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background"
        href={handoffUrl}
      >
        Shop this basket at SuperValu
      </a>

      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        Requires the local Supermarket.ie SuperValu Cart Bridge proof-of-concept extension from experiments/supervalu-browser-bridge. The bridge only has host access to shop.supervalu.ie and drives SuperValu&apos;s visible Add to Trolley control.
      </p>
    </main>
  );
}
