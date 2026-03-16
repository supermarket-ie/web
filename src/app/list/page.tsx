import Link from 'next/link';
import jwt from 'jsonwebtoken';
import { generateList, type SmartList, type FamilySize, type ListItem } from '@/lib/list-generator';
import { supabaseAdmin } from '@/lib/supabase';

const SECRET = process.env.MAGIC_LINK_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VALID_FAMILY_SIZES = new Set<FamilySize>(['1', '2', '3-4', '5+']);

// ── helpers ────────────────────────────────────────────────────────────────

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

function storeDisplayName(store: string) {
  const s = store.toLowerCase();
  if (s.includes('tesco'))     return 'Tesco';
  if (s.includes('dunnes'))    return 'Dunnes';
  if (s.includes('supervalu')) return 'SuperValu';
  return store;
}

function storeStyle(store: string): { bg: string; text: string; border: string; light: string } {
  const s = store.toLowerCase();
  if (s.includes('tesco'))     return { bg: '#003A8C', text: '#fff', border: '#003A8C', light: '#EEF3FB' };
  if (s.includes('dunnes'))    return { bg: '#7B0017', text: '#fff', border: '#7B0017', light: '#FAEAEC' };
  if (s.includes('supervalu')) return { bg: '#D4400F', text: '#fff', border: '#D4400F', light: '#FEF0E8' };
  return { bg: '#636E72', text: '#fff', border: '#636E72', light: '#F5F5F5' };
}

