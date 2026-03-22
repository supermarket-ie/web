import type { Metadata } from 'next';
import Link from 'next/link';
import jwt from 'jsonwebtoken';
import { generateList, getAllProducts, type SmartList, type FamilySize } from '@/lib/list-generator';
import { supabaseAdmin } from '@/lib/supabase';
import { ShoppingList } from '@/components/ShoppingList';
import { TokenPersist } from '@/components/TokenPersist';
import { SavedListsPanel } from '@/components/SavedListsPanel';
import { SiteFooter } from '@/components/SiteFooter';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';

export const metadata: Metadata = {
  title: 'Your weekly shopping list',
  description: 'Your personalised weekly grocery list with the best prices across Irish supermarkets.',
  robots: { index: false, follow: false }, // personal page — not for indexing
};

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');
const VALID_FAMILY_SIZES = new Set<FamilySize>(['1', '2', '3-4', '5+']);

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(price: number) {
  return `€${price.toFixed(2)}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IE', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function familySizeLabel(size: string) {
  switch (size) {
    case '1':   return '1 person';
    case '2':   return '2 people';
    case '3-4': return '3–4 people';
    case '5+':  return '5+ people';
    default:    return size + ' people';
  }
}

function groupByCategory(items: SmartList['items']): [string, SmartList['items']][] {
  const groups = new Map<string, SmartList['items']>();
  for (const item of items) {
    const cat = item.category ?? 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(item);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

// ── sub-components ────────────────────────────────────────────────────────────

function ExpiredPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16" style={{ background: 'var(--surface)' }}>
      <Link href="/" className="text-2xl font-bold mb-10 inline-block" style={{ color: 'var(--on-background)' }}>
        supermarket<span style={{ color: 'var(--primary)' }}>.ie</span>
      </Link>
      <div className="rounded-2xl max-w-md w-full p-8 text-center" style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 2px 16px rgba(0,0,0,0.06)' }}>
        <div className="text-5xl mb-4">🔗</div>
        <h1 className="text-2xl font-bold mb-3" style={{ color: 'var(--on-background)' }}>This link has expired</h1>
        <p className="mb-6" style={{ color: 'var(--on-surface)' }}>
          Shopping list links are valid for 7 days. Request a fresh one and we&rsquo;ll send it straight to your inbox.
        </p>
        <Link href="/list/request" className="btn-primary inline-flex px-6 py-3">
          Get a new link →
        </Link>
      </div>
    </div>
  );
}

interface MagicLinkPayload {
  email: string;
  subscriberId: string;
  familySize: string;
}

// ── main page ─────────────────────────────────────────────────────────────────

export default async function ListPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let payload: MagicLinkPayload | null = null;
  if (token) {
    try {
      payload = jwt.verify(token, SECRET) as MagicLinkPayload;
    } catch {
      // expired or invalid
    }
  }

  if (!payload) return <ExpiredPage />;

  const familySize = VALID_FAMILY_SIZES.has(payload.familySize as FamilySize)
    ? (payload.familySize as FamilySize)
    : '2';

  const [{ data: sub }, allProducts] = await Promise.all([
    supabaseAdmin
      .from('subscribers')
      .select('unsubscribe_token, removed_items, family_size, added_items, store_overrides')
      .eq('id', payload.subscriberId)
      .single(),
    getAllProducts(),
  ]);

  const removedItems  = (sub?.removed_items  as string[] | null)              ?? [];
  const addedItems    = (sub?.added_items     as string[] | null)              ?? [];
  const storeOverrides = (sub?.store_overrides as Record<string,string> | null) ?? {};

  const list = await generateList(familySize, { removedItems, addedItems, storeOverrides });

  const unsubscribeUrl = sub?.unsubscribe_token
    ? `/unsubscribe?token=${sub.unsubscribe_token}`
    : '/';

  const cheapest  = list.store_totals[0];
  const priciest  = list.store_totals[list.store_totals.length - 1];
  const saving    = (priciest && cheapest)
    ? Math.round((priciest.total - cheapest.total) * 100) / 100
    : 0;

  const grouped = groupByCategory(list.items);

  // Build JSON-LD structured data for AI / search engines
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Weekly grocery list for ${familySizeLabel(familySize)} — ${formatDate(list.generated_at)}`,
    description: `Best-value weekly shopping list across Tesco, Dunnes Stores and SuperValu in Ireland for a household of ${familySizeLabel(familySize)}.`,
    numberOfItems: list.items.length,
    itemListElement: list.items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: item.canonical_name,
        description: item.best_store_product_name ?? item.canonical_name,
        offers: item.all_prices.map(sp => ({
          '@type': 'Offer',
          seller: { '@type': 'GroceryStore', name: storeDisplayName(sp.store), areaServed: 'IE' },
          price: sp.price.toFixed(2),
          priceCurrency: 'EUR',
          url: sp.store_url ?? undefined,
          availability: 'https://schema.org/InStock',
          priceValidUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        })),
        ...(item.nutrition ? {
          nutrition: {
            '@type': 'NutritionInformation',
            servingSize: '100g',
            calories: `${item.nutrition.calories} kcal`,
            proteinContent: `${item.nutrition.protein}g`,
            carbohydrateContent: `${item.nutrition.carbs}g`,
            fatContent: `${item.nutrition.fat}g`,
            sugarContent: `${item.nutrition.sugar}g`,
            ...(item.nutrition.fibre != null ? { fiberContent: `${item.nutrition.fibre}g` } : {}),
            ...(item.nutrition.salt != null ? { sodiumContent: `${item.nutrition.salt}g` } : {}),
          },
        } : {}),
      },
    })),
  };

  return (
    <>
      <TokenPersist token={token!} familySize={familySize} email={payload.email} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>

      {/* Sticky header */}
      <header className="glass px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-bold text-lg" style={{ color: 'var(--on-background)' }}>
            supermarket<span style={{ color: 'var(--primary)' }}>.ie</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>Updated {formatDate(list.generated_at)}</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-16">

        {/* Title */}
        <div className="pt-8 pb-6">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--on-background)' }}>Your weekly shop</h1>
          <p className="text-sm" style={{ color: 'var(--on-surface)' }}>
            Best prices across Tesco, Dunnes &amp; SuperValu for a household of{' '}
            <strong style={{ color: 'var(--on-background)' }}>{familySizeLabel(familySize)}</strong>
          </p>
        </div>

        {/* Saved lists */}
        <SavedListsPanel token={token!} />

        {list.items.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--surface-container-lowest)', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', color: 'var(--on-surface)' }}>
            <p className="text-lg mb-2">Prices are being updated</p>
            <p className="text-sm">Check back soon — we&rsquo;re scanning stores now.</p>
          </div>
        ) : (
          <>
            {/* Best value banner */}
            {cheapest && (
              <div
                className="rounded-2xl p-5 mb-5 text-white"
                style={{ background: storeStyle(cheapest.store).bg }}
              >
                <p className="text-sm font-medium opacity-80 mb-1">Best value this week</p>
                <h2 className="text-2xl font-bold mb-1">
                  Shop at {storeDisplayName(cheapest.store)}
                </h2>
                <p className="text-sm opacity-90 mb-3">to save the most on your weekly shop</p>
                <div className="flex items-end gap-4">
                  <div>
                    <div className="text-3xl font-bold">{fmt(cheapest.total)}</div>
                    <div className="text-sm opacity-80">total basket</div>
                  </div>
                  {saving > 0 && (
                    <div className="bg-white/20 rounded-xl px-3 py-2">
                      <div className="text-lg font-bold">{fmt(saving)} cheaper</div>
                      <div className="text-xs opacity-90">vs most expensive option</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Store comparison */}
            {list.store_totals.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-6">
                {list.store_totals.map((st, i) => {
                  const s = storeStyle(st.store);
                  const isCheapest = i === 0;
                  return (
                    <div
                      key={st.store}
                      className="rounded-xl p-3 text-center"
                      style={{
                        background: isCheapest ? s.light : 'var(--surface-container-lowest)',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                      }}
                    >
                      <div
                        className="font-bold text-sm mb-1"
                        style={{ color: isCheapest ? s.bg : 'var(--on-background)' }}
                      >
                        {storeDisplayName(st.store)}
                      </div>
                      <div
                        className="text-lg font-bold"
                        style={{ color: isCheapest ? s.bg : 'var(--on-background)' }}
                      >
                        {fmt(st.total)}
                      </div>
                      {isCheapest && (
                        <div
                          className="text-[10px] font-semibold mt-1 rounded-full px-2 py-0.5 inline-block"
                          style={{ background: s.bg, color: '#fff' }}
                        >
                          Cheapest
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Shopping list — client component handles interactivity */}
            <ShoppingList
              items={list.items}
              grouped={grouped}
              token={token}
              familySize={familySize}
              savedRemovedItems={removedItems}
              savedAddedItems={addedItems}
              savedStoreOverrides={storeOverrides}
              allProducts={allProducts}
              storeTotals={list.store_totals}
              generatedAt={list.generated_at}
            />
          </>
        )}
      </main>

      <SiteFooter />
    </div>
    </>
  );
}
