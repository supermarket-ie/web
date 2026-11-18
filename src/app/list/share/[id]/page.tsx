import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { SiteFooter } from '@/components/SiteFooter';
import { sanitizeStoreTotals } from '@/lib/saved-list-sanitize';

function fmt(price: number) { return `€${price.toFixed(2)}`; }

function storeDisplayName(store: string) {
  const s = store.toLowerCase();
  if (s.includes('tesco'))     return 'Tesco';
  if (s.includes('dunnes'))    return 'Dunnes Stores';
  if (s.includes('supervalu')) return 'SuperValu';
  return store;
}

function storeStyle(store: string) {
  const s = store.toLowerCase();
  if (s.includes('tesco'))     return { bg: '#003A8C', light: '#EEF3FB', border: '#003A8C' };
  if (s.includes('dunnes'))    return { bg: '#7B0017', light: '#FAEAEC', border: '#7B0017' };
  if (s.includes('supervalu')) return { bg: '#D4400F', light: '#FEF0E8', border: '#D4400F' };
  return { bg: '#636E72', light: '#F5F5F5', border: '#636E72' };
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

function groupByCategory(items: SharedItem[]): [string, SharedItem[]][] {
  const groups = new Map<string, SharedItem[]>();
  for (const item of items) {
    const cat = item.category ?? 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(item);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

interface StorePrice { store: string; price: number; store_product_name: string; }
interface SharedItem {
  canonical_name: string;
  category: string | null;
  best_store: string;
  best_price: number;
  all_prices: StorePrice[];
  price_comparison?: string;
}
interface StoreTotal { store: string; total: number; }

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { data } = await supabaseAdmin.from('shared_lists').select('store_totals,family_size,generated_at').eq('id', id).single();
  if (!data) return { title: 'Shopping List | supermarket.ie' };

  // Only verified-exact basket totals support a "best price" claim (legacy totals compared unverified products).
  const totals: StoreTotal[] = sanitizeStoreTotals(data.store_totals, data.generated_at);
  const cheapest = totals[0];
  const desc = cheapest
    ? `Weekly shop for ${familySizeLabel(data.family_size)} — ${storeDisplayName(cheapest.store)} ${fmt(cheapest.total)}, cheapest of ${totals.map(t => storeDisplayName(t.store)).join(' & ')} (verified exact matches)`
    : 'Weekly grocery list with live prices from Irish supermarkets';

  return {
    title: `Weekly shopping list | supermarket.ie`,
    description: desc,
    openGraph: {
      title: 'My weekly shopping list — supermarket.ie',
      description: desc,
      url: `https://supermarket.ie/list/share/${id}`,
    },
    twitter: {
      card: 'summary',
      title: 'My weekly shopping list — supermarket.ie',
      description: desc,
    },
  };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from('shared_lists')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) notFound();

  const items = data.items as SharedItem[];
  const storeTotals: StoreTotal[] = sanitizeStoreTotals(data.store_totals, data.generated_at);
  const cheapest = storeTotals[0];
  const priciest = storeTotals[storeTotals.length - 1];
  const saving = cheapest && priciest ? Math.round((priciest.total - cheapest.total) * 100) / 100 : 0;
  const grouped = groupByCategory(items);

  return (
    <div className="min-h-screen" style={{ background: '#F9F6F5' }}>
      {/* Header */}
      <header className="px-4 py-4 border-b border-[#E8E2DC] bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-bold text-lg text-[#1D2324]">
            supermarket<span className="text-[#006A35]">.ie</span>
          </Link>
          <Link
            href="/"
            className="text-xs px-3 py-1.5 rounded-full font-semibold transition text-[#004a23]" style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
          >
            Build my list →
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-16">
        <div className="pt-8 pb-4">
          <h1 className="text-2xl font-bold text-[#1D2324] mb-1">Weekly shopping list</h1>
          <p className="text-[#636E72] text-sm">
            For a household of <strong className="text-[#1D2324]">{familySizeLabel(data.family_size)}</strong>
            {' '}· {items.length} items
          </p>
        </div>

        {/* Best value banner */}
        {cheapest && (
          <div
            className="rounded-2xl p-5 mb-5 text-white"
            style={{ background: storeStyle(cheapest.store).bg }}
          >
            <p className="text-sm font-medium opacity-80 mb-1">Cheapest of {storeTotals.map(t => storeDisplayName(t.store)).join(' & ')} · verified exact matches</p>
            <h2 className="text-2xl font-bold mb-1">Shop at {storeDisplayName(cheapest.store)}</h2>
            <div className="flex items-end gap-4 mt-2">
              <div>
                <div className="text-3xl font-bold">{fmt(cheapest.total)}</div>
                <div className="text-sm opacity-80">total basket</div>
              </div>
              {saving > 0 && (
                <div className="bg-white/20 rounded-xl px-3 py-2">
                  <div className="text-lg font-bold">{fmt(saving)} cheaper</div>
                  <div className="text-xs opacity-90">vs {storeDisplayName(storeTotals[storeTotals.length - 1].store)}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Store comparison */}
        {storeTotals.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-6">
            {storeTotals.map((st, i) => {
              const style = storeStyle(st.store);
              const isCheapest = i === 0;
              return (
                <div
                  key={st.store}
                  className="rounded-xl p-3 border-2 text-center"
                  style={{ borderColor: isCheapest ? style.border : '#E8E2DC', background: isCheapest ? style.light : '#fff' }}
                >
                  <div className="font-bold text-sm mb-1" style={{ color: isCheapest ? style.bg : '#1D2324' }}>
                    {storeDisplayName(st.store)}
                  </div>
                  <div className="text-lg font-bold" style={{ color: isCheapest ? style.bg : '#1D2324' }}>
                    {fmt(st.total)}
                  </div>
                  {isCheapest && (
                    <div className="text-[10px] font-semibold mt-1 rounded-full px-2 py-0.5 inline-block text-white" style={{ background: style.bg }}>
                      Cheapest verified
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {storeTotals.length > 0 && (
          <p className="-mt-4 mb-6 text-xs text-[#5c675f]">Only these stores are compared: every item is an independently verified exact match at each of them. Other stores’ prices are not verified as the same products.</p>
        )}

        {/* Shopping list */}
        <div className="space-y-4">
          {grouped.map(([category, catItems]) => (
            <div key={category}>
              <h3 className="text-xs font-bold text-[#636E72] uppercase tracking-widest mb-2 px-1">{category}</h3>
              <div className="bg-white rounded-2xl border border-[#E8E2DC] divide-y divide-[#F5F0EB]">
                {catItems.map(item => (
                  <div key={item.canonical_name} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#1D2324] truncate">{item.canonical_name}</div>
                      <div className="text-xs text-[#636E72] mt-0.5">
                        {item.price_comparison === 'verified_exact' ? 'Best' : 'Lowest price'}: {storeDisplayName(item.best_store)}
                        {item.all_prices?.length > 1 && (
                          <span className="ml-2 text-[#B2BEC3]">
                            {item.all_prices.map(p => `${storeDisplayName(p.store)} ${p.store_product_name ? `${p.store_product_name} ` : ''}${fmt(p.price)}`).join(' · ')}
                          </span>
                        )}
                        {item.all_prices?.length > 1 && item.price_comparison !== 'verified_exact' && (
                          <span className="block text-[10px] text-[#82591a]">Indicative — these stores’ products are not verified as the same item.</span>
                        )}
                      </div>
                    </div>
                    <div className="text-sm font-bold text-[#1D2324] flex-shrink-0">{fmt(item.best_price)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-8 rounded-2xl p-6 text-center" style={{ background: '#EAE7E7' }}>
          <div className="text-2xl mb-2">🛒</div>
          <h3 className="font-bold text-[#2F2F2E] mb-1">Build your own list</h3>
          <p className="text-sm text-[#5c5b5b] mb-4">Tell our AI what you want to cook and get a personalised list with live prices from Tesco, Dunnes &amp; SuperValu.</p>
          <Link
            href="/"
            className="inline-block px-6 py-3 rounded-full font-semibold transition text-[#004a23]"
            style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
          >
            Try supermarket.ie free →
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