function groupByCategory(items: ListItem[]): [string, ListItem[]][] {
  const groups = new Map<string, ListItem[]>();
  for (const item of items) {
    const cat = item.category ?? 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(item);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

// ── sub-components ─────────────────────────────────────────────────────────

function ExpiredPage() {
  return (
    <div className="min-h-screen bg-[#FFFBF7] flex flex-col items-center justify-center px-6 py-16">
      <Link href="/" className="text-2xl font-bold text-[#1D2324] mb-10 inline-block">
        supermarket<span className="text-[#E17055]">.ie</span>
      </Link>
      <div className="bg-white rounded-2xl shadow-sm border border-[#E8E2DC] max-w-md w-full p-8 text-center">
        <div className="text-5xl mb-4">🔗</div>
        <h1 className="text-2xl font-bold text-[#1D2324] mb-3">This link has expired</h1>
        <p className="text-[#636E72] mb-6">
          Shopping list links are valid for 7 days. Request a fresh one and we&rsquo;ll send it straight to your inbox.
        </p>
        <Link
          href="/list/request"
          className="inline-block bg-[#E17055] text-white px-6 py-3 rounded-xl font-semibold hover:bg-[#D4604A] transition"
        >
          Get a new link →
        </Link>
      </div>
    </div>
  );
}

function StoreBadge({ store, small = false }: { store: string; small?: boolean }) {
  const style = storeStyle(store);
  return (
    <span
      className={`inline-block font-semibold rounded-md ${small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'}`}
      style={{ background: style.bg, color: style.text }}
    >
      {storeDisplayName(store)}
    </span>
  );
}

function ProductRow({ item }: { item: ListItem }) {
  return (
    <div className="py-3 border-b border-[#F0ECE8] last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span className="font-medium text-[#1D2324] text-sm leading-snug">
            {item.canonical_name}
            {item.quantity > 1 && (
              <span className="text-[#636E72] font-normal ml-1">×{item.quantity}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StoreBadge store={item.best_store} small />
          <span className="font-semibold text-[#1D2324] text-sm">
            {item.quantity > 1
              ? `${fmt(item.best_price_total)} (${fmt(item.best_price)} ea)`
              : fmt(item.best_price)}
          </span>
        </div>
      </div>
      {item.all_prices.length > 1 && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {item.all_prices.map((sp) => {
              const name = storeDisplayName(sp.store);
              const abbr = name === 'SuperValu' ? 'SV' : name.slice(0, 1);
              return (
                <span key={sp.store} className="text-[11px] text-[#636E72]">
                  <span className="font-medium" style={{ color: storeStyle(sp.store).bg }}>
                    {abbr}
                  </span>
                  {' '}{fmt(sp.price)}
                  {sp.store === item.best_store && (
                    <span className="text-[#5D9B8F] ml-0.5">✓</span>
                  )}
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ── main page ──────────────────────────────────────────────────────────────

interface MagicLinkPayload {
  email: string;
  subscriberId: string;
  familySize: string;
}

export default async function ListPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  // Verify JWT
  let payload: MagicLinkPayload | null = null;
  if (token) {
    try {
      payload = jwt.verify(token, SECRET) as MagicLinkPayload;
    } catch {
      // expired or invalid
    }
  }

  if (!payload) {
    return <ExpiredPage />;
  }

  const familySize = VALID_FAMILY_SIZES.has(payload.familySize as FamilySize)
    ? (payload.familySize as FamilySize)
    : '2';

  // Fetch list data + subscriber unsubscribe token in parallel
  const [list, { data: sub }] = await Promise.all([
    generateList(familySize),
    supabaseAdmin
      .from('subscribers')
      .select('unsubscribe_token')
      .eq('id', payload.subscriberId)
      .single(),
  ]);

  const unsubscribeUrl = sub?.unsubscribe_token
    ? `/unsubscribe?token=${sub.unsubscribe_token}`
    : '/';

  const cheapest = list.store_totals[0];
  const mostExpensive = list.store_totals[list.store_totals.length - 1];
  const saving = mostExpensive && cheapest
    ? Math.round((mostExpensive.total - cheapest.total) * 100) / 100
    : 0;

  const grouped = groupByCategory(list.items);

  return (
    <div className="min-h-screen bg-[#FFFBF7]">
      {/* Header */}
      <header className="px-4 py-4 border-b border-[#E8E2DC] bg-white sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link href="/" className="font-bold text-lg text-[#1D2324]">
            supermarket<span className="text-[#E17055]">.ie</span>
          </Link>
          <span className="text-xs text-[#636E72]">Updated {formatDate(list.generated_at)}</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-16">
        {/* Title */}
        <div className="pt-8 pb-6">
          <h1 className="text-2xl font-bold text-[#1D2324] mb-1">Your weekly shop</h1>
          <p className="text-[#636E72] text-sm">
            Best prices across Tesco, Dunnes &amp; SuperValu for a household of{' '}
            <strong className="text-[#1D2324]">{familySizeLabel(familySize)}</strong>
          </p>
        </div>

        {list.items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E8E2DC] p-8 text-center text-[#636E72]">
            <p className="text-lg mb-2">Prices are being updated</p>
            <p className="text-sm">Check back soon — we&rsquo;re scanning stores now.</p>
          </div>
        ) : (
          <>
            {/* Recommended store banner */}
            {cheapest && (
              <div
                className="rounded-2xl p-5 mb-6 text-white"
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
                  const style = storeStyle(st.store);
                  const isCheapest = i === 0;
                  return (
                    <div
                      key={st.store}
                      className="rounded-xl p-3 border-2 text-center"
                      style={{
                        borderColor: isCheapest ? style.border : '#E8E2DC',
                        background: isCheapest ? style.light : '#fff',
                      }}
                    >
                      <div
                        className="font-bold text-sm mb-1"
                        style={{ color: isCheapest ? style.bg : '#1D2324' }}
                      >
                        {storeDisplayName(st.store)}
                      </div>
                      <div
                        className="text-lg font-bold"
                        style={{ color: isCheapest ? style.bg : '#1D2324' }}
                      >
                        {fmt(st.total)}
                      </div>
                      {isCheapest && (
                        <div
                          className="text-[10px] font-semibold mt-1 rounded-full px-2 py-0.5 inline-block text-white"
                          style={{ background: style.bg }}
                        >
                          Cheapest
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Product list by category */}
            <div className="space-y-6">
              {grouped.map(([category, items]) => (
                <div key={category}>
                  <h3 className="text-xs font-bold text-[#636E72] uppercase tracking-wider mb-2">
                    {category}
                  </h3>
                  <div className="bg-white rounded-xl border border-[#E8E2DC] px-4">
                    {items.map((item) => (
                      <ProductRow key={item.product_id} item={item} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Item count */}
            <p className="text-center text-xs text-[#B2BEC3] mt-6">
              {list.items.length} items across {list.store_totals.length} stores
            </p>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E8E2DC] py-6 px-4">
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#B2BEC3]">
          <span>Prices updated {formatDate(list.generated_at)}</span>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-[#636E72] transition">supermarket.ie</Link>
            <Link href={unsubscribeUrl} className="hover:text-[#636E72] transition">Unsubscribe</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
